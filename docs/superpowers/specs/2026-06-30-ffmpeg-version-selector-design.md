# FFmpeg 版本选择器设计

**日期**：2026-06-30
**修订**：2026-07-01（用户反馈"选择不生效" → 修正持久化与覆盖逻辑）
**目的**：多版本 FFmpeg 存在时，支持用户选择默认使用最新版本，并在管理面板提供版本选择功能
**参考**：v1 设计 `2026-06-29-radio-services-design.md` §3.1

---

## 背景与目标

当前 `FFmpegManager` 在 bundled 阶段遍历 `.versions/` 下所有版本目录，按**配置版本优先**（`config.ffmpeg.version`）选择第一个可执行文件。存在以下问题：

- 用户下载多个版本后，无法选择使用最新版本
- 管理面板只展示当前版本状态，无法切换
- 用户意图：默认使用最新版本（语义版本比较），并提供可视化选择界面

**目标**：
1. bundled 阶段自动选择**最高语义版本**（而非配置版本优先）
2. 管理面板新增版本选择器，可查看所有已安装版本并手动切换
3. 切换版本后实时生效（无需重启）

> **2026-07-01 修订目标**：
> 1. **切换必须真正持久化**：原 spec 让 `POST /select` 写 `config.yaml` 内存态，
>    ops 因此认为持久化"太危险"，改为写独立 state 文件（`bin/ffmpeg/.state.json`）
> 2. **配置/选择优先级明确化**：原 spec "默认选最高" 直接违反用户反馈
>    （写 config=7.1 仍然启动到 8.1）。新设计：尊重 ops 写在 config 里的版本，
>    "选最高" 仅在 config 版本缺失时作为 fallback
> 3. **UI 显示路径**：管理面板只显示版本号无法排错；新增 `currentPath` 字段显示
>    项目内相对路径
> 4. **实时生效**：原 spec 说"下次服务启动生效"。但用户实际想要的、也是更符合
>    直觉的体验是**点击切换 → 下一次请求就用新版本**。`POST /select` 现在调用
>    `FFmpegManager.setVersion()` 立即重探测 bundled binary 并替换 `status`。
>    `Archiver` / push-source 启动时通过 `getFfmpegPath()` 函数从 manager 实时拿
>    最新 path，无需重启。

---

## 功能需求

### 1. 版本扫描与排序

`FFmpegManager` 新增 `listVersions()` 方法：

- 扫描 `binRoot/.versions/` 下所有子目录
- 验证每个版本目录下存在可执行的 ffmpeg 二进制
- 按语义版本比较（major.minor）降序排序
- 返回 `string[]`

```typescript
async listVersions(): Promise<string[]>
// 返回如 ["8.1", "7.1", "6.0"]，按版本号从高到低
```

### 2. 初始化优先级调整

> **修订（2026-07-01）**：原始 spec 说"bundled 选最高版本，不管 config"。这与用户
> 反馈"我选了 7.1，为什么要 8.1"直接冲突（用户是被默默切换的，因为他们没有
> `runtimeState` 走默认分支）。新优先级：

```
override → runtimeState 选 → bundled(运行时配置版本，失败再降级到最高) → system → missing
```

**精确语义（修订版）**：

1. **override**：调试路径（`opts.ffmpegPathOverride`）— 一切其它逻辑短路
2. **runtimeState（最高优先）**：读 `bin/ffmpeg/.state.json` 中的 `selected_version`。
   存在即覆盖 `opts.version`。这是用户从管理面板切换的 sticky 选择
3. **bundled（实际选 bundled 阶段）**：
   - 先尝试 `opts.version` 对应的 `.versions/{opts.version}/ffmpeg`，存在且可执行就用
   - 否则按 `listVersions()` 降序遍历，第一个可执行的 fallback（"最高版本"语义仅生效于此）
4. **system**：回退到 PATH 上的 ffmpeg（启动不再网络下载）
5. **missing**：都没有则报错 + 管理面板提示

**为什么 bundled 阶段还要降级**：允许 ops 在 `config.yaml` 写一个版本但暂未下载时，
仍能使用已下载的最新版（避免 deadlock）。但当 ops 写 7.1 且已经下载 7.1 时，**必须用 7.1**。

