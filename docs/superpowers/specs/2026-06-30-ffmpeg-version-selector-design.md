# FFmpeg 版本选择器设计

**日期**：2026-06-30
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
3. 切换版本后更新配置，下次服务启动生效

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

bundled 阶段改为：**选择 .versions/ 下版本号最高的目录**（而非只看配置版本）

```
当前：override → bundled(配置版本优先) → system → missing
改进：override → bundled(最高语义版本优先) → system → missing
```

具体逻辑：
1. 扫描 `.versions/` 下所有版本目录
2. 对每个版本验证 ffmpeg 可执行
3. 按语义版本降序排序
4. 选择版本号最高的可执行二进制

### 3. 版本选择 API

新增两个 API 端点：

**GET /api/ffmpeg/versions**

响应：
```typescript
{
  versions: string[]       // 所有已安装版本，按语义版本降序
  current: string | null   // 当前使用的版本
  recommended: string | null  // 推荐版本（最高版本）
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
- 写入配置失败 → 500 + "配置更新失败"

### 4. 管理面板版本选择器

在 `FFmpeg 面板`新增"版本管理"区块：

**UI 布局**：
```
已安装版本（按语义版本排序）：
[下拉选择器 ▼] [切换版本按钮]
⚠ 版本切换将在下次服务启动后生效
```

**行为**：
1. 页面加载时调用 `GET /api/ffmpeg/versions` 获取版本列表
2. 当前激活版本显示"（当前）"标识
3. 用户选择版本后点击"切换版本"
4. 调用 `POST /api/ffmpeg/select`
5. 成功后显示提示"版本切换将在下次服务启动后生效"
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

  // POST /api/ffmpeg/select
  app.post('/select', async (request, reply) => {
    const { version } = request.body as { version: string }
    
    // 验证版本存在且可执行
    const versions = await app.ffmpegManager.listVersions()
    if (!versions.includes(version)) {
      return reply.status(400).send({ success: false, message: '版本不存在' })
    }
    
    // 更新配置
    try {
      await updateFfmpegVersion(version)  // 更新 config.ffmpeg.version
      return { success: true, message: `已切换到版本 ${version}，下次服务启动生效` }
    } catch (err) {
      return reply.status(500).send({ success: false, message: '配置更新失败' })
    }
  })
}
```

### FFmpegManager 改动

```typescript
// src/services/ffmpeg-manager.ts

// 新增：列出所有可用版本
async listVersions(): Promise<string[]> {
  const versionsRoot = join(this.opts.binRoot, '.versions')
  const versions: string[] = []
  
  try {
    const entries = await readdir(versionsRoot, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const binPath = join(versionsRoot, e.name, this.binaryName())
      if (existsSync(binPath) && await this.canExecute(binPath)) {
        versions.push(e.name)
      }
    }
  } catch {
    // .versions/ 不存在，返回空数组
  }
  
  return versions.sort(semverCompare).reverse()
}

// 新增：更新配置文件的版本偏好
async setPreferredVersion(version: string): Promise<void> {
  // 读取配置文件，更新 ffmpeg.version，写回
}

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
2. 切换版本 → 配置更新 → 重启服务 → 验证使用新版本

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 版本排序方式 | 语义版本比较 | `semver` 方式确保 `8.1 > 7.1 > 6.0`，支持两位数主版本 |
| 默认选择 | 最高语义版本 | 减少用户操作，目录乱了也能自愈 |
| 切换生效时机 | 下次服务启动 | Node.js 进程已加载二进制，无法运行时热切换 |
| 推荐版本标注 | UI 显示 ★ | 帮助用户识别最新版本 |
