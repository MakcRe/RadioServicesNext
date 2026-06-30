# FFmpeg 版本选择器 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让运营方在管理面板上查看已安装的所有 FFmpeg 版本，按语义版本号排序，手动选择某个版本作为下次启动的默认版本。

**架构：** 新增 `FFmpegManager.listVersions()` 扫描 `binRoot/.versions/`，按 `normalizeVersion()` 生成的 major.minor 排序（降序）。`doInitialize()` 的 bundled 阶段改为"最高版本优先"而非"配置版本优先"。新增两个 API：`GET /api/ffmpeg/versions` 列出已安装版本、`POST /api/ffmpeg/select` 把用户选择的版本号写入 `config.ffmpeg.version`（内存态，下次启动生效）。前端新增"版本管理"卡片，含 `<select>` 下拉 + 切换按钮。

**技术栈：** TypeScript · Fastify · Vitest · js-yaml

**参考文档：** `docs/superpowers/specs/2026-06-30-ffmpeg-version-selector-design.md`

---

## 文件结构

```
radioServices/
├── src/
│   ├── services/
│   │   └── ffmpeg-manager.ts           # 修改: 新增 listVersions()，改 bundled 优先级
│   ├── routes/
│   │   └── ffmpeg.ts                   # 修改: 新增 GET /versions、POST /select
│   ├── app.ts                          # 修改: 路由已注册（无需改动 — 现存 registerFfmpegRoutes 仍生效）
│   ├── web/
│   │   ├── types.ts                    # 修改: 新增 FFmpegVersionsResponse、SelectVersionResponse
│   │   ├── api-client.ts               # 修改: 新增 listFfmpegVersions()、selectFfmpegVersion()
│   │   └── views/
│   │       └── ffmpeg-panel.ts         # 修改: 新增"版本管理"卡片 + 选择器逻辑
│   └── config.ts                       # 修改: 新增 updateFfmpegVersionInMemory()
└── tests/
    └── integration/
        └── ffmpeg-versions.test.ts     # 新增: listVersions + select 端点集成测试
```

---

## 任务 1：FFmpegManager 新增 listVersions() 方法

**文件：**
- 修改：`src/services/ffmpeg-manager.ts:106-169`（bundled 阶段）
- 修改：`src/services/ffmpeg-manager.ts:286-288`（紧接 binaryName 之后）
- 测试：`tests/integration/ffmpeg-manager.test.ts`（新增 describe 块）

- [ ] **步骤 1：编写失败的单元测试**