**修订的关键问题**：原 spec 调用了 `resolveLatestFfmpegVersion()` 在没有
`runtimeState` 时静默覆盖 `opts.version` 为网络最新值。这一调用被移除——网络版本仅
作为后备探测使用（不在 startup 主动强制 override）。

### 3. 版本选择 API

新增两个 API 端点：

**GET /api/ffmpeg/versions**

响应：
```typescript
{
  versions: string[]            // 所有已安装版本，按语义版本降序
  current: string | null        // 用户/ops 选定的版本（runtime state > config）
  recommended: string | null    // 推荐版本（最高版本）
  currentPath: string | null    // 当前 binary 的项目内相对路径
                              // （如 "bin/ffmpeg/.versions/8.1/ffmpeg"）
}
```

**POST /api/ffmpeg/select**

请求：
```typescript
{ version: string }  // 要选择的版本号
```

响应：
```typescript
{ success: boolean; message: string }
```

错误场景：
- 版本目录不存在 → 400 + "版本不存在"
- 版本二进制不可执行 → 400 + "该版本文件损坏"

> **修订（2026-07-01）**：原 spec 把选择写回 `config.yaml`。这违反 ops 直觉——
> ops 修改 `config.yaml` 是部署行为，UI 切换是运行时行为。两类语义混在同一文件
> 既不安全也不合理。新设计：选择写 `bin/ffmpeg/.state.json`（由 `keyv` + `keyv-file`
> 维护），与 config 完全隔离。
> → 写入失败这条错误场景不再适用（state 文件路径是服务器内部细节）。

### 4. 管理面板版本选择器

在 `FFmpeg 面板`新增"版本管理"区块 + "下载安装"区块：

**版本管理 UI**：
```
已安装版本（按语义版本排序）：
[下拉选择器 ▼ （显示当前激活）] [切换版本按钮]   ← 单行
✓ 已切换到 7.1（实时生效）                        ← 反馈行
```

> **修订（2026-07-01）**：
> - **同行布局**：select + button 通过 `.version-row` flex 容器单行渲染，
>   避免挤占 viewport
> - **默认显示当前激活**：select 的 `selected` 标记 `data.current`（runtimeState
>   > config），不再默认显示最高版本
> - **删除"下次服务启动"提示**：切换实时生效，反馈行直接显示成功状态

**下载安装 UI**：
```
✓ FFmpeg 已安装并可用                       ← 恒定显示（不再按 source 分支）

远程可下载版本（按版本号排序）：                ← 默认显示 8 个
  9.0      [下载]
  8.1.1    [下载]
  7.1.5    [下载]
  ...
  7.1      已安装                            ← local has 7.1 → no button

[进度条 / 完成提示]
```

> **修订（2026-07-01）**：
> - **恒定已安装文案**：UI 不再按 `status.source`（bundled / system / missing）
>   分支渲染。不管 ffmpeg 跑得起来吗，都显示"✓ FFmpeg 已安装并可用"——具体是否可用
>   由状态表/系统日志承担。system fallback 的"建议重新下载"提示转移到下面"远程版本
>   列表"自然承担（未装的版本即下载入口）
> - **远程版本即下载入口**：替代原 spec "下载最新版本"按钮。`GET /api/ffmpeg/remote-versions`
>   返回 top-N（默认 8）降序，每条带 `installed: bool`。前端已装的隐藏按钮
>   显示"已安装"，未装的显示"下载"
> - **下载指定版本**：`POST /api/ffmpeg/download` body `{ version }` 调用
>   `FFmpegManager.triggerDownload(version)`，落到 `.versions/{version}/`
```
已安装版本（按语义版本排序）：
[下拉选择器 ▼] [切换版本按钮]
✓ 版本切换实时生效（无需重启）
```

**行为**：
1. 页面加载时调用 `GET /api/ffmpeg/versions` 获取版本列表
2. 当前激活版本显示"（当前）"标识
3. 用户选择版本后点击"切换版本"
4. 调用 `POST /api/ffmpeg/select`
5. 成功后显示提示"版本已实时切换"；archiver 下次启动时使用新二进制
6. 自动刷新状态显示（`loadFfmpegStatus()`）

---

## 架构设计

### 端点注册

在 `src/routes/` 下新增 `ffmpeg.ts` 路由文件（或并入现有 config 路由）：

```typescript
// src/routes/ffmpeg.ts
import type { FastifyInstance } from 'fastify'

export async function ffmpegRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/ffmpeg/versions
  app.get('/versions', async (request, reply) => {
    const versions = await app.ffmpegManager.listVersions()
    const current = app.ffmpegManager.getStatus()
    return {
      versions,
      current: current.version,
      recommended: versions[0] ?? null,  // 最高版本
    }
  })

  // POST /api/ffmpeg/select — 实时切换
  // 1. 校验版本在 installed 列表
  // 2. 写 runtimeState.setSelectedVersion(v)（持久化到 .state.json）
  // 3. 调 ffmpegManager.setVersion(v)：opts.version += 重探测 bundled + 替换 status
  // 4. wsHub.emitEvent('config-changed')
  // 5. 返回 { success, available, message }

  // GET /api/ffmpeg/remote-versions — top-N 远程 release + installed 标记
  // 1. ffmpegManager.listLatestRemoteVersions(8)
  // 2. ffmpegManager.listVersions() → 与 remote 按 major.minor 比对
  // 3. 返回 [{ version: '9.0', installed: false }, ...]

  // POST /api/ffmpeg/download — 下载指定版本
  // body: { version?: string }，省略时用 config/runtime 当前版本
  // → ffmpegManager.triggerDownload(version)
}
```

### FFmpegManager 改动

> **2026-07-01 修订**：原 spec 的 `setPreferredVersion(version)` 写 `config.yaml`
> 已被废弃。`setVersion(v)` 替代：写 opts.version + 重新探测 bundled + 替换 status，
> 调用方负责 `runtimeState.setSelectedVersion(v)` 持久化。

```typescript
// src/services/ffmpeg-manager.ts

// 新增：列出本地已装版本（按 major.minor semver 降序）
async listVersions(): Promise<string[]>

// 新增：实时切换 — 不重启立即生效
async setVersion(version: string): Promise<FFmpegStatus> {
  this.opts.version = version
  const bundled = await this.tryBundledVersion(version)
  if (bundled) {
    this.status = bundled
    return bundled
  }
  // 没有对应 bundled binary → 标 missing（runtimeState 已经持久化，
  // 下次启动会用这个版本；当前 archiver 不会用错二进制因为 status.path=null）
  if (this.status.source === 'bundled') {
    this.status = { available: false, source: 'missing', path: null, version: null }
  }
  return { ...this.status }
}

// 新增：试给定版本的 bundled 二进制，存在且可执行则返回 status fragment
async tryBundledVersion(version: string): Promise<FFmpegStatus | null>

// 新增：列出远程最新 top-N release（去重 major.minor，保留最高 patch）
async listLatestRemoteVersions(limit = 8): Promise<string[]>

// 修订：triggerDownload 接受 version 参数（指定下载哪个版本）
async triggerDownload(version?: string): Promise<void>  // version 不传时用 opts.version
```

// bundled 阶段改动：选择最高版本而非配置版本
// 见下方「改动明细」
```

### 语义版本比较

项目没有外部 `semver` 依赖，使用自定义比较函数（复用现有的 `normalizeVersion()` 逻辑）：

```typescript
// 按语义版本降序排序（支持 X.Y 和 X.Y.Z 格式）
function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const na = normalizeVersion(a)
    const nb = normalizeVersion(b)
    if (!na || !nb) return a.localeCompare(b)  // 无法解析时按字符串
    // 拆分为 major.minor 比较
    const [amaj, amin] = na.split('.').map(Number)
    const [bmaj, bmin] = nb.split('.').map(Number)
    if (bmaj !== amaj) return bmaj - amaj  // 降序
    return bmin - amin
  })
}
```

注意：`listVersions()` 返回的版本号来自目录名（`normalizeVersion()` 已处理 BtbN 的 `n8.1.1` 格式），格式统一为 `X.Y`，可直接比较。

---

## 运行时状态存储（2026-07-01 新增）

**位置**：`bin/ffmpeg/.state.json`（与 ffmpeg 二进制同目录，受 `bin/` gitignore 自动排除）

**格式**：JSON 文件，由 `keyv` + `keyv-file` 维护。示例内容：
```json
{
  "cache": [
    ["ffmpeg:selected_version", { "value": "{\"value\":\"7.1\"}" }]
  ],
  "lastExpire": 1782841662834
}
```

**为什么独立不写 `config.yaml`**：
- `config.yaml` 是 ops 部署管理（git 跟踪）
- UI 切换是 ops 运行时行为（重置即失效）
- 两种语义耦合到同一文件不安全也不合理
- 这种设计也叫 "preference store" — 类似浏览器 cookie 不写进 OS config

**TTL 选择**：`setSelectedVersion()` 调用 `kv.set(key, value, 0)`。
`ttl=0` 在 keyv 中规范化为 `undefined`，表示**永不过期**。理由：用户 UI 切换应该
sticky 直到 ops 显式清空（`clearSelectedVersion()`）或删除二进制时连带清理，
不应该因为某个 TTL 默默过期。

**库选型 `keyv` + `keyv-file`**：
- keyv：抽象层，未来可换 sqlite / redis（多节点场景）— 改一行 store
- keyv-file：纯 JSON 文件，零运行时依赖（仅 tslib）
- 接口：`get/set/delete`，与封装的 `FfmpegRuntimeState` 对齐

---

## 前端改动

### 新增 API 客户端方法

```typescript
// src/web/api-client.ts