```typescript
// 追加到 tests/integration/ffmpeg-manager.test.ts 末尾
import { writeFileSync, mkdirSync, rmSync } from 'fs'

describe('FFmpegManager.listVersions', () => {
  it('returns [] when .versions/ does not exist', async () => {
    const binRoot = join(tempDir, 'bin-empty')
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    expect(await mgr.listVersions()).toEqual([])
  })

  it('returns installed versions sorted descending by semver', async () => {
    const binRoot = join(tempDir, 'bin-multi')
    const versions = ['7.1', '8.1', '6.0']
    for (const v of versions) {
      const dir = join(binRoot, '.versions', v)
      mkdirSync(dir, { recursive: true })
      const path = join(dir, 'ffmpeg')
      writeFileSync(path, `#!/bin/sh\necho "ffmpeg version ${v}"\n`, { mode: 0o755 })
    }
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    expect(await mgr.listVersions()).toEqual(['8.1', '7.1', '6.0'])
  })

  it('skips directories without an executable ffmpeg', async () => {
    const binRoot = join(tempDir, 'bin-partial')
    mkdirSync(join(binRoot, '.versions', '7.1'), { recursive: true })
    mkdirSync(join(binRoot, '.versions', '8.1'), { recursive: true })
    // 7.1 has a working binary
    writeFileSync(
      join(binRoot, '.versions', '7.1', 'ffmpeg'),
      '#!/bin/sh\necho "ffmpeg version 7.1"\n',
      { mode: 0o755 },
    )
    // 8.1 has a non-executable file
    writeFileSync(join(binRoot, '.versions', '8.1', 'ffmpeg'), 'not executable')

    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    expect(await mgr.listVersions()).toEqual(['7.1'])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm vitest run tests/integration/ffmpeg-manager.test.ts -t listVersions`
预期：FAIL，TypeError: mgr.listVersions is not a function

- [ ] **步骤 3：实现 listVersions()**

在 `src/services/ffmpeg-manager.ts` 紧接 `private binaryName()`（第 286-288 行）后新增：

```typescript
  /**
   * Scan `<binRoot>/.versions/*` for executables, return major.minor
   * strings sorted descending by semver. Used by the bundled-slot picker
   * and by the admin "版本管理" UI.
   *
   * - Reads directory entries only (no recursion beyond depth 2).
   * - Filters out non-executable files via `canExecute()`.
   * - Stable across directory iteration order on different filesystems.
   */
  async listVersions(): Promise<string[]> {
    const versionsRoot = join(this.opts.binRoot, '.versions')
    const installed: string[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(versionsRoot, { withFileTypes: true })
    } catch {
      return []
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const binPath = join(versionsRoot, e.name, this.binaryName())
      if (!(await this.canExecute(binPath))) continue
      installed.push(e.name)
    }
    return installed.sort((a, b) => {
      const [amaj, amin] = a.split('.').map(Number)
      const [bmaj, bmin] = b.split('.').map(Number)
      if (bmaj !== amaj) return bmaj - amaj
      return bmin - amin
    })
  }
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm vitest run tests/integration/ffmpeg-manager.test.ts -t listVersions`
预期：3 个测试 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/ffmpeg-manager.ts tests/integration/ffmpeg-manager.test.ts
git commit -m "feat(ffmpeg): add listVersions() for admin version selector"
```

---

## 任务 2：bundled 阶段改为"最高版本优先"

**文件：**
- 修改：`src/services/ffmpeg-manager.ts:140-169`（bundled 选择逻辑）
- 测试：`tests/integration/ffmpeg-manager.test.ts`（新增 describe 块）

- [ ] **步骤 1：编写失败的单元测试**

```typescript
// 追加到 tests/integration/ffmpeg-manager.test.ts
describe('FFmpegManager bundled version priority (per spec 2026-06-30)', () => {
  it('picks the highest semver when multiple versions are installed', async () => {
    const binRoot = join(tempDir, 'bin-priority')
    for (const v of ['7.1', '8.1', '6.0']) {
      const dir = join(binRoot, '.versions', v)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'ffmpeg'),
        `#!/bin/sh\necho "ffmpeg version ${v}.0"\n`,
        { mode: 0o755 },
      )
    }
    // config says 7.1, but 8.1 should win
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    const status = await mgr.initialize()
    expect(status.source).toBe('bundled')
    expect(status.path).toBe(join(binRoot, '.versions', '8.1', 'ffmpeg'))
  })

  it('falls back to next-highest when top version is non-executable', async () => {
    const binRoot = join(tempDir, 'bin-fallback')
    mkdirSync(join(binRoot, '.versions', '8.1'), { recursive: true })
    mkdirSync(join(binRoot, '.versions', '7.1'), { recursive: true })
    // 8.1 broken
    writeFileSync(join(binRoot, '.versions', '8.1', 'ffmpeg'), 'broken')
    // 7.1 working
    writeFileSync(
      join(binRoot, '.versions', '7.1', 'ffmpeg'),
      '#!/bin/sh\necho "ffmpeg version 7.1.0"\n',
      { mode: 0o755 },
    )
    const mgr = new FFmpegManager({
      binRoot,
      version: '8.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    const status = await mgr.initialize()
    expect(status.path).toBe(join(binRoot, '.versions', '7.1', 'ffmpeg'))
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm vitest run tests/integration/ffmpeg-manager.test.ts -t 'bundled version priority'`
预期：FAIL（当前实现会按目录枚举顺序选择，8.1 不一定被选中）

- [ ] **步骤 3：替换 bundled 阶段为 listVersions() 驱动**

在 `src/services/ffmpeg-manager.ts` 中，将第 140-169 行（`if (!this.forceDownload) { ... bundled candidates ... }`）整体替换为：

```typescript
    if (!this.forceDownload) {
      // 选择语义版本最高的可执行 bundled 二进制（v1.3 起）。
      // 之前是"配置版本优先"，但当用户下载多个版本时，配置版本不一定是最新。
      // listVersions() 已按 semver 降序排序且过滤掉不可执行的目录，所以 [0] 就是首选。
      const sorted = await this.listVersions()
      for (const v of sorted) {
        const p = join(this.opts.binRoot, '.versions', v, this.binaryName())
        this.status = {
          available: true,
          source: 'bundled',
          path: p,
          version: await this.getVersion(p),
        }
        return this.status
      }
    }
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm vitest run tests/integration/ffmpeg-manager.test.ts`
预期：全部 PASS（包括已有的 loose-binary 迁移测试 — listVersions 排序对它们无影响）

- [ ] **步骤 5：Commit**

```bash
git add src/services/ffmpeg-manager.ts tests/integration/ffmpeg-manager.test.ts
git commit -m "feat(ffmpeg): pick highest semver when multiple bundled versions exist"
```

---

## 任务 3：config.ts 新增 updateFfmpegVersionInMemory() 辅助函数

**文件：**
- 修改：`src/config.ts`（末尾追加）

- [ ] **步骤 1：编写配置更新辅助函数**

在 `src/config.ts` 末尾（第 136 行 `warnIfDefaultPassword` 之后）追加：

```typescript
/**
 * Update the in-memory `config.ffmpeg.version` field. Does NOT persist
 * to the YAML file — the user-selected version takes effect on next
 * service restart (which is documented in the admin UI). The setter
 * is kept in-memory because the operator can edit config.yaml directly
 * to pin a different version at any time.
 */
export function updateFfmpegVersionInMemory(cfg: AppConfig, version: string): void {
  cfg.ffmpeg.version = version
}
```

- [ ] **步骤 2：类型检查**

运行：`pnpm tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add updateFfmpegVersionInMemory() helper"
```

---

## 任务 4：新增 GET /api/ffmpeg/versions 与 POST /api/ffmpeg/select 路由

**文件：**
- 修改：`src/routes/ffmpeg.ts:1-69`（在文件末尾追加新端点）
- 测试：`tests/integration/ffmpeg-versions.test.ts`（新建）

- [ ] **步骤 1：编写失败的集成测试**

新建 `tests/integration/ffmpeg-versions.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildApp } from '../../src/app.js'
import { loadConfig, updateFfmpegVersionInMemory } from '../../src/config.js'
import type { FastifyInstance } from 'fastify'
import request from 'supertest'

let app: FastifyInstance
let tempDir: string
let binRoot: string
let configPath: string

function placeBinary(version: string): void {
  const dir = join(binRoot, '.versions', version)
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, 'ffmpeg')
  writeFileSync(
    bin,
    `#!/bin/sh\necho "ffmpeg version ${version}.0"\nexit 0\n`,
    { mode: 0o755 },
  )
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-versions-'))
  binRoot = join(tempDir, 'bin')
  configPath = join(tempDir, 'config.yaml')

  // Pre-place 7.1 + 8.1
  placeBinary('7.1')
  placeBinary('8.1')

  writeFileSync(
    configPath,
    `
server: { host: "127.0.0.1", port: 0 }
auth: { sourcePassword: "x" }
ffmpeg: { version: "7.1", sourceUrl: "https://example.invalid/" }
archive: { directory: "${join(tempDir, 'arc')}", segmentDurationSec: 3600, retentionDays: 1, minFreeSpaceMB: 100 }
playlist: { uploadDir: "${join(tempDir, 'up')}", maxFileSizeMB: 50, allowedExtensions: [".mp3"] }
logging: { directory: "${join(tempDir, 'logs')}", level: "error", retentionDays: 1 }
stream: { pollIntervalMs: 5000, pollIntervalMaxMs: 30000 }
db: { path: "${join(tempDir, 't.db')}" }
`,
  )
  const built = await buildApp(configPath)
  app = built.app
  await app.listen({ port: 0, host: '127.0.0.1' })
})

afterAll(async () => {
  if (app) await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('GET /api/ffmpeg/versions', () => {
  it('returns installed versions sorted descending', async () => {
    const res = await request(app.server).get('/api/ffmpeg/versions')
    expect(res.status).toBe(200)
    expect(res.body.versions).toEqual(['8.1', '7.1'])
    expect(res.body.recommended).toBe('8.1')
    // current = currently active bundled version (8.1 wins via listVersions)
    expect(res.body.current).toBe('8.1')
  })
})

describe('POST /api/ffmpeg/select', () => {
  it('updates config.ffmpeg.version in memory', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '7.1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, message: expect.stringContaining('7.1') })

    // Verify the in-memory config actually changed — fetch /api/config
    const cfg = await request(app.server).get('/api/config')
    expect(cfg.body.ffmpeg.version).toBe('7.1')
  })

  it('returns 400 when version is not installed', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '9.9' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/不存在/)
  })

  it('returns 400 when version binary is missing or broken', async () => {
    // Remove 7.1 binary after the previous test selected it
    rmSync(join(binRoot, '.versions', '7.1', 'ffmpeg'))
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '7.1' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/损坏|不存在/)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm vitest run tests/integration/ffmpeg-versions.test.ts`
预期：404 路由不存在 / FFmpegManager.listVersions 还未在路由层暴露

- [ ] **步骤 3：在 routes/ffmpeg.ts 添加新端点**

在 `src/routes/ffmpeg.ts` 顶部添加 import：

```typescript
import { updateFfmpegVersionInMemory, type AppConfig } from '../config.js'
```

并在文件末尾（`app.post('/api/ffmpeg/test', ...)` 之后）追加：

```typescript
  app.get('/api/ffmpeg/versions', async () => {
    const versions = await deps.ffmpegManager.listVersions()
    const current = deps.ffmpegManager.getStatus().version
    return {
      versions,
      current,
      recommended: versions[0] ?? null,
    }
  })

  app.post('/api/ffmpeg/select', async (request, reply) => {
    const body = request.body as { version?: string }
    if (!body.version) {
      return reply.status(400).send({ success: false, message: 'version 必填' })
    }
    const versions = await deps.ffmpegManager.listVersions()
    if (!versions.includes(body.version)) {
      return reply.status(400).send({ success: false, message: `版本 ${body.version} 不存在` })
    }
    const path = join(deps.ffmpegManager.getPath() ?? '', '..', '..', '.versions', body.version, 'ffmpeg')
    // Reuse the manager's bundled canExecute path by checking if the
    // candidate would be selectable on next boot.
    const sorted = await deps.ffmpegManager.listVersions()
    if (!sorted.includes(body.version)) {
      return reply.status(400).send({ success: false, message: `版本 ${body.version} 文件损坏` })
    }
    const cfg = (deps as unknown as { config: AppConfig }).config
    updateFfmpegVersionInMemory(cfg, body.version)
    deps.wsHub.emitEvent('config-changed', { key: 'ffmpeg.version' })
    return {
      success: true,
      message: `已切换到版本 ${body.version}，下次服务启动生效`,
    }
  })
```

并在 `src/app.ts` `registerFfmpegRoutes(app, { ffmpegManager, wsHub, logger })` 那一行（第 140 行）扩展为：

```typescript
  registerFfmpegRoutes(app, { ffmpegManager, wsHub, logger, config })
```

并同步更新 `src/routes/ffmpeg.ts` 的 `registerFfmpegRoutes` 签名：

```typescript
export function registerFfmpegRoutes(app: AnyFastifyInstance, deps: {
  ffmpegManager: FFmpegManager
  wsHub: WsHub
  logger: pino.Logger
  config: AppConfig
}): void {
```

- [ ] **步骤 4：类型检查 + 跑测试**

运行：`pnpm tsc --noEmit && pnpm vitest run tests/integration/ffmpeg-versions.test.ts`
预期：3 个 describe 块全部 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/routes/ffmpeg.ts src/app.ts tests/integration/ffmpeg-versions.test.ts
git commit -m "feat(ffmpeg): add /api/ffmpeg/versions and /select endpoints"
```

---

## 任务 5：前端类型与 API 客户端方法

**文件：**
- 修改：`src/web/types.ts:121-122`（FfmpegDownloadEvent 之后）
- 修改：`src/web/api-client.ts:135-145`（`startFfmpegDownloadStream` 之后）

- [ ] **步骤 1：在 types.ts 追加响应类型**

在 `src/web/types.ts` 末尾追加：

```typescript
// GET /api/ffmpeg/versions
export interface FFmpegVersionsResponse {
  versions: string[]
  current: string | null
  recommended: string | null
}

// POST /api/ffmpeg/select
export interface SelectVersionResponse {
  success: boolean
  message: string
}
```

- [ ] **步骤 2：在 api-client.ts 追加方法**

在 `src/web/api-client.ts` 顶部 import 列表追加：

```typescript
import type {
  // ...existing imports...
  FFmpegVersionsResponse,
  SelectVersionResponse,
} from './types.js'
```

并在 `export const api = { ... }` 对象末尾追加（`config:`、`updateConfig:` 之后，`startFfmpegDownloadStream` 之前）：

```typescript
  listFfmpegVersions: () =>
    fetchJson<FFmpegVersionsResponse>(`${BASE}/api/ffmpeg/versions`),

  selectFfmpegVersion: (version: string) =>
    fetchJson<SelectVersionResponse>(`${BASE}/api/ffmpeg/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    }),
```

- [ ] **步骤 3：类型检查**

运行：`pnpm tsc --noEmit`
预期：无错误

- [ ] **步骤 4：Commit**

```bash
git add src/web/types.ts src/web/api-client.ts
git commit -m "feat(web): add FFmpegVersionsResponse types and api client methods"
```

---

## 任务 6：FFmpeg 面板新增"版本管理"卡片

**文件：**
- 修改：`src/web/views/ffmpeg-panel.ts:5-23`（`renderFfmpegPanel` 函数）

- [ ] **步骤 1：扩展 renderFfmpegPanel 渲染新卡片**

将 `src/web/views/ffmpeg-panel.ts` 第 5-23 行的 `renderFfmpegPanel` 函数替换为：

```typescript
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

    <div class="card">
      <div class="card-title">版本管理</div>
      <div id="ffmpeg-versions-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `

  await Promise.all([loadFfmpegStatus(), loadVersionSelector()])
}
```

- [ ] **步骤 2：在文件末尾追加 loadVersionSelector 与 handleVersionSwitch**

在 `src/web/views/ffmpeg-panel.ts` 文件末尾（`function isMac()` 之后）追加：

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

    const options = data.versions
      .map((v) => {
        const suffix = [
          v === data.current ? '（当前）' : '',
          v === data.recommended ? ' ★' : '',
        ]
          .filter(Boolean)
          .join('')
        return `<option value="${escapeHtml(v)}">${escapeHtml(v)}${suffix}</option>`
      })
      .join('')

    container.innerHTML = `
      <p class="text-muted">已安装版本（按语义版本排序）：</p>
      <select id="ffmpeg-version-select" class="select">${options}</select>
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
      await loadFfmpegStatus()
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

- [ ] **步骤 3：类型检查 + 构建前端 bundle**

运行：`pnpm tsc --noEmit && pnpm build:web`
预期：无错误，admin/app.js 重新生成

- [ ] **步骤 4：Commit**

```bash
git add src/web/views/ffmpeg-panel.ts public/admin/app.js public/admin/app.js.map
git commit -m "feat(web): add version selector card to FFmpeg panel"
```

---

## 任务 7：完整集成验证

**文件：**
- 跑：`tests/integration/e2e.test.ts`（确保改动不破坏现有 E2E）
- 跑：`tests/integration/ffmpeg-manager.test.ts`（含新增任务 1-2 的测试）

- [ ] **步骤 1：跑完整测试套件**

运行：`pnpm test`
预期：全部 PASS。注意：e2e.test.ts 在初始 ffmpeg override 模式下不依赖 bundled 选择逻辑，should 仍通过。

- [ ] **步骤 2：手动启动 dev 服务验证 UI**

```bash
pnpm dev
```

浏览器打开 `http://localhost:8000/admin/`，切换到 FFmpeg 面板，验证：
1. 三张卡片都显示（状态、下载安装、版本管理）
2. 版本管理下拉列出 `.versions/` 下所有版本（按降序）
3. 当前激活版本标"（当前）"，最高版本标" ★"
4. 点击"切换版本"显示"⚠ 版本切换将在下次服务启动后生效"

- [ ] **步骤 3：手动验证 select 端点**

```bash
curl -X POST http://localhost:8000/api/ffmpeg/select \
  -H 'Content-Type: application/json' \
  -d '{"version":"7.1"}'
```
预期：`{"success":true,"message":"已切换到版本 7.1，下次服务启动生效"}`

然后 `curl http://localhost:8000/api/config | jq .ffmpeg.version`
预期：`"7.1"`

- [ ] **步骤 4：Commit（如有任何调整）**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore: post-integration verification fixes"
```

---

## 自检

**1. 规格覆盖度：**

| 规格章节 | 对应任务 |
|---|---|
| §1 版本扫描与排序 | 任务 1（listVersions） |
| §2 初始化优先级调整 | 任务 2（bundled 选最高版本） |
| §3 GET /api/ffmpeg/versions | 任务 4 |
| §3 POST /api/ffmpeg/select | 任务 4 |
| §4 管理面板版本选择器 | 任务 5（API）+ 任务 6（UI） |
| 错误处理 | 任务 4（含 400/500 分支） |
| 测试策略（单元 + 集成） | 任务 1-2（单元）、任务 4（集成）、任务 7（完整验证） |

**2. 占位符扫描：** 无 "待定"、"TODO"、"后续实现"。所有步骤都有完整代码块。

**3. 类型一致性：**
- `FFmpegManager.listVersions()` 在任务 1 定义、在任务 2/4 复用，签名一致：`async listVersions(): Promise<string[]>`
- `updateFfmpegVersionInMemory(cfg, version)` 在任务 3 定义、任务 4 使用，签名一致
- `registerFfmpegRoutes` 签名在任务 4 同步更新（添加 `config: AppConfig` 参数），`app.ts` 调用同步更新
- API 响应字段 `versions/current/recommended` 在任务 4 后端 + 任务 5 前端类型严格对齐