interface FFmpegVersionsResponse {
  versions: string[]
  current: string | null
  recommended: string | null
}

interface SelectVersionResponse {
  success: boolean
  message: string
}

async listFfmpegVersions(): Promise<FFmpegVersionsResponse> {
  const res = await fetch('/api/ffmpeg/versions')
  if (!res.ok) throw new Error('获取版本列表失败')
  return res.json()
}

async selectFfmpegVersion(version: string): Promise<SelectVersionResponse> {
  const res = await fetch('/api/ffmpeg/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  })
  return res.json()
}
```

### FFmpeg 面板新增区块

```typescript
// src/web/views/ffmpeg-panel.ts

export async function renderFfmpegPanel(container: Element): Promise<void> {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">FFmpeg 状态</div>
      <div id="ffmpeg-status-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">下载安装</div>
      <div id="ffmpeg-download-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <!-- 新增：版本管理区块 -->
    <div class="card">
      <div class="card-title">版本管理</div>
      <div id="ffmpeg-versions-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `

  await Promise.all([
    loadFfmpegStatus(),
    loadVersionSelector(),
  ])
}
```

### 版本选择器渲染逻辑

```typescript
async function loadVersionSelector(): Promise<void> {
  const container = $('#ffmpeg-versions-content')
  if (!container) return

  try {
    const data = await api.listFfmpegVersions()

    if (data.versions.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无已安装版本</p>'
      return
    }

    const options = data.versions.map(v =>
      `<option value="${v}" ${v === data.current ? 'selected' : ''}>
        ${escapeHtml(v)}${v === data.current ? ' （当前）' : ''}${v === data.recommended ? ' ★' : ''}
      </option>`
    ).join('')

    container.innerHTML = `
      <p class="text-muted">已安装版本（按语义版本排序）：</p>
      <select id="ffmpeg-version-select" class="select">
        ${options}
      </select>
      <button class="btn" id="switch-version-btn" style="margin-left: 0.5rem">切换版本</button>
      <p id="switch-hint" class="text-muted" style="margin-top: 0.5rem; display: none">
        ⚠ 版本切换将在下次服务启动后生效
      </p>
    `

    $('#switch-version-btn')?.addEventListener('click', handleVersionSwitch)
  } catch (err) {
    console.error('[ffmpeg-panel] versions error:', err)
    container.innerHTML = '<p class="text-muted">无法加载版本列表</p>'
  }
}

async function handleVersionSwitch(): Promise<void> {
  const select = $('#ffmpeg-version-select') as HTMLSelectElement | null
  const hint = $('#switch-hint')
  const btn = $('#switch-version-btn') as HTMLButtonElement | null

  if (!select) return

  const version = select.value
  if (btn) {
    btn.disabled = true
    btn.textContent = '切换中...'
  }

  try {
    const result = await api.selectFfmpegVersion(version)
    if (result.success) {
      if (hint) hint.style.display = 'block'
      await loadFfmpegStatus()  // 刷新状态
    } else {
      alert(`切换失败: ${result.message}`)
    }
  } catch (err) {
    console.error('[ffmpeg-panel] switch error:', err)
    alert('切换失败，请重试')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = '切换版本'
    }
  }
}
```

---

## 改动明细

### 文件变更清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/services/ffmpeg-manager.ts` | 修改 | 新增 `listVersions()`、`setPreferredVersion()`；修改 bundled 阶段选择逻辑 |
| `src/routes/ffmpeg.ts` | 新增 | 版本列表和版本选择 API 端点 |
| `src/app.ts` | 修改 | 注册 ffmpeg 路由 |
| `src/config.ts` | 修改 | 新增 `updateFfmpegVersion()` 或通过现有 setter 更新配置 |
| `src/web/types.ts` | 修改 | 新增 `FFmpegVersionsResponse`、`SelectVersionResponse` 类型 |
| `src/web/api-client.ts` | 修改 | 新增 `listFfmpegVersions()`、`selectFfmpegVersion()` |
| `src/web/views/ffmpeg-panel.ts` | 修改 | 新增版本管理区块和选择器逻辑 |

### FFmpegManager.bundled 阶段改动

当前逻辑（第 140-168 行）：
```typescript
// 只看配置版本
const preferred = join(this.opts.binRoot, '.versions', this.opts.version, this.binaryName())
if (existsSync(preferred)) {
  // 使用配置版本
}
```

改为：
```typescript
// 扫描所有版本，选择最高的
const allVersions = await this.listVersions()
if (allVersions.length > 0) {
  const best = allVersions[0]  // 最高版本已在 listVersions 中排序
  const bestPath = join(this.opts.binRoot, '.versions', best, this.binaryName())
  if (await this.canExecute(bestPath)) {
    this.status = {
      available: true,
      source: 'bundled',
      path: bestPath,
      version: await this.getVersion(bestPath),
    }
    return this.status
  }
  // 最高版本不可执行，降级到次高版本（listVersions 已排序）
  for (const v of allVersions.slice(1)) {
    const p = join(this.opts.binRoot, '.versions', v, this.binaryName())
    if (await this.canExecute(p)) {
      this.status = { available: true, source: 'bundled', path: p, version: await this.getVersion(p) }
      return this.status
    }
  }
}
```

---

## 错误处理

| 场景 | 后端处理 | 前端处理 |
|------|---------|---------|
| 版本目录不存在 | 400 + "版本不存在" | alert 提示 |
| 版本二进制损坏 | 400 + "该版本文件损坏" | alert 提示 |
| 写入配置失败 | 500 + "配置更新失败" | alert 提示 |
| .versions/ 为空 | 返回空数组 | 显示"暂无已安装版本" |
| API 请求失败 | - | 显示"无法加载版本列表" |

---

## 测试策略

### 单元测试

1. `FFmpegManager.listVersions()`
   - .versions/ 为空 → 返回 `[]`
   - .versions/ 有多个版本 → 按语义版本降序返回
   - 只包含不可执行的目录 → 过滤后返回

2. `FFmpegManager` bundled 选择逻辑
   - 多版本存在时选择最高版本（语义版本比较）
   - 最高版本不可执行时降级到次高版本

3. 语义版本比较
   - `8.1` > `7.1` > `6.0`
   - `10.0` > `9.9`（两位数处理）

### 集成测试

1. `GET /api/ffmpeg/versions` → 返回版本列表和当前版本
2. `POST /api/ffmpeg/select` → 成功切换版本
3. `POST /api/ffmpeg/select` → 版本不存在时返回 400

### E2E 测试

1. 安装多个 FFmpeg 版本 → 版本列表显示所有版本
2. 切换版本 → 立即调用 `/api/ffmpeg/status` → 验证返回的 path 已指向新版本
3. 重启服务 → 验证选择的版本依然生效（持久化路径仍生效）

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 版本排序方式 | 语义版本比较 | `semver` 方式确保 `8.1 > 7.1 > 6.0`，支持两位数主版本 |
| 默认选择 | ops config > 用户选择 > 最高版本 fallback | 详见 §"初始化优先级调整"。尊重 ops 写在 config.yaml 里的版本，"最高版本"仅作 fallback |
| 切换生效时机 | 实时生效（无需重启） | `FFmpegManager.setVersion()` 重探测 bundled binary 并替换 `status`；Archiver / push-source 通过 `getFfmpegPath()` 函数实时拉最新 path |
| 推荐版本标注 | UI 显示 ★ | 帮助用户识别最新版本 |
