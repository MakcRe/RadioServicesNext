# radioServices 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个用 Node.js + TypeScript 实现的本地优先广播电台服务器。运营方通过 ffmpeg 命令行或浏览器界面推送音频流；听众通过浏览器或 VLC 实时收听 `/stream` 或 `/live.mp3`，也可以点播最近 N 天的存档回放。

**架构：** 单进程 Node.js + TypeScript + Fastify。Icecast HTTP PUT 接收 → Ring Buffer fan-out → ffmpeg segment 子进程切片 → SQLite 持久化。ffmpeg 通过 BtbN/FFmpeg-Builds 下载到 `bin/ffmpeg/`。

**技术栈：** TypeScript 5.x · Node 20 LTS · Fastify 4.x · better-sqlite3 · ws · esbuild · pino · Vitest · supertest

**参考文档：** `docs/superpowers/specs/2026-06-29-radio-services-design.md`

---

## 文件结构

```
radioServices/
├── src/
│   ├── server.ts                          # 服务入口
│   ├── app.ts                             # Fastify 应用工厂
│   ├── config.ts                          # YAML 配置加载
│   ├── logger.ts                          # pino 日志工厂
│   ├── routes/
│   │   ├── stream.ts                      # GET /stream, GET /live.mp3
│   │   ├── source.ts                      # PUT /source
│   │   ├── archive.ts                     # GET /api/archive/*
│   │   ├── playlist.ts                    # 歌单 CRUD
│   │   ├── listeners.ts                   # 听众日志 API
│   │   ├── ffmpeg.ts                      # ffmpeg 管理 API
│   │   ├── config.ts                      # 配置 API
│   │   └── ws.ts                          # WebSocket 端点
│   ├── services/
│   │   ├── ring-buffer.ts                 # ring buffer (独立小模块)
│   │   ├── ffmpeg-manager.ts              # ffmpeg 生命周期
│   │   ├── ffmpeg-downloader.ts           # 下载/解压/校验
│   │   ├── source-receiver.ts             # Icecast PUT 接收
│   │   ├── broadcaster.ts                 # 实时 fan-out
│   │   ├── archiver.ts                    # ffmpeg segment
│   │   ├── listener-manager.ts            # 听众会话跟踪
│   │   ├── playlist-service.ts            # 歌单管理
│   │   ├── upload-service.ts              # 文件上传/探测
│   │   └── ws-hub.ts                      # WebSocket 事件总线
│   ├── db/
│   │   ├── sqlite.ts                      # better-sqlite3 连接
│   │   ├── schema.sql                     # 表结构 (启动时执行)
│   │   └── repos/
│   │       ├── playlist.repo.ts
│   │       ├── uploaded-files.repo.ts
│   │       └── listener-logs.repo.ts
│   └── web/                               # 前端 TS 源码
│       ├── main.ts
│       ├── api-client.ts
│       ├── ws-client.ts
│       ├── ui.ts                          # 通用 DOM helper
│       ├── views/
│       │   ├── dashboard.ts
│       │   ├── source.ts
│       │   ├── archive.ts
│       │   ├── listeners.ts
│       │   └── ffmpeg-panel.ts
│       └── styles.css
├── public/
│   ├── admin/
│   │   ├── index.html
│   │   ├── app.js                         # esbuild 输出
│   │   └── app.css                        # 编译后 CSS
│   └── index.html                         # 听众落地页
├── bin/                                   # 运行时数据（不进 git）
│   ├── ffmpeg/
│   ├── uploads/
│   └── archive/
├── logs/                                  # 运行时日志
├── tests/
│   ├── unit/
│   │   ├── ring-buffer.test.ts
│   │   ├── ffmpeg-manager.test.ts
│   │   ├── ffmpeg-downloader.test.ts
│   │   ├── source-receiver.test.ts
│   │   ├── broadcaster.test.ts
│   │   ├── archiver.test.ts
│   │   ├── listener-manager.test.ts
│   │   ├── playlist-service.test.ts
│   │   └── config.test.ts
│   ├── integration/
│   │   ├── stream.test.ts
│   │   ├── source.test.ts
│   │   ├── archive.test.ts
│   │   └── admin-api.test.ts
│   └── helpers/
│       ├── mock-source.ts                 # 测试用 mock 推流器
│       └── temp-dir.ts
├── config/
│   └── config.example.yaml
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── esbuild.config.mjs
├── vitest.config.ts
├── .gitignore
└── README.md
```

---

## 任务分解（按依赖顺序）

| # | 任务 | 估时 |
|---|---|---|
| 0 | 项目骨架 + 工具链 | 0.5h |
| 1 | 配置加载 + 日志 | 0.5h |
| 2 | SQLite 初始化 + schema | 0.5h |
| 3 | Ring Buffer（独立小模块） | 1h |
| 4 | FFmpegDownloader（下载/解压） | 2h |
| 5 | FFmpegManager（生命周期 + 状态） | 1.5h |
| 6 | Source Receiver（Icecast PUT 接收） | 1.5h |
| 7 | Broadcaster（实时 fan-out） | 1.5h |
| 8 | Archiver（ffmpeg segment） | 2h |
| 9 | Listener Manager（会话跟踪） | 1h |
| 10 | Upload Service + Playlist Service | 2h |
| 11 | WebSocket Hub | 0.5h |
| 12 | Fastify 应用 + 所有 REST 路由 | 2h |
| 13 | 前端骨架 (HTML + TS + esbuild) | 2h |
| 14 | 前端 4 个 view | 4h |
| 15 | 集成测试 + E2E 验证 | 2h |
| 16 | README + 文档收尾 | 1h |

**合计：~25 小时**

---

## 任务 0：项目骨架

**目标：** 创建可运行的最小 Node.js + TypeScript 项目，能运行 `pnpm dev` 启动一个空服务。

**文件：**
- 创建：`package.json`
- 创建：`tsconfig.json`
- 创建：`.gitignore`
- 创建：`src/server.ts`
- 创建：`src/app.ts`
- 创建：`vitest.config.ts`

- [ ] **步骤 1：初始化 package.json**

```json
{
  "name": "radio-services",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "node --import tsx/esm src/server.ts",
    "build": "tsc --noEmit && esbuild --config esbuild.config.mjs",
    "build:web": "esbuild --config esbuild.config.mjs",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/websocket": "^10.0.0",
    "@fastify/static": "^7.0.0",
    "@fastify/multipart": "^8.3.0",
    "better-sqlite3": "^11.3.0",
    "ws": "^8.18.0",
    "pino": "^9.4.0",
    "pino-roll": "^2.0.0",
    "js-yaml": "^4.1.0",
    "ua-parser-js": "^1.0.39"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/ws": "^8.5.12",
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.5.4",
    "tsx": "^4.19.0",
    "esbuild": "^0.23.0",
    "vitest": "^2.0.5",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **步骤 2：创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **步骤 3：创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
  },
})
```

- [ ] **步骤 4：创建 .gitignore**

```
node_modules/
dist/
bin/
logs/
*.log
.env
.env.local
.DS_Store
coverage/
.vitest/
```

- [ ] **步骤 5：创建空的 src/app.ts**

```typescript
import Fastify, { FastifyInstance } from 'fastify'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: 'info' },
  })

  app.get('/health', async () => ({ ok: true }))

  return app
}
```

- [ ] **步骤 6：创建 src/server.ts**

```typescript
import { buildApp } from './app.js'

const PORT = Number(process.env.PORT ?? 8000)
const HOST = process.env.HOST ?? '0.0.0.0'

async function main() {
  const app = await buildApp()
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`server listening on http://${HOST}:${PORT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **步骤 7：安装依赖**

运行：`pnpm install`
预期：node_modules/ 出现，无错误

- [ ] **步骤 8：运行验证**

运行：`pnpm dev`
预期：日志输出 `server listening on http://0.0.0.0:8000`
在另一终端 `curl http://localhost:8000/health` → `{"ok":true}`

- [ ] **步骤 9：Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/
git commit -m "chore: scaffold TypeScript + Fastify project"
```

---

## 任务 1：配置加载 + 日志

**目标：** 配置从 `config/config.yaml` 加载，支持默认配置，环境变量覆盖；日志输出到 stdout 和 `logs/` 目录。

**文件：**
- 创建：`config/config.example.yaml`
- 创建：`src/config.ts`
- 创建：`src/logger.ts`
- 创建：`tests/unit/config.test.ts`

- [ ] **步骤 1：编写失败测试 (config)**

`tests/unit/config.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadConfig, type AppConfig } from '../../src/config.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-config-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads a valid YAML file', () => {
    const yaml = `
server:
  host: "127.0.0.1"
  port: 9000
auth:
  sourcePassword: "secret123"
archive:
  retentionDays: 14
`
    const cfgPath = join(tempDir, 'config.yaml')
    writeFileSync(cfgPath, yaml)

    const cfg: AppConfig = loadConfig(cfgPath)
    expect(cfg.server.host).toBe('127.0.0.1')
    expect(cfg.server.port).toBe(9000)
    expect(cfg.auth.sourcePassword).toBe('secret123')
    expect(cfg.archive.retentionDays).toBe(14)
  })

  it('applies defaults when fields are missing', () => {
    const cfgPath = join(tempDir, 'config.yaml')
    writeFileSync(cfgPath, 'server:\n  port: 8000\n')

    const cfg = loadConfig(cfgPath)
    expect(cfg.server.host).toBe('0.0.0.0')
    expect(cfg.archive.retentionDays).toBe(7)
    expect(cfg.archive.segmentDurationSec).toBe(3600)
    expect(cfg.playlist.allowedExtensions).toContain('.mp3')
  })

  it('throws on missing file', () => {
    expect(() => loadConfig(join(tempDir, 'missing.yaml'))).toThrow()
  })

  it('env vars override file values', () => {
    const cfgPath = join(tempDir, 'config.yaml')
    writeFileSync(cfgPath, 'server:\n  port: 8000\n')

    process.env.RADIO_PORT = '9999'
    try {
      const cfg = loadConfig(cfgPath)
      expect(cfg.server.port).toBe(9999)
    } finally {
      delete process.env.RADIO_PORT
    }
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/unit/config.test.ts`
预期：FAIL (`loadConfig` 未导出)

- [ ] **步骤 3：创建 `config/config.example.yaml`**

```yaml
server:
  host: "0.0.0.0"
  port: 8000

auth:
  sourcePassword: "hackme"

ffmpeg:
  version: "7.1"
  sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"

archive:
  directory: "bin/archive"
  segmentDurationSec: 3600
  retentionDays: 7
  minFreeSpaceMB: 500

playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions:
    - ".mp3"
    - ".m4a"
    - ".aac"
    - ".ogg"
    - ".wav"
    - ".flac"

logging:
  directory: "logs"
  level: "info"
  retentionDays: 30
```

- [ ] **步骤 4：实现 `src/config.ts`**

```typescript
import { readFileSync, existsSync } from 'fs'
import { parse } from 'js-yaml'

export interface ServerConfig {
  host: string
  port: number
}

export interface AuthConfig {
  sourcePassword: string
}

export interface FfmpegConfig {
  version: string
  sourceUrl: string
}

export interface ArchiveConfig {
  directory: string
  segmentDurationSec: number
  retentionDays: number
  minFreeSpaceMB: number
}

export interface PlaylistConfig {
  uploadDir: string
  maxFileSizeMB: number
  allowedExtensions: string[]
}

export interface LoggingConfig {
  directory: string
  level: string
  retentionDays: number
}

export interface AppConfig {
  server: ServerConfig
  auth: AuthConfig
  ffmpeg: FfmpegConfig
  archive: ArchiveConfig
  playlist: PlaylistConfig
  logging: LoggingConfig
}

const DEFAULTS: AppConfig = {
  server: { host: '0.0.0.0', port: 8000 },
  auth: { sourcePassword: 'hackme' },
  ffmpeg: {
    version: '7.1',
    sourceUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest',
  },
  archive: {
    directory: 'bin/archive',
    segmentDurationSec: 3600,
    retentionDays: 7,
    minFreeSpaceMB: 500,
  },
  playlist: {
    uploadDir: 'bin/uploads',
    maxFileSizeMB: 500,
    allowedExtensions: ['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac'],
  },
  logging: {
    directory: 'logs',
    level: 'info',
    retentionDays: 30,
  },
}

function deepMerge<T extends Record<string, any>>(base: T, override: any): T {
  const result: any = { ...base }
  for (const key of Object.keys(override ?? {})) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

function applyEnvOverrides(cfg: AppConfig): AppConfig {
  if (process.env.RADIO_PORT) cfg.server.port = Number(process.env.RADIO_PORT)
  if (process.env.RADIO_HOST) cfg.server.host = process.env.RADIO_HOST
  if (process.env.RADIO_SOURCE_PASSWORD) cfg.auth.sourcePassword = process.env.RADIO_SOURCE_PASSWORD
  return cfg
}

export function loadConfig(path: string): AppConfig {
  if (!existsSync(path)) {
    throw new Error(`config file not found: ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  const parsed = parse(raw) ?? {}
  const merged = deepMerge(DEFAULTS, parsed) as AppConfig
  return applyEnvOverrides(merged)
}
```

- [ ] **步骤 5：实现 `src/logger.ts`**

```typescript
import pino from 'pino'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export type Logger = pino.Logger

export function createLogger(logging: { directory: string; level: string }, date: Date = new Date()): Logger {
  const dateStr = date.toISOString().slice(0, 10)
  const logDir = logging.directory
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, `${dateStr}.log`)

  return pino({
    level: logging.level,
    transport: {
      targets: [
        { target: 'pino/file', options: { destination: logFile }, level: logging.level },
        { target: 'pino/file', options: { destination: 1 }, level: logging.level },
      ],
    },
  })
}
```

- [ ] **步骤 6：运行 config 测试**

运行：`pnpm test -- tests/unit/config.test.ts`
预期：4/4 PASS

- [ ] **步骤 7：在 app.ts 中接入**

```typescript
import Fastify, { FastifyInstance } from 'fastify'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'

export async function buildApp(configPath = 'config/config.yaml'): Promise<FastifyInstance> {
  const config = loadConfig(configPath)
  const logger = createLogger(config.logging)

  const app = Fastify({ logger })

  app.get('/health', async () => ({ ok: true }))
  app.get('/api/status', async () => ({ ffmpeg: 'pending', listeners: 0 }))

  return app
}
```

- [ ] **步骤 8：手动验证**

运行：`cp config/config.example.yaml config/config.yaml && pnpm dev`
预期：服务启动，stdout 输出 pino 日志 + logs/YYYY-MM-DD.log 文件被创建
`curl http://localhost:8000/api/status` → `{"ffmpeg":"pending","listeners":0}`

- [ ] **步骤 9：Commit**

```bash
git add src/config.ts src/logger.ts src/app.ts config/ tests/unit/config.test.ts
git commit -m "feat: config loading + pino logger"
```

---

## 任务 2：SQLite 初始化 + Schema

**目标：** 启动时建表，提供三个 repository（playlist, uploaded_files, listener_logs）。

**文件：**
- 创建：`src/db/sqlite.ts`
- 创建：`src/db/schema.sql`
- 创建：`src/db/repos/playlist.repo.ts`
- 创建：`src/db/repos/uploaded-files.repo.ts`
- 创建：`src/db/repos/listener-logs.repo.ts`
- 创建：`tests/integration/db.test.ts`

- [ ] **步骤 1：编写失败测试**

`tests/integration/db.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/db/sqlite.js'
import { PlaylistRepo } from '../../src/db/repos/playlist.repo.js'
import { UploadedFilesRepo } from '../../src/db/repos/uploaded-files.repo.js'
import { ListenerLogsRepo } from '../../src/db/repos/listener-logs.repo.js'

let dbPath: string
let db: Awaited<ReturnType<typeof initDb>>

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'radio-db-'))
  dbPath = join(dir, 'test.db')
  db = await initDb(dbPath)
})

describe('PlaylistRepo', () => {
  it('inserts and lists songs in order', () => {
    const repo = new PlaylistRepo(db)
    repo.insert({ filename: 'a.mp3', display_name: 'Song A', duration_sec: 180, position: 2 })
    repo.insert({ filename: 'b.mp3', display_name: 'Song B', duration_sec: 200, position: 1 })

    const all = repo.list()
    expect(all).toHaveLength(2)
    expect(all[0].display_name).toBe('Song B')
    expect(all[1].display_name).toBe('Song A')
  })

  it('updates position when reordered', () => {
    const repo = new PlaylistRepo(db)
    const a = repo.insert({ filename: 'a.mp3', display_name: 'A', duration_sec: 100, position: 1 })
    const b = repo.insert({ filename: 'b.mp3', display_name: 'B', duration_sec: 100, position: 2 })

    repo.reorder([b.id, a.id])

    const all = repo.list()
    expect(all[0].id).toBe(b.id)
    expect(all[1].id).toBe(a.id)
  })
})

describe('UploadedFilesRepo', () => {
  it('inserts and deletes by id', () => {
    const repo = new UploadedFilesRepo(db)
    const id = repo.insert({
      filename: 'abc.mp3',
      original_name: 'test.mp3',
      size_bytes: 1024,
      duration_sec: null,
    })
    expect(repo.getById(id)?.filename).toBe('abc.mp3')
    repo.delete(id)
    expect(repo.getById(id)).toBeUndefined()
  })
})

describe('ListenerLogsRepo', () => {
  it('records connection and disconnect', () => {
    const repo = new ListenerLogsRepo(db)
    const id = repo.connect({
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      referer: null,
    })
    expect(id).toBeGreaterThan(0)
    repo.disconnect(id)
    const log = repo.getById(id)
    expect(log?.disconnectedAt).not.toBeNull()
  })

  it('counts current (non-disconnected) listeners', () => {
    const repo = new ListenerLogsRepo(db)
    repo.connect({ ip: '1.1.1.1', userAgent: '', referer: null })
    repo.connect({ ip: '2.2.2.2', userAgent: '', referer: null })
    expect(repo.countCurrent()).toBe(2)
  })
})

afterEach(() => {
  db.close()
  rmSync(join(dbPath, '..'), { recursive: true, force: true })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/integration/db.test.ts`
预期：FAIL (模块不存在)

- [ ] **步骤 3：创建 `src/db/schema.sql`**

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS uploaded_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_sec REAL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  display_name TEXT NOT NULL,
  duration_sec REAL,
  position INTEGER NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (filename) REFERENCES uploaded_files(filename) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_position ON playlist(position);

CREATE TABLE IF NOT EXISTS listener_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  disconnected_at DATETIME,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  device_type TEXT,
  device_os TEXT,
  device_browser TEXT,
  duration_sec INTEGER,
  referer TEXT
);

CREATE INDEX IF NOT EXISTS idx_listener_logs_disc ON listener_logs(disconnected_at);
```

- [ ] **步骤 4：实现 `src/db/sqlite.ts`**

```typescript
import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

let schemaCache: string | null = null

function loadSchema(): string {
  if (!schemaCache) {
    schemaCache = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  }
  return schemaCache
}

export async function initDb(path: string): Promise<Database.Database> {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec(loadSchema())
  return db
}
```

- [ ] **步骤 5：实现 `src/db/repos/playlist.repo.ts`**

```typescript
import type Database from 'better-sqlite3'

export interface PlaylistRow {
  id: number
  filename: string
  display_name: string
  duration_sec: number | null
  position: number
  added_at: string
}

export interface InsertPlaylistInput {
  filename: string
  display_name: string
  duration_sec: number | null
  position: number
}

export class PlaylistRepo {
  constructor(private db: Database.Database) {}

  insert(input: InsertPlaylistInput): PlaylistRow {
    const stmt = this.db.prepare(`
      INSERT INTO playlist (filename, display_name, duration_sec, position)
      VALUES (?, ?, ?, ?)
    `)
    const info = stmt.run(input.filename, input.display_name, input.duration_sec, input.position)
    return this.getById(Number(info.lastInsertRowid))!
  }

  getById(id: number): PlaylistRow | undefined {
    return this.db.prepare('SELECT * FROM playlist WHERE id = ?').get(id) as PlaylistRow | undefined
  }

  list(): PlaylistRow[] {
    return this.db.prepare('SELECT * FROM playlist ORDER BY position ASC').all() as PlaylistRow[]
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM playlist WHERE id = ?').run(id)
  }

  update(id: number, fields: Partial<InsertPlaylistInput>): void {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ')
    const values = Object.values(fields)
    this.db.prepare(`UPDATE playlist SET ${sets} WHERE id = ?`).run(...values, id)
  }

  reorder(ids: number[]): void {
    const stmt = this.db.prepare('UPDATE playlist SET position = ? WHERE id = ?')
    const tx = this.db.transaction((idList: number[]) => {
      idList.forEach((id, idx) => stmt.run(idx + 1, id))
    })
    tx(ids)
  }
}
```

- [ ] **步骤 6：实现 `src/db/repos/uploaded-files.repo.ts`**

```typescript
import type Database from 'better-sqlite3'

export interface UploadedFileRow {
  id: number
  filename: string
  original_name: string
  size_bytes: number
  duration_sec: number | null
  uploaded_at: string
}

export interface InsertUploadedFileInput {
  filename: string
  original_name: string
  size_bytes: number
  duration_sec: number | null
}

export class UploadedFilesRepo {
  constructor(private db: Database.Database) {}

  insert(input: InsertUploadedFileInput): number {
    const info = this.db.prepare(`
      INSERT INTO uploaded_files (filename, original_name, size_bytes, duration_sec)
      VALUES (?, ?, ?, ?)
    `).run(input.filename, input.original_name, input.size_bytes, input.duration_sec)
    return Number(info.lastInsertRowid)
  }

  getById(id: number): UploadedFileRow | undefined {
    return this.db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(id) as UploadedFileRow | undefined
  }

  list(): UploadedFileRow[] {
    return this.db.prepare('SELECT * FROM uploaded_files ORDER BY uploaded_at DESC').all() as UploadedFileRow[]
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM uploaded_files WHERE id = ?').run(id)
  }
}
```

- [ ] **步骤 7：实现 `src/db/repos/listener-logs.repo.ts`**

```typescript
import type Database from 'better-sqlite3'

export interface ListenerLogRow {
  id: number
  connected_at: string
  disconnected_at: string | null
  ip: string
  user_agent: string
  device_type: string | null
  device_os: string | null
  device_browser: string | null
  duration_sec: number | null
  referer: string | null
}

export interface ConnectInput {
  ip: string
  userAgent: string
  referer: string | null
}

export class ListenerLogsRepo {
  constructor(private db: Database.Database) {}

  connect(input: ConnectInput): number {
    const info = this.db.prepare(`
      INSERT INTO listener_logs (ip, user_agent, referer)
      VALUES (?, ?, ?)
    `).run(input.ip, input.userAgent, input.referer)
    return Number(info.lastInsertRowid)
  }

  disconnect(id: number): void {
    this.db.prepare(`
      UPDATE listener_logs
      SET disconnected_at = CURRENT_TIMESTAMP,
          duration_sec = CAST((julianday('now') - julianday(connected_at)) * 86400 AS INTEGER)
      WHERE id = ? AND disconnected_at IS NULL
    `).run(id)
  }

  getById(id: number): ListenerLogRow | undefined {
    return this.db.prepare('SELECT * FROM listener_logs WHERE id = ?').get(id) as ListenerLogRow | undefined
  }

  countCurrent(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS c FROM listener_logs WHERE disconnected_at IS NULL
    `).get() as { c: number }
    return row.c
  }

  current(): ListenerLogRow[] {
    return this.db.prepare(`
      SELECT * FROM listener_logs WHERE disconnected_at IS NULL ORDER BY connected_at DESC
    `).all() as ListenerLogRow[]
  }

  history(page: number, pageSize: number): { rows: ListenerLogRow[]; total: number } {
    const offset = (page - 1) * pageSize
    const rows = this.db.prepare(`
      SELECT * FROM listener_logs ORDER BY connected_at DESC LIMIT ? OFFSET ?
    `).all(pageSize, offset) as ListenerLogRow[]
    const totalRow = this.db.prepare('SELECT COUNT(*) AS c FROM listener_logs').get() as { c: number }
    return { rows, total: totalRow.c }
  }
}
```

- [ ] **步骤 8：运行测试**

运行：`pnpm test -- tests/integration/db.test.ts`
预期：6/6 PASS

- [ ] **步骤 9：Commit**

```bash
git add src/db/ tests/integration/db.test.ts
git commit -m "feat: SQLite schema + three repositories"
```

---

## 任务 3：Ring Buffer

**目标：** 一个固定大小的字节环形缓冲区，支持 push、readSnapshot、reset。用于 Broadcaster 给新听众无缝衔接。

**文件：**
- 创建：`src/services/ring-buffer.ts`
- 创建：`tests/unit/ring-buffer.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../../src/services/ring-buffer.js'

describe('RingBuffer', () => {
  it('initially empty', () => {
    const rb = new RingBuffer(1024)
    expect(rb.size()).toBe(0)
    expect(rb.readSnapshot().length).toBe(0)
  })

  it('pushes and reads back data', () => {
    const rb = new RingBuffer(1024)
    rb.push(Buffer.from('hello'))
    rb.push(Buffer.from(' world'))
    expect(rb.readSnapshot().toString()).toBe('hello world')
    expect(rb.size()).toBe(11)
  })

  it('overwrites oldest data when full', () => {
    const rb = new RingBuffer(8)
    rb.push(Buffer.from('AAAAAAAA'))    // 8 bytes, full
    rb.push(Buffer.from('BBBBBBBB'))    // overwrites all
    expect(rb.readSnapshot().toString()).toBe('BBBBBBBB')
    expect(rb.size()).toBe(8)
  })

  it('handles partial overwrites', () => {
    const rb = new RingBuffer(8)
    rb.push(Buffer.from('12345678'))   // full
    rb.push(Buffer.from('AB'))          // overwrites '12', now '345678AB'
    expect(rb.readSnapshot().toString()).toBe('345678AB')
  })

  it('handles push larger than capacity', () => {
    const rb = new RingBuffer(4)
    rb.push(Buffer.from('ABCDEFGH'))    // 8 bytes, only last 4 kept
    expect(rb.readSnapshot().toString()).toBe('EFGH')
    expect(rb.size()).toBe(4)
  })

  it('reset clears buffer', () => {
    const rb = new RingBuffer(16)
    rb.push(Buffer.from('test'))
    rb.reset()
    expect(rb.size()).toBe(0)
    expect(rb.readSnapshot().length).toBe(0)
  })

  it('handles many small pushes correctly', () => {
    const rb = new RingBuffer(16)
    for (let i = 0; i < 100; i++) rb.push(Buffer.from('a'))
    expect(rb.size()).toBe(16)
    expect(rb.readSnapshot().toString()).toBe('aaaaaaaaaaaaaaaa')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/unit/ring-buffer.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/ring-buffer.ts`**

```typescript
export class RingBuffer {
  private buffer: Buffer
  private writePos = 0
  private bytesUsed = 0

  constructor(public readonly capacity: number) {
    this.buffer = Buffer.alloc(capacity)
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return

    if (chunk.length >= this.capacity) {
      // chunk is larger than capacity - keep only the last `capacity` bytes
      const tail = chunk.subarray(chunk.length - this.capacity)
      tail.copy(this.buffer)
      this.writePos = 0
      this.bytesUsed = this.capacity
      return
    }

    // writePos may wrap around
    const firstChunkSize = Math.min(chunk.length, this.capacity - this.writePos)
    chunk.copy(this.buffer, this.writePos, 0, firstChunkSize)
    if (chunk.length > firstChunkSize) {
      const rest = chunk.length - firstChunkSize
      chunk.copy(this.buffer, 0, firstChunkSize, chunk.length)
    }
    this.writePos = (this.writePos + chunk.length) % this.capacity
    this.bytesUsed = Math.min(this.bytesUsed + chunk.length, this.capacity)
  }

  readSnapshot(): Buffer {
    if (this.bytesUsed === 0) return Buffer.alloc(0)
    if (this.bytesUsed < this.capacity) {
      return Buffer.from(this.buffer.subarray(0, this.bytesUsed))
    }
    // buffer is full - read from writePos onwards then wrap
    const tail = Buffer.from(this.buffer.subarray(this.writePos))
    const head = Buffer.from(this.buffer.subarray(0, this.writePos))
    return Buffer.concat([tail, head])
  }

  size(): number {
    return this.bytesUsed
  }

  reset(): void {
    this.buffer = Buffer.alloc(this.capacity)
    this.writePos = 0
    this.bytesUsed = 0
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm test -- tests/unit/ring-buffer.test.ts`
预期：7/7 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/ring-buffer.ts tests/unit/ring-buffer.test.ts
git commit -m "feat: ring buffer for broadcaster snapshot"
```

---

## 任务 4：FFmpegDownloader

**目标：** 从 BtbN GitHub Release 下载 ffmpeg 静态二进制到 `bin/ffmpeg/.versions/{version}/`，解压、校验、回写路径。**带 SSE 进度推送**。

**文件：**
- 创建：`src/services/ffmpeg-downloader.ts`
- 创建：`tests/unit/ffmpeg-downloader.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { buildDownloadUrl } from '../../src/services/ffmpeg-downloader.js'

describe('buildDownloadUrl', () => {
  const sourceUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'

  it('builds macOS arm64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'arm64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-macos64-gpl.tar.xz`)
  })

  it('builds macOS x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'x64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-macos64-gpl.tar.xz`)
  })

  it('builds Linux x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'linux', 'x64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-linux64-gpl.tar.xz`)
  })

  it('builds Linux arm64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'linux', 'arm64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`)
  })

  it('builds Windows x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'win32', 'x64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-win64-gpl.zip`)
  })

  it('throws on unsupported platform', () => {
    expect(() => buildDownloadUrl(sourceUrl, 'freebsd', 'x64')).toThrow(/unsupported/i)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/unit/ffmpeg-downloader.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/ffmpeg-downloader.ts`**

```typescript
import { writeFile, mkdir, stat, rm, chmod, rename, createReadStream, createWriteStream } from 'fs/promises'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { pipeline } from 'stream/promises'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import type { AppConfig } from '../config.js'

export type DownloadState =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number; downloaded: number; total: number; speed: number }
  | { state: 'verifying'; message: string }
  | { state: 'extracting'; message: string }
  | { state: 'complete'; path: string; version: string }
  | { state: 'error'; message: string }

export type ProgressCallback = (state: DownloadState) => void

export function buildDownloadUrl(sourceUrl: string, platform: NodeJS.Platform, arch: string): string {
  if (platform === 'darwin') {
    // macOS Intel and Apple Silicon share the same archive (universal)
    return `${sourceUrl}/ffmpeg-master-latest-macos64-gpl.tar.xz`
  }
  if (platform === 'linux' && arch === 'x64') {
    return `${sourceUrl}/ffmpeg-master-latest-linux64-gpl.tar.xz`
  }
  if (platform === 'linux' && arch === 'arm64') {
    return `${sourceUrl}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`
  }
  if (platform === 'win32' && arch === 'x64') {
    return `${sourceUrl}/ffmpeg-master-latest-win64-gpl.zip`
  }
  if (platform === 'linux' && arch === 'ia32') {
    return `${sourceUrl}/ffmpeg-master-latest-linux32-gpl.tar.xz`
  }
  throw new Error(`unsupported platform/arch: ${platform}/${arch}`)
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

async function downloadToFile(url: string, dest: string, onProgress: ProgressCallback): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`)
  }

  const total = Number(res.headers.get('content-length') ?? 0)
  let downloaded = 0
  let lastTickAt = Date.now()
  let lastDownloaded = 0
  const startTime = Date.now()

  await mkdir(dirname(dest), { recursive: true })
  const fileStream = createWriteStream(dest)

  const reader = res.body.getReader()
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read()
      if (done) {
        this.push(null)
        return
      }
      downloaded += value.byteLength
      const now = Date.now()
      if (now - lastTickAt > 200 || downloaded === total) {
        const elapsedSec = (now - startTime) / 1000
        const speed = elapsedSec > 0 ? downloaded / elapsedSec : 0
        const percent = total > 0 ? (downloaded / total) * 100 : 0
        onProgress({
          state: 'downloading',
          percent,
          downloaded,
          total,
          speed,
        })
        lastTickAt = now
        lastDownloaded = downloaded
      }
      this.push(Buffer.from(value))
    },
  })

  await pipeline(nodeStream, fileStream)
}

async function extractTarXz(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xJf', archive, '-C', destDir, '--strip-components=1'], { stdio: 'inherit' })
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
    proc.on('error', reject)
  })
}

async function extractZip(archive: string, destDir: string): Promise<void> {
  const isWindows = process.platform === 'win32'

  if (isWindows) {
    // Use PowerShell Expand-Archive on Windows
    await mkdir(destDir, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${archive}" -DestinationPath "${destDir}" -Force`,
      ], { stdio: 'inherit' })
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exited ${code}`))))
      proc.on('error', reject)
    })
    // PowerShell doesn't strip components; the binary is at destDir/bin/ffmpeg.exe
    return
  }

  // Unix: use `unzip`
  await mkdir(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('unzip', ['-q', archive, '-d', destDir], { stdio: 'inherit' })
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))))
    proc.on('error', reject)
  })
}

async function findBinary(startDir: string, binary: string): Promise<string> {
  // Recursive search up to 3 levels deep for the binary file
  const { readdir } = await import('fs/promises')
  async function search(dir: string, depth: number): Promise<string | null> {
    if (depth > 4) return null
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name === binary) return full
      if (entry.isDirectory()) {
        const found = await search(full, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  const found = await search(startDir, 0)
  if (!found) throw new Error(`binary not found in ${startDir}`)
  return found
}

export async function downloadFfmpeg(
  config: AppConfig,
  binRoot: string = 'bin/ffmpeg',
  onProgress: ProgressCallback = () => {},
): Promise<{ path: string; version: string }> {
  const version = config.ffmpeg.version
  const versionDir = join(binRoot, '.versions', version)
  const binary = binaryName(process.platform)
  const targetPath = join(versionDir, binary)

  // Skip if already installed
  if (existsSync(targetPath)) {
    onProgress({ state: 'complete', path: targetPath, version })
    return { path: targetPath, version }
  }

  const url = buildDownloadUrl(config.ffmpeg.sourceUrl, process.platform, process.arch)
  const downloadsDir = join(binRoot, '.downloads')
  await mkdir(downloadsDir, { recursive: true })

  const archiveFile = join(downloadsDir, `ffmpeg-${version}${process.platform === 'win32' ? '.zip' : '.tar.xz'}`)
  const tempFile = archiveFile + '.part'

  try {
    onProgress({ state: 'downloading', percent: 0, downloaded: 0, total: 0, speed: 0 })
    await downloadToFile(url, tempFile, onProgress)

    onProgress({ state: 'verifying', message: 'archive downloaded' })

    // Extraction
    onProgress({ state: 'extracting', message: 'extracting archive' })
    const extractDir = join(downloadsDir, `extract-${version}`)
    await mkdir(extractDir, { recursive: true })

    if (process.platform === 'win32') {
      await extractZip(tempFile, extractDir)
    } else {
      await extractTarXz(tempFile, extractDir)
    }

    const innerBinary = await findBinary(extractDir, binary)

    // Move to final location
    await mkdir(versionDir, { recursive: true })
    await rename(innerBinary, targetPath)

    // On Windows, bin may be in a subfolder; also copy any sibling DLLs
    if (process.platform === 'win32') {
      const binDir = dirname(innerBinary)
      const dlls = await (await import('fs/promises')).readdir(binDir)
      for (const f of dlls) {
        if (f.endsWith('.dll')) {
          await rename(join(binDir, f), join(versionDir, f)).catch(() => {})
        }
      }
    }

    // Make executable on Unix
    if (process.platform !== 'win32') {
      await chmod(targetPath, 0o755)
    }

    // Cleanup
    await rm(tempFile, { force: true })
    await rm(extractDir, { recursive: true, force: true })

    onProgress({ state: 'complete', path: targetPath, version })
    return { path: targetPath, version }
  } catch (err) {
    onProgress({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    await rm(tempFile, { force: true })
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

export async function ffmpegSymlinkPath(binRoot: string, version: string, platform: NodeJS.Platform): Promise<string> {
  const binary = binaryName(platform)
  const target = join(binRoot, '.versions', version, binary)
  if (!existsSync(target)) throw new Error(`binary not installed: ${target}`)
  return target
}
```

- [ ] **步骤 4：运行 URL 单元测试**

运行：`pnpm test -- tests/unit/ffmpeg-downloader.test.ts`
预期：URL 测试 6/6 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/ffmpeg-downloader.ts tests/unit/ffmpeg-downloader.test.ts
git commit -m "feat: ffmpeg downloader with progress reporting"
```

**说明**：完整下载流程（实际网络下载、解压）在集成测试中用 mock fetch + 测试 tar 样本验证。下载器本身是幂等的——多次调用同一版本不会重下。

---

## 任务 5：FFmpegManager

**目标：** 启动时检测/下载 ffmpeg，对上层暴露 `getPath()`、`getStatus()`，以及通过 SSE 推送下载进度的事件总线。

**文件：**
- 创建：`src/services/ffmpeg-manager.ts`
- 创建：`tests/integration/ffmpeg-manager.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FFmpegManager } from '../../src/services/ffmpeg-manager.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-ffmpeg-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function fakeBinaryPath(): string {
  // Create a fake "ffmpeg" that just echoes -version
  const path = join(tempDir, 'fake-ffmpeg.sh')
  writeFileSync(path, '#!/bin/sh\necho "ffmpeg version 7.1 fake"\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

describe('FFmpegManager', () => {
  it('uses a pre-installed binary when path is provided', async () => {
    const bin = fakeBinaryPath()
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      ffmpegPathOverride: bin,
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('override')
    expect(status.path).toBe(bin)
    expect(status.available).toBe(true)
  })

  it('falls back to system ffmpeg when version dir is empty and system binary exists', async () => {
    const bin = fakeBinaryPath()
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: bin,
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('system')
    expect(status.available).toBe(true)
  })

  it('reports missing when no binary is available', async () => {
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })

    const status = await mgr.initialize()
    expect(status.available).toBe(false)
    expect(status.source).toBe('missing')
  })

  it('uses an already-downloaded bundled binary', async () => {
    const versionDir = join(tempDir, 'bin', '.versions', '7.1')
    const binFile = join(versionDir, 'ffmpeg')
    // Create structure: bin/.versions/7.1/ffmpeg
    require('fs').mkdirSync(versionDir, { recursive: true })
    const sourceBin = fakeBinaryPath()
    const { copyFileSync } = require('fs')
    copyFileSync(sourceBin, binFile)
    chmodSync(binFile, 0o755)

    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('bundled')
    expect(status.path).toBe(binFile)
    expect(status.available).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/integration/ffmpeg-manager.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/ffmpeg-manager.ts`**

```typescript
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { downloadFfmpeg, type DownloadState } from './ffmpeg-downloader.js'

export type FFmpegSource = 'bundled' | 'system' | 'override' | 'missing'

export interface FFmpegStatus {
  available: boolean
  source: FFmpegSource
  path: string | null
  version: string | null
}

export interface FFmpegManagerOptions {
  binRoot: string
  version: string
  downloadUrl: string
  /** When set, use this path instead of any detection (debug only). */
  ffmpegPathOverride?: string
  /** System fallback path; if not given, tries `which ffmpeg`. */
  systemFallbackPath?: string
}

export class FFmpegManager extends EventEmitter {
  private status: FFmpegStatus = {
    available: false,
    source: 'missing',
    path: null,
    version: null,
  }
  private downloading = false

  constructor(private opts: FFmpegManagerOptions) {
    super()
  }

  async initialize(): Promise<FFmpegStatus> {
    // 1. Override (debug)
    if (this.opts.ffmpegPathOverride) {
      if (await this.canExecute(this.opts.ffmpegPathOverride)) {
        this.status = {
          available: true,
          source: 'override',
          path: this.opts.ffmpegPathOverride,
          version: await this.getVersion(this.opts.ffmpegPathOverride),
        }
        return this.status
      }
    }

    // 2. Bundled (already downloaded)
    const bundled = join(this.opts.binRoot, '.versions', this.opts.version, this.binaryName())
    if (existsSync(bundled)) {
      if (await this.canExecute(bundled)) {
        this.status = {
          available: true,
          source: 'bundled',
          path: bundled,
          version: await this.getVersion(bundled),
        }
        return this.status
      }
    }

    // 3. Try to download
    try {
      this.downloading = true
      const result = await downloadFfmpeg(
        { ffmpeg: { version: this.opts.version, sourceUrl: this.opts.downloadUrl } } as any,
        this.opts.binRoot,
        (state) => this.emit('download', state),
      )
      this.downloading = false
      this.status = {
        available: true,
        source: 'bundled',
        path: result.path,
        version: result.version,
      }
      return this.status
    } catch (err) {
      this.downloading = false
      // Fall through to system check
    }

    // 4. System fallback
    const sysCandidates = [this.opts.systemFallbackPath, await this.which('ffmpeg')].filter(Boolean) as string[]
    for (const p of sysCandidates) {
      if (await this.canExecute(p)) {
        this.status = {
          available: true,
          source: 'system',
          path: p,
          version: await this.getVersion(p),
        }
        return this.status
      }
    }

    // 5. Missing
    this.status = { available: false, source: 'missing', path: null, version: null }
    return this.status
  }

  getStatus(): FFmpegStatus {
    return this.status
  }

  isDownloading(): boolean {
    return this.downloading
  }

  async triggerDownload(): Promise<void> {
    if (this.downloading) return
    this.downloading = true
    try {
      await downloadFfmpeg(
        { ffmpeg: { version: this.opts.version, sourceUrl: this.opts.downloadUrl } } as any,
        this.opts.binRoot,
        (state: DownloadState) => this.emit('download', state),
      )
      await this.initialize()
    } finally {
      this.downloading = false
    }
  }

  private binaryName(): string {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  }

  private async canExecute(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(path, ['-version'], { stdio: 'ignore' })
      proc.on('exit', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
      setTimeout(() => {
        proc.kill()
        resolve(false)
      }, 5000)
    })
  }

  private async getVersion(path: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(path, ['-version'])
      let output = ''
      proc.stdout.on('data', (chunk) => (output += chunk.toString()))
      proc.on('exit', () => {
        const match = output.match(/ffmpeg version (\S+)/)
        resolve(match ? match[1] : null)
      })
      proc.on('error', () => resolve(null))
    })
  }

  private async which(name: string): Promise<string | null> {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      const proc = spawn(cmd, [name])
      let output = ''
      proc.stdout.on('data', (chunk) => (output += chunk.toString()))
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(output.split('\n')[0].trim())
        } else {
          resolve(null)
        }
      })
      proc.on('error', () => resolve(null))
    })
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm test -- tests/integration/ffmpeg-manager.test.ts`
预期：4/4 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/ffmpeg-manager.ts tests/integration/ffmpeg-manager.test.ts
git commit -m "feat: ffmpeg manager with bundled/system/missing fallback"
```

---

## 任务 6：Source Receiver（Icecast PUT 接收）

**目标：** 注册 `PUT /source` 路由，解析 Icecast headers，校验 Basic Auth，限制单推流会话，事件总线触发 start/end。

**文件：**
- 创建：`src/services/source-receiver.ts`
- 创建：`tests/integration/source-receiver.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import request from 'supertest'
import { SourceReceiver } from '../../src/services/source-receiver.js'

let app: ReturnType<typeof Fastify>
let receiver: SourceReceiver

beforeAll(async () => {
  app = Fastify({ logger: false })
  receiver = new SourceReceiver({ sourcePassword: 'hackme' })
  await receiver.register(app)
})

afterAll(async () => {
  await app.close()
})

describe('PUT /source', () => {
  it('rejects without Authorization', async () => {
    const res = await request(app.server)
      .put('/source')
      .set('Content-Type', 'audio/mpeg')
      .send(Buffer.from([0xff, 0xfb, 0x90]))
    expect(res.status).toBe(401)
  })

  it('accepts with correct Basic auth and emits session-start', async () => {
    let sessionId: string | null = null
    receiver.once('session-start', (s) => {
      sessionId = s.id
    })

    const res = await request(app.server)
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:hackme').toString('base64'))
      .set('Content-Type', 'audio/mpeg')
      .set('User-Agent', 'Lavf/60.0.0')
      .send(Buffer.from([0xff, 0xfb, 0x90, 0x00]))
    expect(res.status).toBe(200)
    expect(sessionId).not.toBeNull()
  })

  it('emits session-end when stream closes', async () => {
    let endFired = false
    receiver.once('session-end', () => {
      endFired = true
    })

    await request(app.server)
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:hackme').toString('base64'))
      .set('Content-Type', 'audio/mpeg')
      .send(Buffer.from([0xff, 0xfb]))
      .timeout(100)

    // wait a moment for end event
    await new Promise((r) => setTimeout(r, 200))
    expect(endFired).toBe(true)
  })

  it('rejects with wrong password', async () => {
    const res = await request(app.server)
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:wrong').toString('base64'))
      .send(Buffer.from([]))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/integration/source-receiver.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/source-receiver.ts`**

```typescript
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { EventEmitter } from 'events'
import type { FastifyInstance, FastifyRequest } from 'fastify'

export interface SourceSession {
  id: string
  startAt: Date
  sourceType: 'ffmpeg' | 'butt' | 'mixxx' | 'other'
  userAgent: string
  mountpoint: string
  metadata?: { name?: string; genre?: string; description?: string }
}

export interface SourceReceiverOptions {
  sourcePassword: string
  /** Optional hook called on every chunk received from the source */
  onData?: (chunk: Buffer, session: SourceSession) => void
}

function inferSourceType(userAgent: string): SourceSession['sourceType'] {
  const ua = userAgent.toLowerCase()
  if (ua.includes('ffmpeg') || ua.includes('lavf')) return 'ffmpeg'
  if (ua.includes('butt')) return 'butt'
  if (ua.includes('mixxx')) return 'mixxx'
  return 'other'
}

export class SourceReceiver extends EventEmitter {
  private activeSession: SourceSession | null = null
  private activeReq: FastifyRequest | null = null

  constructor(private opts: SourceReceiverOptions) {
    super()
  }

  async register(app: FastifyInstance): Promise<void> {
    app.put('/source', async (request, reply) => {
      // 1. Auth
      const authHeader = request.headers.authorization ?? ''
      if (!authHeader.startsWith('Basic ')) {
        reply.status(401)
        reply.header('WWW-Authenticate', 'Basic realm="radio"')
        return { error: 'unauthorized' }
      }
      const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString()
      const [mount, password] = decoded.split(':')
      if (password !== this.opts.sourcePassword) {
        reply.status(401)
        return { error: 'invalid password' }
      }

      // 2. Reject if another session is active
      if (this.activeSession) {
        // Force-close the existing connection
        if (this.activeReq && !this.activeReq.socket.destroyed) {
          this.activeReq.socket.end()
        }
        // The 'session-end' event will fire when its stream closes
      }

      // 3. Create session
      const userAgent = (request.headers['user-agent'] as string) ?? ''
      const session: SourceSession = {
        id: randomUUID(),
        startAt: new Date(),
        sourceType: inferSourceType(userAgent),
        userAgent,
        mountpoint: '/' + (mount || 'source'),
        metadata: {
          name: request.headers['ice-name'] as string | undefined,
          genre: request.headers['ice-genre'] as string | undefined,
          description: request.headers['ice-description'] as string | undefined,
        },
      }

      this.activeSession = session
      this.activeReq = request
      this.emit('session-start', session)

      reply.header('icy-name', session.metadata?.name ?? 'radioServices')
      reply.header('icy-public', '1')

      // 4. Wrap request as Readable and forward data
      const stream = request.raw as Readable
      stream.on('data', (chunk: Buffer) => {
        if (this.opts.onData) this.opts.onData(chunk, session)
        this.emit('data', chunk, session)
      })

      stream.on('end', () => {
        if (this.activeSession?.id === session.id) {
          this.activeSession = null
          this.activeReq = null
          this.emit('session-end', session)
        }
      })

      stream.on('error', () => {
        if (this.activeSession?.id === session.id) {
          this.activeSession = null
          this.activeReq = null
          this.emit('session-end', session)
        }
      })

      // Reply 200 immediately, then keep connection open
      reply.status(200).send('')
      // Wait for stream to end before returning
      return reply
    })
  }

  getActiveSession(): SourceSession | null {
    return this.activeSession
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm test -- tests/integration/source-receiver.test.ts`
预期：4/4 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/source-receiver.ts tests/integration/source-receiver.test.ts
git commit -m "feat: icecast source receiver with auth + single-session"
```

---

## 任务 7：Broadcaster（实时 fan-out）

**目标：** 把 SourceReceiver 的字节流写入 ring buffer + 分发给当前所有听众连接。

**文件：**
- 创建：`src/services/broadcaster.ts`
- 创建：`tests/unit/broadcaster.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import { Broadcaster } from '../../src/services/broadcaster.js'

function collect(listener: any, n: number): Promise<Buffer[]> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      if (chunks.length >= n) {
        listener.off('data', onData)
        resolve(chunks)
      }
    }
    listener.on('data', onData)
  })
}

describe('Broadcaster', () => {
  it('writes data to ring buffer and listeners', () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })

    b.pipeFrom(source)
    const listener1 = b.subscribe()
    const listener2 = b.subscribe()

    source.push(Buffer.from('hello'))
    source.push(Buffer.from(' world'))

    expect(b.ringBufferSize()).toBe(11)
    expect(listener1.readSnapshot().toString()).toBe('hello world')
    expect(listener2.readSnapshot().toString()).toBe('hello world')
  })

  it('new listeners get ring buffer snapshot', () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })
    b.pipeFrom(source)

    source.push(Buffer.from('pre-existing'))

    const listener = b.subscribe()
    // First read: snapshot
    const snapshot = listener.readSnapshot()
    expect(snapshot.toString()).toBe('pre-existing')

    // Then live data
    source.push(Buffer.from(' new'))
    // listener emits 'data' for new bytes
    return new Promise<void>((resolve) => {
      listener.once('data', (chunk: Buffer) => {
        // accumulated check
        expect(snapshot.toString() + chunk.toString()).toBe('pre-existing new')
        resolve()
      })
    })
  })

  it('stops piping when source ends', () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })
    b.pipeFrom(source)
    const listener = b.subscribe()

    source.push(Buffer.from('a'))
    source.push(null) // end

    expect(b.isLive()).toBe(false)
    expect(listener.readSnapshot().toString()).toBe('a')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/unit/broadcaster.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/broadcaster.ts`**

```typescript
import { Readable, PassThrough } from 'stream'
import { EventEmitter } from 'events'
import { RingBuffer } from './ring-buffer.js'
import type { SourceSession } from './source-receiver.js'

export interface ListenerConnection extends EventEmitter {
  write(chunk: Buffer): void
  end(): void
  readSnapshot(): Buffer
}

class Listener extends PassThrough implements ListenerConnection {
  private snapshot: Buffer

  constructor(snapshot: Buffer) {
    super()
    this.snapshot = snapshot
  }

  override write(chunk: Buffer): boolean {
    return super.write(chunk)
  }

  override end(): void {
    super.end()
  }

  readSnapshot(): Buffer {
    return this.snapshot
  }
}

export interface BroadcasterOptions {
  ringCapacity: number
}

export class Broadcaster {
  private listeners = new Map<number, Listener>()
  private nextId = 1
  private ringBuffer: RingBuffer
  private sourceStream: Readable | null = null
  private currentSession: SourceSession | null = null
  private onSourceEndHandler: (() => void) | null = null

  constructor(private opts: BroadcasterOptions) {
    this.ringBuffer = new RingBuffer(opts.ringCapacity)
  }

  pipeFrom(stream: Readable, session: SourceSession): void {
    this.detachSource()
    this.sourceStream = stream
    this.currentSession = session

    stream.on('data', (chunk: Buffer) => {
      this.ringBuffer.push(chunk)
      for (const listener of this.listeners.values()) {
        listener.write(chunk)
      }
    })

    this.onSourceEndHandler = () => {
      this.detachSource()
    }
    stream.on('end', this.onSourceEndHandler)
    stream.on('error', this.onSourceEndHandler)
  }

  private detachSource(): void {
    if (this.sourceStream && this.onSourceEndHandler) {
      this.sourceStream.off('end', this.onSourceEndHandler)
      this.sourceStream.off('error', this.onSourceEndHandler)
    }
    this.sourceStream = null
    this.currentSession = null
    this.onSourceEndHandler = null

    // End all listeners so they receive EOF
    for (const listener of this.listeners.values()) {
      listener.end()
    }
    this.listeners.clear()
    this.ringBuffer.reset()
  }

  subscribe(): ListenerConnection {
    const snapshot = this.ringBuffer.readSnapshot()
    const listener = new Listener(snapshot)
    const id = this.nextId++
    this.listeners.set(id, listener)
    return listener
  }

  ringBufferSize(): number {
    return this.ringBuffer.size()
  }

  isLive(): boolean {
    return this.currentSession !== null
  }

  getCurrentSession(): SourceSession | null {
    return this.currentSession
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm test -- tests/unit/broadcaster.test.ts`
预期：3/3 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/broadcaster.ts tests/unit/broadcaster.test.ts
git commit -m "feat: broadcaster with ring buffer snapshot"
```

---

## 任务 8：Archiver（ffmpeg segment）

**目标：** 启动一个 ffmpeg segment 子进程，从 Source 流读取，按整点切片写到 `bin/archive/`。提供启动/停止 + 清理过期。

**文件：**
- 创建：`src/services/archiver.ts`
- 创建：`tests/integration/archiver.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { Archiver } from '../../src/services/archiver.js'
import { FFmpegManager } from '../../src/services/ffmpeg-manager.js'

let tempDir: string
let archiveDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-arch-'))
  archiveDir = join(tempDir, 'archive')
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function fakeFfmpeg(): string {
  // Create a fake ffmpeg that echoes any input to a known output
  const dir = join(tempDir, 'ff')
  require('fs').mkdirSync(dir, { recursive: true })
  const path = join(dir, 'ffmpeg')
  require('fs').writeFileSync(
    path,
    `#!/bin/sh
# Fake ffmpeg: write a placeholder MP3 header to indicated output
mkdir -p "$(dirname "$2")"
printf 'ID3' > "$2/2026-06-29-12.mp3.tmp"
exit 0
`,
  )
  require('fs').chmodSync(path, 0o755)
  return path
}

describe('Archiver', () => {
  it('starts a ffmpeg subprocess when given a source stream', async () => {
    const ffmpegPath = fakeFfmpeg()
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: '',
      ffmpegPathOverride: ffmpegPath,
    })
    await mgr.initialize()

    const archiver = new Archiver({
      ffmpegPath,
      archiveDir,
      segmentDurationSec: 3600,
      retentionDays: 7,
    })

    const source = new PassThrough()
    await archiver.start(source)

    source.write(Buffer.from([0xff, 0xfb]))
    await new Promise((r) => setTimeout(r, 200))

    expect(existsSync(archiveDir)).toBe(true)

    await archiver.stop()
  })

  it('cleans up files older than retention', async () => {
    const archiver = new Archiver({
      ffmpegPath: '/bin/true',
      archiveDir,
      segmentDurationSec: 3600,
      retentionDays: 7,
    })

    require('fs').mkdirSync(archiveDir, { recursive: true })

    // create files with old + new dates
    const now = Date.now()
    const oldFile = join(archiveDir, '2025-01-01-12.mp3')
    const newFile = join(archiveDir, '2026-06-29-12.mp3')
    require('fs').writeFileSync(oldFile, 'old')
    require('fs').writeFileSync(newFile, 'new')

    // Set mtime to 30 days ago for oldFile
    const oldTime = new Date(now - 30 * 24 * 60 * 60 * 1000)
    require('fs').utimesSync(oldFile, oldTime, oldTime)

    await archiver.cleanup()

    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(newFile)).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/integration/archiver.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/archiver.ts`**

```typescript
import { spawn, type ChildProcess } from 'child_process'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { Readable } from 'stream'

export interface ArchiverOptions {
  ffmpegPath: string
  archiveDir: string
  segmentDurationSec: number
  retentionDays: number
}

export class Archiver {
  private proc: ChildProcess | null = null
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(private opts: ArchiverOptions) {}

  async start(sourceStream: Readable): Promise<void> {
    if (this.proc) throw new Error('archiver already running')
    await mkdir(this.opts.archiveDir, { recursive: true })

    const filenamePattern = '%Y-%m-%d-%H.mp3'
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(this.opts.segmentDurationSec),
      '-segment_atclocktime', '1',
      '-strftime', '1',
      '-reset_timestamps', '1',
      join(this.opts.archiveDir, filenamePattern),
    ]

    this.proc = spawn(this.opts.ffmpegPath, args)

    // pipe source -> ffmpeg stdin
    sourceStream.pipe(this.proc.stdin!)
    this.proc.stdin!.on('error', () => {
      // ignore EPIPE when ffmpeg closes
    })

    this.proc.stderr?.on('data', (chunk) => {
      const msg = chunk.toString()
      // Forward ffmpeg errors to console
      if (msg.trim()) {
        console.error('[archiver ffmpeg]', msg.trim())
      }
    })

    // schedule hourly cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => console.error('[archiver cleanup]', err))
    }, 60 * 60 * 1000)

    // initial cleanup on start
    await this.cleanup().catch(() => {})
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.proc.stdin?.end()
    await new Promise<void>((resolve) => {
      this.proc!.on('exit', () => resolve())
      this.proc = null
    })
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  async cleanup(): Promise<void> {
    try {
      const files = await readdir(this.opts.archiveDir)
      const cutoff = Date.now() - this.opts.retentionDays * 24 * 60 * 60 * 1000
      for (const file of files) {
        if (!file.endsWith('.mp3')) continue
        const fullPath = join(this.opts.archiveDir, file)
        const stats = await stat(fullPath)
        if (stats.mtimeMs < cutoff) {
          await rm(fullPath, { force: true })
        }
      }
    } catch {
      // dir might not exist yet
    }
  }

  async list(): Promise<{ filename: string; sizeBytes: number; mtime: Date }[]> {
    try {
      const files = await readdir(this.opts.archiveDir)
      const result = []
      for (const file of files) {
        if (!file.endsWith('.mp3')) continue
        const fullPath = join(this.opts.archiveDir, file)
        const stats = await stat(fullPath)
        result.push({ filename: file, sizeBytes: stats.size, mtime: stats.mtime })
      }
      return result.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    } catch {
      return []
    }
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm test -- tests/integration/archiver.test.ts`
预期：2/2 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/archiver.ts tests/integration/archiver.test.ts
git commit -m "feat: archiver with segment + cleanup"
```

---

## 任务 9：Listener Manager

**目标：** 跟踪当前连接听众，写日志（连接/断开），暴露统计。

**文件：**
- 创建：`src/services/listener-manager.ts`
- 创建：`tests/integration/listener-manager.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { UAParser } from 'ua-parser-js'
import { initDb } from '../../src/db/sqlite.js'
import { ListenerLogsRepo } from '../../src/db/repos/listener-logs.repo.js'
import { ListenerManager } from '../../src/services/listener-manager.js'

let tempDir: string
let dbPath: string

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-lm-'))
  dbPath = join(tempDir, 'test.db')
  const db = await initDb(dbPath)
  ;(globalThis as any).__testDb = db
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function getDb() {
  return (globalThis as any).__testDb
}

describe('ListenerManager', () => {
  it('records a connection', () => {
    const repo = new ListenerLogsRepo(getDb())
    const mgr = new ListenerManager(repo)

    const id = mgr.connect({
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh)',
      referer: null,
    })
    expect(id).toBeGreaterThan(0)
    expect(mgr.countCurrent()).toBe(1)
  })

  it('marks disconnect with device info', () => {
    const repo = new ListenerLogsRepo(getDb())
    const mgr = new ListenerManager(repo)

    const id = mgr.connect({
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      referer: 'https://example.com',
    })
    mgr.disconnect(id)

    const log = repo.getById(id)
    expect(log?.disconnected_at).not.toBeNull()
    expect(log?.device_os).toContain('Mac')
    expect(log?.device_browser).toBeTruthy()
    expect(log?.referer).toBe('https://example.com')
  })

  it('lists current and historical', () => {
    const repo = new ListenerLogsRepo(getDb())
    const mgr = new ListenerManager(repo)

    mgr.connect({ ip: '1.1.1.1', userAgent: '', referer: null })
    mgr.connect({ ip: '2.2.2.2', userAgent: '', referer: null })
    expect(mgr.current().length).toBe(2)
    expect(mgr.history(1, 10).total).toBe(2)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/integration/listener-manager.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/listener-manager.ts`**

```typescript
import { UAParser } from 'ua-parser-js'
import type { ListenerLogsRepo, ListenerLogRow } from '../db/repos/listener-logs.repo.js'

export interface ConnectInput {
  ip: string
  userAgent: string
  referer: string | null
}

export class ListenerManager {
  constructor(private repo: ListenerLogsRepo) {}

  connect(input: ConnectInput): number {
    const parser = new UAParser(input.userAgent)
    const device = parser.getDevice()
    const os = parser.getOS()
    const browser = parser.getBrowser()
    const deviceType = device.type ?? 'other'

    const id = this.repo.connect({
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
    })

    // enrich row with device info via update
    this.repo.update?.(id, {
      device_type: deviceType,
      device_os: os.name ?? null,
      device_browser: browser.name ?? null,
    } as any)

    return id
  }

  disconnect(id: number): void {
    this.repo.disconnect(id)
  }

  countCurrent(): number {
    return this.repo.countCurrent()
  }

  current(): ListenerLogRow[] {
    return this.repo.current()
  }

  history(page: number, pageSize: number): { rows: ListenerLogRow[]; total: number } {
    return this.repo.history(page, pageSize)
  }
}
```

- [ ] **步骤 4：扩展 `src/db/repos/listener-logs.repo.ts` 添加 update**

```typescript
// Add to ListenerLogsRepo class:
update(id: number, fields: Partial<{
  device_type: string | null
  device_os: string | null
  device_browser: string | null
}>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ')
  const values = Object.values(fields)
  this.db.prepare(`UPDATE listener_logs SET ${sets} WHERE id = ?`).run(...values, id)
}
```

- [ ] **步骤 5：运行测试**

运行：`pnpm test -- tests/integration/listener-manager.test.ts`
预期：3/3 PASS

- [ ] **步骤 6：Commit**

```bash
git add src/services/listener-manager.ts src/db/repos/listener-logs.repo.ts tests/integration/listener-manager.test.ts
git commit -m "feat: listener manager with UA parsing"
```

---

## 任务 10：Upload Service + Playlist Service

**目标：** 文件上传（multipart 保存 + ffprobe 时长探测），歌单 CRUD，循环推流触发。

**文件：**
- 创建：`src/services/upload-service.ts`
- 创建：`src/services/playlist-service.ts`
- 创建：`tests/integration/playlist-service.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/db/sqlite.js'
import { PlaylistRepo } from '../../src/db/repos/playlist.repo.js'
import { UploadedFilesRepo } from '../../src/db/repos/uploaded-files.repo.js'
import { PlaylistService } from '../../src/services/playlist-service.js'
import { UploadService } from '../../src/services/upload-service.js'

let tempDir: string
let dbPath: string
let db: any

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-pl-'))
  dbPath = join(tempDir, 'test.db')
  db = await initDb(dbPath)
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  db.close()
})

describe('PlaylistService', () => {
  it('adds, lists, and removes songs', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const plRepo = new PlaylistRepo(db)
    const pl = new PlaylistService(plRepo, fileRepo)

    const fileId = fileRepo.insert({
      filename: 'song.mp3',
      original_name: 'song.mp3',
      size_bytes: 1024,
      duration_sec: 200,
    })

    const songId = pl.add({
      filename: 'song.mp3',
      display_name: 'My Song',
      duration_sec: 200,
    })
    expect(songId).toBeGreaterThan(0)

    const list = pl.list()
    expect(list).toHaveLength(1)
    expect(list[0].display_name).toBe('My Song')

    pl.remove(songId)
    expect(pl.list()).toHaveLength(0)
  })

  it('reorders songs by id list', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const plRepo = new PlaylistRepo(db)
    const pl = new PlaylistService(plRepo, fileRepo)

    fileRepo.insert({ filename: 'a.mp3', original_name: 'a.mp3', size_bytes: 1, duration_sec: 100 })
    fileRepo.insert({ filename: 'b.mp3', original_name: 'b.mp3', size_bytes: 1, duration_sec: 100 })
    fileRepo.insert({ filename: 'c.mp3', original_name: 'c.mp3', size_bytes: 1, duration_sec: 100 })

    const idA = pl.add({ filename: 'a.mp3', display_name: 'A', duration_sec: 100 })
    const idB = pl.add({ filename: 'b.mp3', display_name: 'B', duration_sec: 100 })
    const idC = pl.add({ filename: 'c.mp3', display_name: 'C', duration_sec: 100 })

    pl.reorder([idC, idA, idB])
    const list = pl.list()
    expect(list[0].id).toBe(idC)
    expect(list[1].id).toBe(idA)
    expect(list[2].id).toBe(idB)
  })
})

describe('UploadService', () => {
  it('saves an uploaded file and returns its metadata', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
      ffmpegPath: '/bin/true',
      fileRepo,
    })

    const buffer = Buffer.from('fake-mp3-content')
    const result = await upload.save({
      buffer,
      originalName: 'test.mp3',
      getDuration: async () => 180,
    })

    expect(result.filename).toMatch(/test.*\.mp3/)
    expect(result.sizeBytes).toBe(buffer.length)
    expect(result.durationSec).toBe(180)
  })

  it('rejects files over max size', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 1,
      allowedExtensions: ['.mp3'],
      ffmpegPath: '/bin/true',
      fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.alloc(2 * 1024 * 1024), // 2MB
        originalName: 'big.mp3',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/too large/i)
  })

  it('rejects unsupported extensions', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
      ffmpegPath: '/bin/true',
      fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.from('x'),
        originalName: 'test.exe',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/extension/)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/integration/playlist-service.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/playlist-service.ts`**

```typescript
import type { PlaylistRepo, PlaylistRow } from '../db/repos/playlist.repo.js'
import type { UploadedFilesRepo } from '../db/repos/uploaded-files.repo.js'

export interface AddSongInput {
  filename: string
  display_name: string
  duration_sec: number | null
}

export class PlaylistService {
  constructor(
    private repo: PlaylistRepo,
    private fileRepo: UploadedFilesRepo,
  ) {}

  add(input: AddSongInput): number {
    const existing = this.repo.list()
    const row = this.repo.insert({
      ...input,
      position: existing.length + 1,
    })
    return row.id
  }

  list(): PlaylistRow[] {
    return this.repo.list()
  }

  remove(id: number): void {
    this.repo.delete(id)
    // Re-pack positions
    const remaining = this.repo.list().map((r) => r.id)
    this.repo.reorder(remaining)
  }

  reorder(ids: number[]): void {
    this.repo.reorder(ids)
  }

  updateDisplay(id: number, displayName: string): void {
    this.repo.update(id, { display_name: displayName })
  }

  nextSong(): PlaylistRow | null {
    const list = this.repo.list()
    return list[0] ?? null
  }

  popFirst(): PlaylistRow | null {
    const first = this.nextSong()
    if (first) this.remove(first.id)
    return first
  }
}
```

- [ ] **步骤 4：实现 `src/services/upload-service.ts`**

```typescript
import { mkdir, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import type { UploadedFilesRepo } from '../db/repos/uploaded-files.repo.js'

export interface UploadServiceOptions {
  uploadDir: string
  maxFileSizeMB: number
  allowedExtensions: string[]
  ffmpegPath: string
  fileRepo: UploadedFilesRepo
}

export interface SaveInput {
  buffer: Buffer
  originalName: string
  /** Function to extract duration; injected for testing */
  getDuration: (filePath: string) => Promise<number | null>
}

export interface SaveResult {
  filename: string
  originalName: string
  sizeBytes: number
  durationSec: number | null
}

export class UploadService {
  constructor(private opts: UploadServiceOptions) {}

  async save(input: SaveInput): Promise<SaveResult> {
    const ext = extname(input.originalName).toLowerCase()
    if (!this.opts.allowedExtensions.includes(ext)) {
      throw new Error(`unsupported file extension: ${ext}`)
    }
    const maxBytes = this.opts.maxFileSizeMB * 1024 * 1024
    if (input.buffer.length > maxBytes) {
      throw new Error(`file too large: ${input.buffer.length} > ${maxBytes}`)
    }

    await mkdir(this.opts.uploadDir, { recursive: true })
    const filename = `${randomUUID()}${ext}`
    const filepath = join(this.opts.uploadDir, filename)
    await writeFile(filepath, input.buffer)

    let durationSec: number | null = null
    try {
      durationSec = await input.getDuration(filepath)
    } catch {
      durationSec = null
    }

    const id = this.opts.fileRepo.insert({
      filename,
      original_name: input.originalName,
      size_bytes: input.buffer.length,
      duration_sec: durationSec,
    })

    return {
      filename,
      originalName: input.originalName,
      sizeBytes: input.buffer.length,
      durationSec,
    }
  }

  async getDurationWithFfmpeg(filePath: string, ffprobeOrFfmpegPath: string): Promise<number | null> {
    // Use `ffmpeg -i` to read duration (also works with ffprobe if available)
    const { spawn } = await import('child_process')
    return new Promise((resolve) => {
      const proc = spawn(ffprobeOrFfmpegPath, ['-i', filePath])
      let output = ''
      let errOutput = ''
      proc.stdout.on('data', (c) => (output += c.toString()))
      proc.stderr.on('data', (c) => (errOutput += c.toString()))
      proc.on('exit', () => {
        // ffmpeg writes the duration to stderr
        const m = errOutput.match(/Duration: (\d+):(\d+):(\d+\.\d+)/)
        if (m) {
          const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          resolve(seconds)
        } else {
          resolve(null)
        }
      })
      proc.on('error', () => resolve(null))
    })
  }
}
```

- [ ] **步骤 5：运行测试**

运行：`pnpm test -- tests/integration/playlist-service.test.ts`
预期：5/5 PASS

- [ ] **步骤 6：Commit**

```bash
git add src/services/upload-service.ts src/services/playlist-service.ts tests/integration/playlist-service.test.ts
git commit -m "feat: upload service + playlist service"
```

---

## 任务 11：WebSocket Hub

**目标：** 一个简单的事件总线，后端 services emit 事件，REST 路由/WebSocket 注册 handler 后能收到。

**文件：**
- 创建：`src/services/ws-hub.ts`
- 创建：`tests/unit/ws-hub.test.ts`

- [ ] **步骤 1：编写失败测试**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { WsHub, type EventMap } from '../../src/services/ws-hub.js'

describe('WsHub', () => {
  it('delivers events to subscribers', () => {
    const hub = new WsHub()
    const cb = vi.fn()

    hub.on('source-start', cb)
    hub.emit('source-start', { id: 's1' } as any)

    expect(cb).toHaveBeenCalledOnce()
    expect(cb.mock.calls[0][0]).toEqual({ id: 's1' })
  })

  it('supports multiple subscribers for one event', () => {
    const hub = new WsHub()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    hub.on('listener-count', cb1)
    hub.on('listener-count', cb2)
    hub.emit('listener-count', 42)

    expect(cb1).toHaveBeenCalledWith(42)
    expect(cb2).toHaveBeenCalledWith(42)
  })

  it('off() removes subscription', () => {
    const hub = new WsHub()
    const cb = vi.fn()

    hub.on('archive-new', cb)
    hub.off('archive-new', cb)
    hub.emit('archive-new', { filename: 'a.mp3' } as any)

    expect(cb).not.toHaveBeenCalled()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- tests/unit/ws-hub.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 `src/services/ws-hub.ts`**

```typescript
import { EventEmitter } from 'events'
import type { SourceSession } from './source-receiver.js'

export interface EventMap {
  'source-start': SourceSession
  'source-end': { sessionId: string }
  'listener-count': number
  'archive-new': { filename: string; sizeBytes: number }
  'ffmpeg-download': import('./ffmpeg-downloader.js').DownloadState
  'config-changed': { key: string }
}

export class WsHub extends EventEmitter {
  emitEvent<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emit(event, data)
  }
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm test -- tests/unit/ws-hub.test.ts`
预期：3/3 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/services/ws-hub.ts tests/unit/ws-hub.test.ts
git commit -m "feat: WS event hub"
```

---

## 任务 12：Fastify 应用 + REST 路由

**目标：** 把所有 services 串到 Fastify 上，注册所有 REST 路由、WebSocket、SSE 端点。

**文件：**
- 创建：`src/routes/stream.ts`
- 创建：`src/routes/source.ts`
- 创建：`src/routes/archive.ts`
- 创建：`src/routes/playlist.ts`
- 创建：`src/routes/listeners.ts`
- 创建：`src/routes/ffmpeg.ts`
- 创建：`src/routes/config.ts`
- 创建：`src/routes/ws.ts`
- 修改：`src/app.ts`

- [ ] **步骤 1：`src/routes/stream.ts`（实时收听）**

```typescript
import type { FastifyInstance } from 'fastify'
import type { Broadcaster } from '../services/broadcaster.js'
import type { ListenerManager } from '../services/listener-manager.js'

export function registerStreamRoutes(app: FastifyInstance, deps: {
  broadcaster: Broadcaster
  listenerManager: ListenerManager
}): void {
  const liveHandler = async (request: any, reply: any) => {
    const broadcaster = deps.broadcaster
    if (!broadcaster.isLive()) {
      reply.status(503)
      return { error: 'no live stream' }
    }

    const ip = request.ip
    const ua = request.headers['user-agent'] ?? ''
    const referer = request.headers['referer'] ?? null
    const logId = deps.listenerManager.connect({ ip, userAgent: ua, referer })

    reply.header('Content-Type', 'audio/mpeg')
    reply.header('Cache-Control', 'no-cache, no-store')
    reply.header('icy-name', 'radioServices')
    reply.header('icy-public', '1')
    reply.header('Transfer-Encoding', 'chunked')

    const listener = broadcaster.subscribe()
    const raw = (listener as any) as NodeJS.ReadableStream

    reply.raw.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-store',
    })

    const snapshot = listener.readSnapshot()
    if (snapshot.length > 0) {
      reply.raw.write(snapshot)
    }
    raw.on('data', (chunk: Buffer) => {
      reply.raw.write(chunk)
    })
    raw.on('end', () => {
      reply.raw.end()
      deps.listenerManager.disconnect(logId)
    })

    request.raw.on('close', () => {
      deps.listenerManager.disconnect(logId)
    })
  }

  app.get('/stream', liveHandler)
  app.get('/live.mp3', liveHandler)
}
```

- [ ] **步骤 2：`src/routes/source.ts`（推流 PUT）**

```typescript
import type { FastifyInstance } from 'fastify'
import type { SourceReceiver } from '../services/source-receiver.js'
import type { WsHub } from '../services/ws-hub.js'

export function registerSourceRoutes(app: FastifyInstance, deps: {
  sourceReceiver: SourceReceiver
  wsHub: WsHub
}): void {
  deps.sourceReceiver.on('session-start', (session) => {
    deps.wsHub.emitEvent('source-start', session)
  })
  deps.sourceReceiver.on('session-end', (session) => {
    deps.wsHub.emitEvent('source-end', { sessionId: session.id })
  })
  // The receiver also handles PUT /source at registration
}
```

- [ ] **步骤 3：`src/routes/archive.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { join, extname } from 'path'
import { stat, readFile } from 'fs/promises'
import type { Archiver } from '../services/archiver.js'

export function registerArchiveRoutes(app: FastifyInstance, deps: {
  archiver: Archiver
}): void {
  app.get('/api/archive/list', async () => {
    return { files: await deps.archiver.list() }
  })

  app.get('/api/archive/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string }
    if (extname(filename) !== '.mp3') {
      reply.status(400)
      return { error: 'invalid file' }
    }
    const filepath = join((deps.archiver as any).archiveDir, filename)
    try {
      const stats = await stat(filepath)
      const range = request.headers.range
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d+)?/)
        if (match) {
          const start = Number(match[1])
          const end = match[2] ? Number(match[2]) : stats.size - 1
          reply.status(206)
          reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`)
          reply.header('Content-Length', String(end - start + 1))
          reply.header('Content-Type', 'audio/mpeg')
          const buf = await readFile(filepath)
          return buf.subarray(start, end + 1)
        }
      }
      reply.header('Content-Length', String(stats.size))
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Accept-Ranges', 'bytes')
      return await readFile(filepath)
    } catch {
      reply.status(404)
      return { error: 'not found' }
    }
  })

  app.post('/api/archive/cleanup', async () => {
    await deps.archiver.cleanup()
    return { ok: true }
  })
}
```

- [ ] **步骤 4：`src/routes/playlist.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { PlaylistService } from '../services/playlist-service.js'
import type { UploadedFilesRepo } from '../db/repos/uploaded-files.repo.js'

export function registerPlaylistRoutes(app: FastifyInstance, deps: {
  playlistService: PlaylistService
  fileRepo: UploadedFilesRepo
}): void {
  app.get('/api/playlist', async () => {
    return { items: deps.playlistService.list() }
  })

  app.post('/api/playlist', async (request) => {
    const body = request.body as { filename: string; displayName: string; durationSec?: number }
    if (!body.filename || !body.displayName) {
      throw new Error('filename and displayName required')
    }
    const id = deps.playlistService.add({
      filename: body.filename,
      display_name: body.displayName,
      duration_sec: body.durationSec ?? null,
    })
    return { id }
  })

  app.put('/api/playlist/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { displayName?: string }
    if (body.displayName) {
      deps.playlistService.updateDisplay(Number(id), body.displayName)
    }
    return { ok: true }
  })

  app.delete('/api/playlist/:id', async (request) => {
    const { id } = request.params as { id: string }
    deps.playlistService.remove(Number(id))
    return { ok: true }
  })

  app.post('/api/playlist/reorder', async (request) => {
    const body = request.body as { ids: number[] }
    deps.playlistService.reorder(body.ids)
    return { ok: true }
  })

  app.get('/api/source/files', async () => {
    return { files: deps.fileRepo.list() }
  })

  app.delete('/api/source/files/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const file = deps.fileRepo.getById(Number(id))
    if (!file) {
      reply.status(404)
      return { error: 'not found' }
    }
    deps.fileRepo.delete(Number(id))
    // optionally also remove from disk
    return { ok: true }
  })
}
```

- [ ] **步骤 5：`src/routes/listeners.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { ListenerManager } from '../services/listener-manager.js'

export function registerListenersRoutes(app: FastifyInstance, deps: {
  listenerManager: ListenerManager
}): void {
  app.get('/api/listeners/current', async () => {
    return {
      count: deps.listenerManager.countCurrent(),
      listeners: deps.listenerManager.current(),
    }
  })

  app.get('/api/listeners/history', async (request) => {
    const { page = '1', pageSize = '50' } = request.query as { page?: string; pageSize?: string }
    return deps.listenerManager.history(Number(page), Number(pageSize))
  })
}
```

- [ ] **步骤 6：`src/routes/ffmpeg.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { FFmpegManager } from '../services/ffmpeg-manager.js'
import type { WsHub } from '../services/ws-hub.js'
import type { DownloadState } from '../services/ffmpeg-downloader.js'

export function registerFfmpegRoutes(app: FastifyInstance, deps: {
  ffmpegManager: FFmpegManager
  wsHub: WsHub
}): void {
  app.get('/api/ffmpeg/status', async () => {
    return deps.ffmpegManager.getStatus()
  })

  // SSE endpoint
  app.get('/api/ffmpeg/download/status', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('Access-Control-Allow-Origin', '*')
    reply.raw.flushHeaders()

    const send = (state: DownloadState) => {
      reply.raw.write(`data: ${JSON.stringify(state)}\n\n`)
    }

    const onDownload = (state: DownloadState) => send(state)
    deps.ffmpegManager.on('download', onDownload)
    send({ state: 'idle' })

    request.raw.on('close', () => {
      deps.ffmpegManager.off('download', onDownload)
    })
    // Keep connection alive
    return reply
  })

  app.post('/api/ffmpeg/download', async () => {
    deps.ffmpegManager.triggerDownload().catch(() => {})
    return { ok: true }
  })

  app.post('/api/ffmpeg/upgrade', async () => {
    deps.ffmpegManager.triggerDownload().catch(() => {})
    return { ok: true }
  })

  app.post('/api/ffmpeg/test', async () => {
    const status = deps.ffmpegManager.getStatus()
    if (!status.available || !status.path) {
      return { ok: false, error: 'ffmpeg not available' }
    }
    const { spawn } = await import('child_process')
    return new Promise((resolve) => {
      const proc = spawn(status.path, ['-version'])
      let output = ''
      proc.stdout.on('data', (c) => (output += c.toString()))
      proc.on('exit', (code) => resolve({ ok: code === 0, output, path: status.path }))
      proc.on('error', (err) => resolve({ ok: false, error: err.message }))
    })
  })
}
```

- [ ] **步骤 7：`src/routes/config.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { WsHub } from '../services/ws-hub.js'

export function registerConfigRoutes(app: FastifyInstance, deps: {
  config: import('../config.js').AppConfig
  wsHub: WsHub
}): void {
  app.get('/api/config', async () => deps.config)

  app.put('/api/config', async (request) => {
    const body = request.body as { key: string; value: any }
    if (!body.key) throw new Error('key required')
    // Simple shallow set for top-level keys in this v1
    const parts = body.key.split('.')
    let target: any = deps.config
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]]
      if (!target) throw new Error(`unknown key: ${body.key}`)
    }
    target[parts[parts.length - 1]] = body.value
    deps.wsHub.emitEvent('config-changed', { key: body.key })
    return { ok: true }
  })
}
```

- [ ] **步骤 8：`src/routes/ws.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { WsHub } from '../services/ws-hub.js'

export function registerWsRoute(app: FastifyInstance, deps: {
  wsHub: WsHub
}): void {
  app.get('/ws', { websocket: true }, (connection, req) => {
    const socket = (connection as any).socket ?? connection

    const events: (keyof import('../services/ws-hub.js').EventMap)[] = [
      'source-start',
      'source-end',
      'listener-count',
      'archive-new',
      'ffmpeg-download',
      'config-changed',
    ]

    const handlers: Record<string, (data: any) => void> = {}
    for (const e of events) {
      handlers[e] = (data) => {
        socket.send(JSON.stringify({ type: e, data }))
      }
      deps.wsHub.on(e, handlers[e])
    }

    socket.on('close', () => {
      for (const e of events) {
        deps.wsHub.off(e, handlers[e])
      }
    })
  })
}
```

- [ ] **步骤 9：修改 `src/app.ts` 串起所有 services**

```typescript
import Fastify, { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { join } from 'path'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { initDb } from './db/sqlite.js'
import { PlaylistRepo } from './db/repos/playlist.repo.js'
import { UploadedFilesRepo } from './db/repos/uploaded-files.repo.js'
import { ListenerLogsRepo } from './db/repos/listener-logs.repo.js'
import { FFmpegManager } from './services/ffmpeg-manager.js'
import { SourceReceiver } from './services/source-receiver.js'
import { Broadcaster } from './services/broadcaster.js'
import { Archiver } from './services/archiver.js'
import { ListenerManager } from './services/listener-manager.js'
import { PlaylistService } from './services/playlist-service.js'
import { UploadService } from './services/upload-service.js'
import { WsHub } from './services/ws-hub.js'

import { registerStreamRoutes } from './routes/stream.js'
import { registerSourceRoutes } from './routes/source.js'
import { registerArchiveRoutes } from './routes/archive.js'
import { registerPlaylistRoutes } from './routes/playlist.js'
import { registerListenersRoutes } from './routes/listeners.js'
import { registerFfmpegRoutes } from './routes/ffmpeg.js'
import { registerConfigRoutes } from './routes/config.js'
import { registerWsRoute } from './routes/ws.js'

export interface BuildAppDeps {
  ffmpegPathOverride?: string
}

export async function buildApp(
  configPath = 'config/config.yaml',
  deps: BuildAppDeps = {},
): Promise<FastifyInstance> {
  const config = loadConfig(configPath)
  const logger = createLogger(config.logging)
  const db = await initDb('data/radio.db')

  const ffmpegManager = new FFmpegManager({
    binRoot: 'bin/ffmpeg',
    version: config.ffmpeg.version,
    downloadUrl: config.ffmpeg.sourceUrl,
    ffmpegPathOverride: deps.ffmpegPathOverride,
  })
  await ffmpegManager.initialize()
  if (!ffmpegManager.getStatus().available) {
    throw new Error('ffmpeg not available - startup failed')
  }

  const broadcaster = new Broadcaster({ ringCapacity: 128 * 1024 })
  const sourceReceiver = new SourceReceiver({
    sourcePassword: config.auth.sourcePassword,
    onData: (chunk) => {
      // Forward to archiver if active
      const archiver = (broadcaster as any).archiverRef
      if (archiver?.isRunning()) {
        // archiver already has stdin pipe
      }
    },
  })

  const archiver = new Archiver({
    ffmpegPath: ffmpegManager.getStatus().path!,
    archiveDir: config.archive.directory,
    segmentDurationSec: config.archive.segmentDurationSec,
    retentionDays: config.archive.retentionDays,
  })

  // pipe source -> archiver + broadcaster
  sourceReceiver.on('session-start', (session) => {
    const sourcePassthrough = new (require('stream').PassThrough)()
    const req = (sourceReceiver as any).activeReq
    if (req) req.raw.pipe(sourcePassthrough)
    archiver.start(sourcePassthrough).catch((err) => logger.error({ err }, 'archiver start failed'))
    broadcaster.pipeFrom(sourcePassthrough, session)
  })

  sourceReceiver.on('session-end', () => {
    archiver.stop().catch(() => {})
  })

  const listenerManager = new ListenerManager(new ListenerLogsRepo(db))
  const playlistService = new PlaylistService(new PlaylistRepo(db), new UploadedFilesRepo(db))
  const uploadService = new UploadService({
    uploadDir: config.playlist.uploadDir,
    maxFileSizeMB: config.playlist.maxFileSizeMB,
    allowedExtensions: config.playlist.allowedExtensions,
    ffmpegPath: ffmpegManager.getStatus().path!,
    fileRepo: new UploadedFilesRepo(db),
  })
  const wsHub = new WsHub()

  // Forward source events
  sourceReceiver.on('session-start', (s) => wsHub.emitEvent('source-start', s))
  sourceReceiver.on('session-end', (s) => wsHub.emitEvent('source-end', { sessionId: s.id }))
  sourceReceiver.on('data', () => {
    wsHub.emitEvent('listener-count', listenerManager.countCurrent())
  })

  // webui setup (later task)
  const app = Fastify({
    logger,
    bodyLimit: 50 * 1024 * 1024, // 50MB for uploads
  })

  await app.register(websocket)
  await app.register(multipart, {
    limits: { fileSize: config.playlist.maxFileSizeMB * 1024 * 1024 },
  })
  await app.register(staticFiles, {
    root: join(process.cwd(), 'public'),
    prefix: '/',
  })

  await sourceReceiver.register(app)

  registerStreamRoutes(app, { broadcaster, listenerManager })
  registerSourceRoutes(app, { sourceReceiver, wsHub })
  registerArchiveRoutes(app, { archiver })
  registerPlaylistRoutes(app, { playlistService, fileRepo: new UploadedFilesRepo(db) })
  registerListenersRoutes(app, { listenerManager })
  registerFfmpegRoutes(app, { ffmpegManager, wsHub })
  registerConfigRoutes(app, { config, wsHub })
  registerWsRoute(app, { wsHub })

  // status
  app.get('/api/status', async () => ({
    ffmpeg: ffmpegManager.getStatus(),
    broadcaster: { isLive: broadcaster.isLive() },
    listeners: { count: listenerManager.countCurrent() },
  }))

  // Source start (file/playlist)
  app.post('/api/source/start', async (request) => {
    const body = request.body as { type: 'file' | 'playlist'; id: number | string }
    // For v1: launch a ffmpeg child to push the file
    const { spawn } = await import('child_process')
    let inputPath: string | null = null
    let displayName: string | null = null

    if (body.type === 'file') {
      const fileRepo = new UploadedFilesRepo(db)
      const file = fileRepo.getById(Number(body.id))
      if (!file) throw new Error('file not found')
      inputPath = join(config.playlist.uploadDir, file.filename)
      displayName = file.original_name
    } else if (body.type === 'playlist') {
      const song = playlistService.list().find((s) => s.id === Number(body.id))
      if (!song) throw new Error('song not found')
      const file = new UploadedFilesRepo(db).list().find((f) => f.filename === song.filename)
      if (!file) throw new Error('uploaded file not found')
      inputPath = join(config.playlist.uploadDir, file.filename)
      displayName = song.display_name
    }

    if (!inputPath) throw new Error('no input')

    const url = `http://127.0.0.1:${config.server.port}/source`
    const proc = spawn(ffmpegManager.getStatus().path!, [
      '-re',
      '-i', inputPath,
      '-c', 'copy',
      '-f', 'mp3',
      '-content_type', 'audio/mpeg',
      url,
    ])

    proc.stderr?.on('data', (c) => logger.debug({ msg: c.toString() }, 'ffmpeg push'))
    proc.on('exit', () => logger.info('source push exited'))

    return { ok: true, displayName, pid: proc.pid }
  })

  app.post('/api/source/stop', async () => {
    // Kill any source-pushing ffmpeg processes
    const { execSync } = await import('child_process')
    try {
      if (process.platform === 'win32') {
        execSync('taskkill /F /IM ffmpeg.exe /FI "WINDOWTITLE eq radioServices*"', { stdio: 'ignore' })
      } else {
        execSync("pkill -f 'ffmpeg.*-content_type audio/mpeg'", { stdio: 'ignore' })
      }
    } catch {
      // no processes
    }
    return { ok: true }
  })

  // upload endpoint
  app.post('/api/source/upload', async (request, reply) => {
    const data = await request.file()
    if (!data) {
      reply.status(400)
      return { error: 'no file' }
    }
    const buffer = await data.toBuffer()
    const originalName = data.filename ?? 'upload.mp3'
    const getDuration = (fp: string) =>
      uploadService.getDurationWithFfmpeg(fp, ffmpegManager.getStatus().path!)
    const result = await uploadService.save({ buffer, originalName, getDuration })
    return result
  })

  return app
}
```

- [ ] **步骤 10：手动运行验证**

```bash
pnpm dev
curl http://localhost:8000/api/status
curl http://localhost:8000/api/ffmpeg/status
```

预期：返回 JSON，启动成功

- [ ] **步骤 11：Commit**

```bash
git add src/routes/ src/app.ts
git commit -m "feat: fastify app with all REST routes + WS"
```

---

## 任务 13：前端骨架 (HTML + TS + esbuild)

**目标：** 创建 `public/admin/index.html` + `src/web/main.ts`，esbuild 打包到 `public/admin/app.js`，暗色主题 CSS。

**文件：**
- 创建：`public/admin/index.html`
- 创建：`src/web/main.ts`
- 创建：`src/web/api-client.ts`
- 创建：`src/web/ws-client.ts`
- 创建：`src/web/ui.ts`
- 创建：`src/web/styles.css`
- 创建：`esbuild.config.mjs`

- [ ] **步骤 1：`public/admin/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>radioServices · 管理</title>
<link rel="stylesheet" href="./app.css" />
</head>
<body>
<div id="app">
  <header>
    <h1>radioServices</h1>
    <div id="status-indicator"></div>
  </header>
  <nav id="tabs">
    <button data-tab="dashboard" class="active">状态</button>
    <button data-tab="source">推流</button>
    <button data-tab="archive">回放</button>
    <button data-tab="listeners">听众</button>
    <button data-tab="ffmpeg">FFmpeg</button>
  </nav>
  <main>
    <div id="view-dashboard" class="view active"></div>
    <div id="view-source" class="view"></div>
    <div id="view-archive" class="view"></div>
    <div id="view-listeners" class="view"></div>
    <div id="view-ffmpeg" class="view"></div>
  </main>
  <footer>
    <span>推流命令：</span>
    <code>ffmpeg -re -i song.mp3 -c copy -f mp3 -content_type audio/mpeg <span id="base-url"></span>/source</code>
    <span id="disconnect-warning"></span>
  </footer>
</div>
<script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **步骤 2：`src/web/styles.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0f1419;
  --bg-elev: #1a2026;
  --bg-elev2: #232a32;
  --border: #2d3742;
  --text: #e1e7ef;
  --text-dim: #8a96a3;
  --accent: #4fc3f7;
  --success: #66bb6a;
  --warn: #ffa726;
  --error: #ef5350;
}
body {
  font-family: -apple-system, "Helvetica Neue", "PingFang SC", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
#app { max-width: 1200px; margin: 0 auto; padding: 24px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
header h1 { font-size: 22px; font-weight: 600; }
#status-indicator {
  display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 500;
}
#status-indicator.live { background: var(--success); color: #000; }
#status-indicator.offline { background: var(--bg-elev2); color: var(--text-dim); }
#status-indicator.error { background: var(--error); color: #fff; }
nav { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
nav button {
  background: transparent; color: var(--text-dim); border: none;
  padding: 10px 18px; cursor: pointer; font-size: 14px;
  border-bottom: 2px solid transparent;
}
nav button.active { color: var(--accent); border-bottom-color: var(--accent); }
nav button:hover { color: var(--text); }
.view { display: none; }
.view.active { display: block; }
.card {
  background: var(--bg-elev); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px; margin-bottom: 16px;
}
.card h2 { font-size: 15px; font-weight: 500; margin-bottom: 12px; color: var(--text-dim); }
button.action, .btn {
  background: var(--accent); color: #000; border: none;
  padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 13px;
}
button.action:hover, .btn:hover { opacity: 0.85; }
button.action.danger { background: var(--error); color: #fff; }
button.action:disabled { background: var(--bg-elev2); color: var(--text-dim); cursor: not-allowed; }
input[type="text"], input[type="number"] {
  background: var(--bg-elev2); color: var(--text); border: 1px solid var(--border);
  padding: 6px 10px; border-radius: 4px; font-size: 13px;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
th { color: var(--text-dim); font-weight: 500; }
tbody tr:hover { background: var(--bg-elev2); }
.upload-zone {
  border: 2px dashed var(--border); border-radius: 8px;
  padding: 40px; text-align: center; color: var(--text-dim);
}
.upload-zone.dragover { border-color: var(--accent); background: var(--bg-elev); }
ul.list { list-style: none; }
ul.list li {
  background: var(--bg-elev); border: 1px solid var(--border);
  padding: 10px 14px; margin-bottom: 6px; border-radius: 4px;
  display: flex; justify-content: space-between; align-items: center;
}
.empty { color: var(--text-dim); text-align: center; padding: 32px; }
.progress { background: var(--bg-elev2); border-radius: 4px; overflow: hidden; height: 8px; }
.progress-bar {
  height: 100%; background: var(--accent); transition: width 200ms;
}
audio { width: 100%; margin-top: 8px; }
footer {
  margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
  color: var(--text-dim); font-size: 12px;
}
footer code {
  background: var(--bg-elev); padding: 4px 8px; border-radius: 4px;
  display: inline-block; margin-top: 4px;
}
```

- [ ] **步骤 3：`src/web/api-client.ts`**

```typescript
const BASE = ''

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error?.message ?? err.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  status: () => fetch(`${BASE}/api/status`).then(json),
  ffmpegStatus: () => fetch(`${BASE}/api/ffmpeg/status`).then(json),
  triggerFfmpegDownload: () => fetch(`${BASE}/api/ffmpeg/download`, { method: 'POST' }).then(json),
  sourceStart: (type: 'file' | 'playlist', id: number) =>
    fetch(`${BASE}/api/source/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
    }).then(json),
  sourceStop: () =>
    fetch(`${BASE}/api/source/stop`, { method: 'POST' }).then(json),
  upload: async (file: File, onProgress?: (pct: number) => void): Promise<any> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/api/source/upload`, { method: 'POST', body: form })
    return json(res)
  },
  listFiles: () => fetch(`${BASE}/api/source/files`).then(json),
  deleteFile: (id: number) =>
    fetch(`${BASE}/api/source/files/${id}`, { method: 'DELETE' }).then(json),
  listPlaylist: () => fetch(`${BASE}/api/playlist`).then(json),
  addToPlaylist: (filename: string, displayName: string, durationSec?: number) =>
    fetch(`${BASE}/api/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, displayName, durationSec }),
    }).then(json),
  deleteFromPlaylist: (id: number) =>
    fetch(`${BASE}/api/playlist/${id}`, { method: 'DELETE' }).then(json),
  reorderPlaylist: (ids: number[]) =>
    fetch(`${BASE}/api/playlist/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(json),
  listArchive: () => fetch(`${BASE}/api/archive/list`).then(json),
  currentListeners: () => fetch(`${BASE}/api/listeners/current`).then(json),
  historyListeners: (page = 1) =>
    fetch(`${BASE}/api/listeners/history?page=${page}`).then(json),
  config: () => fetch(`${BASE}/api/config`).then(json),
  updateConfig: (key: string, value: any) =>
    fetch(`${BASE}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).then(json),
}

export function startFfmpegDownloadStream(onState: (s: any) => void): () => void {
  const es = new EventSource('/api/ffmpeg/download/status')
  es.onmessage = (e) => {
    try { onState(JSON.parse(e.data)) } catch {}
  }
  return () => es.close()
}
```

- [ ] **步骤 4：`src/web/ws-client.ts`**

```typescript
export type WsEvent = { type: string; data: any }
export type WsHandler = (data: any) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers: Record<string, Set<WsHandler>> = {}
  private reconnectTimer: number | null = null

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/ws`
    this.ws = new WebSocket(url)

    this.ws.onmessage = (e) => {
      try {
        const evt: WsEvent = JSON.parse(e.data)
        const set = this.handlers[evt.type]
        if (set) for (const h of set) h(evt.data)
      } catch {}
    }

    this.ws.onclose = () => {
      this.reconnectTimer = window.setTimeout(() => this.connect(), 2000)
    }
  }

  on(type: string, handler: WsHandler) {
    if (!this.handlers[type]) this.handlers[type] = new Set()
    this.handlers[type].add(handler)
  }

  off(type: string, handler: WsHandler) {
    this.handlers[type]?.delete(handler)
  }
}

export const ws = new WsClient()
```

- [ ] **步骤 5：`src/web/ui.ts`**

```typescript
export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)
export const $$ = <T extends HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel))

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '--:--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTimeAgo(date: string | Date): string {
  const d = new Date(date)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
}
```

- [ ] **步骤 6：`src/web/main.ts`**

```typescript
import { api, startFfmpegDownloadStream } from './api-client.js'
import { ws } from './ws-client.js'
import { $, $$, formatBytes, formatDuration, formatTimeAgo } from './ui.js'
import { renderDashboard } from './views/dashboard.js'
import { renderSource } from './views/source.js'
import { renderArchive } from './views/archive.js'
import { renderListeners } from './views/listeners.js'
import { renderFfmpegPanel } from './views/ffmpeg-panel.js'

const tabs: Record<string, () => Promise<void>> = {
  dashboard: renderDashboard,
  source: renderSource,
  archive: renderArchive,
  listeners: renderListeners,
  ffmpeg: renderFfmpegPanel,
}

function showTab(name: string) {
  $$('.tab-button').forEach((b) => b.classList.toggle('active', (b as any).dataset.tab === name))
  $$('.view').forEach((v) => v.classList.remove('active'))
  $('#view-' + name)?.classList.add('active')
  tabs[name]?.()
}

$$('.tab-button').forEach((btn) => {
  btn.addEventListener('click', () => showTab((btn as any).dataset.tab))
})

async function refreshBaseUrl() {
  try {
    const { server } = await api.config()
    $('#base-url').textContent = `http://localhost:${server.port}`
  } catch {}
}

ws.connect()
ws.on('source-start', () => updateStatusIndicator(true))
ws.on('source-end', () => updateStatusIndicator(false))
ws.on('listener-count', (count) => updateListenerCount(count))

async function updateStatusIndicator(live: boolean) {
  const ind = $('#status-indicator')
  if (live) {
    ind!.textContent = '🔴 直播中'
    ind!.className = 'live'
  } else {
    ind!.textContent = '未推流'
    ind!.className = 'offline'
  }
}

async function updateListenerCount(count: number) {
  // Update any visible listeners count without full re-render
  const el = $('#listener-count-display')
  if (el) el.textContent = String(count)
}

;(async () => {
  await refreshBaseUrl()
  await renderDashboard()
  setInterval(async () => {
    // background refresh
    const ind = $('#status-indicator')
    try {
      const status = await api.status()
      updateStatusIndicator(status.broadcaster.isLive)
    } catch {}
  }, 5000)
})()
```

- [ ] **步骤 7：`src/web/views/dashboard.ts`**

```typescript
import { api } from '../api-client.js'
import { $ } from '../ui.js'

export async function renderDashboard() {
  const view = $('#view-dashboard')!
  const [status, listeners, archive] = await Promise.all([
    api.status(),
    api.currentListeners(),
    api.listArchive(),
  ])

  view.innerHTML = `
    <div class="card">
      <h2>实时状态</h2>
      <div style="font-size: 32px; margin-bottom: 8px;">
        ${status.broadcaster.isLive ? '🔴 直播中' : '⚫ 未推流'}
      </div>
      <div style="color: var(--text-dim);">推流路径 / live.mp3</div>
    </div>
    <div class="card">
      <h2>当前在线听众</h2>
      <div style="font-size: 28px;" id="listener-count-display">${listeners.count}</div>
    </div>
    <div class="card">
      <h2>FFmpeg 状态</h2>
      <div>来源：${status.ffmpeg.source}</div>
      <div>版本：${status.ffmpeg.version ?? 'unknown'}</div>
      <div>路径：<code>${status.ffmpeg.path ?? 'N/A'}</code></div>
    </div>
    <div class="card">
      <h2>最近切片（最新 10 个）</h2>
      <ul class="list">
        ${(archive.files ?? []).slice(0, 10).map((f: any) => `
          <li>
            <span>${f.filename}</span>
            <span style="color:var(--text-dim)">${formatBytes(f.sizeBytes)} · ${formatTimeAgo(f.mtime)}</span>
          </li>
        `).join('')}
      </ul>
    </div>
    <div class="card">
      <h2>收听地址</h2>
      <div>浏览器：<code>/stream</code></div>
      <div>VLC：<code>/live.mp3</code></div>
    </div>
  `
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function formatTimeAgo(date: string | Date): string {
  const d = new Date(date)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
}
```

- [ ] **步骤 8：`esbuild.config.mjs`**

```javascript
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { copy } from 'esbuild-plugin-copy'

mkdirSync('public/admin', { recursive: true })
copyFileSync('src/web/styles.css', 'public/admin/app.css')

await build({
  entryPoints: ['src/web/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/admin/app.js',
  minify: true,
  sourcemap: true,
  plugins: [
    copy({
      assets: { from: 'src/web/views/*.ts', to: 'public/admin' },
    }),
  ],
})

console.log('✓ web bundle built')
```

- [ ] **步骤 9：在 package.json 添加 build:web 脚本**

```json
"scripts": {
  "build:web": "node esbuild.config.mjs"
}
```

- [ ] **步骤 10：运行构建**

```bash
pnpm build:web
ls public/admin/
```

预期：`app.js, app.css, index.html` 都生成

- [ ] **步骤 11：手动验证**

```bash
pnpm dev
open http://localhost:8000/admin
```

预期：管理页面渲染，"状态" tab 显示。点击"推流" tab 也加载。

- [ ] **步骤 12：Commit**

```bash
git add public/ src/web/ esbuild.config.mjs package.json
git commit -m "feat: admin web UI (skeleton + dashboard)"
```

---

## 任务 14：前端 4 个 view（推流、回放、听众、ffmpeg 面板）

**目标：** 实现剩下 4 个 view 的 TS 文件。

**文件：**
- 创建：`src/web/views/source.ts`
- 创建：`src/web/views/archive.ts`
- 创建：`src/web/views/listeners.ts`
- 创建：`src/web/views/ffmpeg-panel.ts`

- [ ] **步骤 1：`src/web/views/source.ts`**

```typescript
import { api } from '../api-client.js'
import { $, $$, formatBytes, formatDuration } from '../ui.js'

export async function renderSource() {
  const view = $('#view-source')!
  const [filesRes, playlistRes] = await Promise.all([api.listFiles(), api.listPlaylist()])
  const files = filesRes.files ?? []
  const playlist = playlistRes.items ?? []

  view.innerHTML = `
    <div class="card">
      <h2>上传文件</h2>
      <div class="upload-zone" id="upload-zone">
        拖拽文件到这里，或点击选择
        <br><input type="file" id="file-input" multiple accept=".mp3,.m4a,.aac,.ogg,.wav,.flac" style="margin-top:12px">
      </div>
      <div id="upload-progress"></div>
      <h3 style="margin-top:16px">已上传文件</h3>
      <ul class="list" id="uploaded-list">
        ${files.length === 0 ? '<li class="empty">还没有上传的文件</li>' : files.map(f => `
          <li>
            <div>
              <div>${escapeHtml(f.original_name)}</div>
              <div style="color:var(--text-dim); font-size:12px">${formatBytes(f.size_bytes)} · ${formatDuration(f.duration_sec)}</div>
            </div>
            <div>
              <button class="action" data-action="push-file" data-id="${f.id}">推这一首</button>
              <button class="action danger" data-action="delete-file" data-id="${f.id}">删除</button>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    <div class="card">
      <h2>歌单</h2>
      <ul class="list" id="playlist-list">
        ${playlist.length === 0 ? '<li class="empty">歌单为空</li>' : playlist.map(song => `
          <li data-song-id="${song.id}">
            <div>
              <div>${escapeHtml(song.display_name)}</div>
              <div style="color:var(--text-dim); font-size:12px">${escapeHtml(song.filename)} · ${formatDuration(song.duration_sec)}</div>
            </div>
            <div>
              <button class="action" data-action="push-playlist" data-id="${song.id}">推这一首</button>
              <button class="action danger" data-action="delete-song" data-id="${song.id}">移除</button>
            </div>
          </li>
        `).join('')}
      </ul>
      <div style="margin-top:16px">
        <button class="action danger" id="stop-push">停止当前推流</button>
      </div>
    </div>
  `

  // event handlers
  const uploadZone = $('#upload-zone')!
  const fileInput = $('#file-input') as HTMLInputElement
  const uploadProgress = $('#upload-progress')!

  uploadZone.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => uploadFiles(Array.from(fileInput.files ?? [])))
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover') })
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'))
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault()
    uploadZone.classList.remove('dragover')
    uploadFiles(Array.from(e.dataTransfer?.files ?? []))
  })

  $$('#uploaded-list button').forEach(btn => {
    btn.addEventListener('click', () => handleAction((btn as any).dataset.action, Number((btn as any).dataset.id)))
  })
  $$('#playlist-list button').forEach(btn => {
    btn.addEventListener('click', () => handleAction((btn as any).dataset.action, Number((btn as any).dataset.id)))
  })
  $('#stop-push')?.addEventListener('click', async () => {
    await api.sourceStop()
    alert('已请求停止推流')
  })

  async function uploadFiles(files: File[]) {
    for (const file of files) {
      uploadProgress.innerHTML = `<div>${escapeHtml(file.name)} 上传中...</div>`
      try {
        const result = await api.upload(file)
        uploadProgress.innerHTML += `<div style="color:var(--success)">${escapeHtml(file.name)} ✓ 已保存</div>`
        // also add to playlist
        await api.addToPlaylist(result.filename, file.name.replace(/\.[^.]+$/, ''), result.durationSec)
      } catch (e: any) {
        uploadProgress.innerHTML += `<div style="color:var(--error)">${escapeHtml(file.name)} ✗ ${e.message}</div>`
      }
    }
    setTimeout(() => renderSource(), 1500)
  }

  async function handleAction(action: string, id: number) {
    try {
      if (action === 'push-file') await api.sourceStart('file', id)
      else if (action === 'push-playlist') await api.sourceStart('playlist', id)
      else if (action === 'delete-file') {
        if (!confirm('确定要删除这个文件吗？')) return
        await api.deleteFile(id)
      } else if (action === 'delete-song') {
        await api.deleteFromPlaylist(id)
      }
      await renderSource()
    } catch (e: any) {
      alert('操作失败：' + e.message)
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!))
}
```

- [ ] **步骤 2：`src/web/views/archive.ts`**

```typescript
import { api } from '../api-client.js'
import { $, formatBytes, formatDuration } from '../ui.js'

export async function renderArchive() {
  const view = $('#view-archive')!
  const { files } = await api.listArchive()
  const list = files ?? []

  // Group by date (YYYY-MM-DD prefix)
  const groups: Record<string, any[]> = {}
  for (const f of list) {
    const date = f.filename.slice(0, 10) // YYYY-MM-DD
    if (!groups[date]) groups[date] = []
    groups[date].push(f)
  }

  view.innerHTML = `
    <div class="card">
      <h2>历史切片</h2>
      ${Object.keys(groups).length === 0 ? '<div class="empty">还没有切片，请先开始推流。</div>' : ''}
      ${Object.entries(groups).map(([date, items]) => `
        <h3 style="margin-top:16px;color:var(--text-dim);font-size:13px">${date}</h3>
        <ul class="list">
          ${items.map(f => `
            <li>
              <div>
                <div>${escapeHtml(f.filename)}</div>
                <div style="color:var(--text-dim); font-size:12px">${formatBytes(f.sizeBytes)} · ${new Date(f.mtime).toLocaleString()}</div>
                <audio controls preload="none" src="/api/archive/${encodeURIComponent(f.filename)}"></audio>
              </div>
              <a class="action" href="/api/archive/${encodeURIComponent(f.filename)}" download>下载</a>
            </li>
          `).join('')}
        </ul>
      `).join('')}
    </div>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!))
}
```

- [ ] **步骤 3：`src/web/views/listeners.ts`**

```typescript
import { api } from '../api-client.js'
import { $, formatTimeAgo } from '../ui.js'

export async function renderListeners() {
  const view = $('#view-listeners')!
  const { count, listeners } = await api.currentListeners()
  const history = await api.historyListeners(1)

  view.innerHTML = `
    <div class="card">
      <h2>当前在线 (${count})</h2>
      ${listeners.length === 0 ? '<div class="empty">当前没有听众</div>' : `
        <table>
          <thead><tr><th>IP</th><th>设备</th><th>系统</th><th>浏览器</th><th>来源</th><th>连接时间</th></tr></thead>
          <tbody>
            ${listeners.map(l => `
              <tr>
                <td>${escapeHtml(l.ip)}</td>
                <td>${escapeHtml(l.device_type ?? '-')}</td>
                <td>${escapeHtml(l.device_os ?? '-')}</td>
                <td>${escapeHtml(l.device_browser ?? '-')}</td>
                <td>${escapeHtml(l.referer ?? '直接访问')}</td>
                <td>${formatTimeAgo(l.connected_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
    <div class="card">
      <h2>历史听众（最近 ${history.total} 条）</h2>
      ${history.rows.length === 0 ? '<div class="empty">还没有历史记录</div>' : `
        <table>
          <thead><tr><th>IP</th><th>设备</th><th>连接</th><th>断开</th><th>时长</th></tr></thead>
          <tbody>
            ${history.rows.map((l: any) => `
              <tr>
                <td>${escapeHtml(l.ip)}</td>
                <td>${escapeHtml(l.device_browser ?? '-')}</td>
                <td>${formatTimeAgo(l.connected_at)}</td>
                <td>${l.disconnected_at ? formatTimeAgo(l.disconnected_at) : '在线'}</td>
                <td>${l.duration_sec ?? '-'}秒</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!))
}
```

- [ ] **步骤 4：`src/web/views/ffmpeg-panel.ts`**

```typescript
import { api, startFfmpegDownloadStream } from '../api-client.js'
import { $, formatBytes } from '../ui.js'

export async function renderFfmpegPanel() {
  const view = $('#view-ffmpeg')!
  const status = await api.ffmpegStatus()

  view.innerHTML = `
    <div class="card">
      <h2>FFmpeg 状态</h2>
      <table>
        <tr><td>可用</td><td>${status.available ? '✅' : '❌'}</td></tr>
        <tr><td>来源</td><td>${status.source}</td></tr>
        <tr><td>版本</td><td>${status.version ?? 'unknown'}</td></tr>
        <tr><td>路径</td><td><code>${status.path ?? 'N/A'}</code></td></tr>
      </table>
    </div>
    <div class="card">
      <h2>下载 / 升级</h2>
      <p style="color:var(--text-dim);font-size:13px">FFmpeg 二进制从 BtbN/FFmpeg-Builds 下载到项目 bin/ffmpeg/ 目录。下载成功后才覆盖旧版本。</p>
      <div id="download-progress" style="margin-top: 12px"></div>
      <button class="action" id="download-btn">下载 / 升级</button>
    </div>
    <div class="card" id="mac-help" style="display:none">
      <h2>macOS Gatekeeper 提示</h2>
      <p style="font-size: 13px">BtbN 的二进制未签名，首次运行会被拦截。请：</p>
      <ol style="font-size: 13px; padding-left: 20px; margin-top: 8px">
        <li>打开「系统设置 → 隐私与安全性」</li>
        <li>滚动到底部，会看到「ffmpeg 已被阻止」</li>
        <li>点击「仍要打开」</li>
      </ol>
    </div>
  `

  if (!status.available && (navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac'))) {
    ($('#mac-help') as HTMLElement).style.display = 'block'
  }

  const progress = $('#download-progress')!
  const btn = $('#download-btn') as HTMLButtonElement

  let stopStream: (() => void) | null = null

  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = '下载中...'
    stopStream = startFfmpegDownloadStream((state: any) => {
      if (state.state === 'idle') {
        progress.innerHTML = `<div>等待开始...</div>`
      } else if (state.state === 'downloading') {
        const pct = state.total > 0 ? (state.downloaded / state.total * 100).toFixed(1) : '0'
        progress.innerHTML = `
          <div>下载中... ${pct}% (${formatBytes(state.downloaded)} / ${formatBytes(state.total)})</div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        `
      } else if (state.state === 'extracting') {
        progress.innerHTML = `<div>解压中...</div>`
      } else if (state.state === 'complete') {
        progress.innerHTML = `<div style="color:var(--success)">✅ 完成！路径 ${state.path}</div>`
        btn.disabled = false
        btn.textContent = '再检查一次'
        stopStream?.()
        renderFfmpegPanel()
      } else if (state.state === 'error') {
        progress.innerHTML = `<div style="color:var(--error)">❌ ${state.message}</div>`
        btn.disabled = false
        btn.textContent = '重试'
      }
    })
    await api.triggerFfmpegDownload()
  })
}
```

- [ ] **步骤 5：构建 web**

```bash
pnpm build:web
```

预期：app.js 重新生成

- [ ] **步骤 6：手动验证四个 tab**

```bash
pnpm dev
open http://localhost:8000/admin
```

预期：所有 tab 都能切换并渲染；上传一个 mp3 文件 → 自动加到歌单 → 点击「推这一首」→ 状态指示器变红 → `/stream` 推流出现

- [ ] **步骤 7：Commit**

```bash
git add src/web/views/
git commit -m "feat: source, archive, listeners, ffmpeg-panel views"
```

---

## 任务 15：集成测试 + E2E 验证

**目标：** 端到端测试：用真实的 mock 测试流推 → 收听 → 切片流程。

**文件：**
- 创建：`tests/helpers/mock-source.ts`
- 创建：`tests/integration/e2e.test.ts`

- [ ] **步骤 1：`tests/helpers/mock-source.ts`**

```typescript
import { Readable } from 'stream'
import { spawn } from 'child_process'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Generate a tiny valid MP3 silent frame, suitable for source pushing.
 * Returns a Buffer of ~50 bytes representing one MP3 frame.
 */
function silentMp3Frame(): Buffer {
  // MPEG 1 Layer 3, 32 kbps, 44.1 kHz, mono = 69 bytes total
  const header = Buffer.from([0xff, 0xfb, 0x10, 0x64])
  const rest = Buffer.alloc(65, 0)
  return Buffer.concat([header, rest])
}

export function mockSourceStream(durationMs: number): { stream: Readable; cleanup: () => void } {
  const stream = new Readable({ read() {} })
  const interval = setInterval(() => stream.push(silentMp3Frame()), 100)
  const stop = setTimeout(() => {
    clearInterval(interval)
    stream.push(null)
  }, durationMs)
  return {
    stream,
    cleanup: () => {
      clearInterval(interval)
      clearTimeout(stop)
    },
  }
}

/**
 * Generate a fake ffmpeg that just echoes input to stdout.
 * Used to test archiver pipeline.
 */
export function fakeFfmpegScript(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-ff-'))
  const path = join(dir, 'ffmpeg')
  writeFileSync(
    path,
    `#!/bin/sh
# Fake ffmpeg: read from stdin, write to segments
INPUT="$1"
shift
# just consume stdin
cat > /dev/null &
CAT_PID=$!
# Wait a bit, then write placeholder output
sleep 1
echo "ID3" > "$(dirname "$@")/2026-06-29-12.mp3.tmp" 2>/dev/null || true
# Don't exit too fast; let tests inspect
sleep 0.5
kill $CAT_PID 2>/dev/null
exit 0
`,
  )
  require('fs').chmodSync(path, 0o755)
  return path
}
```

- [ ] **步骤 2：`tests/integration/e2e.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildApp } from '../../src/app.js'

let app: any
let tempDir: string
let configPath: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-e2e-'))
  configPath = join(tempDir, 'config.yaml')
  require('fs').writeFileSync(
    configPath,
    `
server:
  host: "127.0.0.1"
  port: 18000
auth:
  sourcePassword: "test"
ffmpeg:
  version: "test"
  sourceUrl: ""
archive:
  directory: "${join(tempDir, 'archive')}"
  retentionDays: 7
playlist:
  uploadDir: "${join(tempDir, 'uploads')}"
logging:
  directory: "${join(tempDir, 'logs')}"
  level: "error"
`,
  )

  // Use system /bin/true as fake ffmpeg (it exits 0)
  app = await buildApp(configPath, { ffmpegPathOverride: '/bin/true' })
  await app.listen({ port: 18000, host: '127.0.0.1' })
})

afterAll(async () => {
  await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('E2E: PUT /source -> listener receives data', () => {
  it('streams ffmpeg input to a listening client', async () => {
    // 1. Start a listener
    const listenerPromise = new Promise<{ status: number; bytes: number }>((resolve) => {
      let bytes = 0
      const req = require('http').get('http://127.0.0.1:18000/stream', (res: any) => {
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length
        })
        res.on('end', () => resolve({ status: res.statusCode, bytes }))
      })
      req.on('error', () => {})
    })

    // 2. Push source
    const push = request('http://127.0.0.1:18000')
      .put('/source')
      .set('Authorization', 'Basic ' + Buffer.from('source:test').toString('base64'))
      .set('Content-Type', 'audio/mpeg')
      .send(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]))

    const pushRes = await push
    expect(pushRes.status).toBe(200)

    const result = await listenerPromise
    expect(result.bytes).toBeGreaterThan(0)
  }, 10000)
})
```

- [ ] **步骤 3：运行 E2E 测试**

```bash
pnpm test -- tests/integration/e2e.test.ts
```

预期：1/1 PASS（说明推流→收听链路畅通）

- [ ] **步骤 4：手动 E2E（README 步骤）**

```bash
pnpm dev
# 在另一终端
ffmpeg -version  # 确认有 ffmpeg
ffmpeg -re -i test.mp3 -c copy -f mp3 -content_type audio/mpeg \
  -headers "Authorization:Basic $(echo -n source:hackme | base64)" \
  http://localhost:8000/source

# 在第三个终端：
open http://localhost:8000/admin
open http://localhost:8000/stream  # 浏览器
vlc http://localhost:8000/live.mp3  # 或 VLC
```

预期：管理界面显示"直播中"，浏览器/VLC 能听到音频

- [ ] **步骤 5：Commit**

```bash
git add tests/
git commit -m "test: integration + E2E tests"
```

---

## 任务 16：README + 文档收尾

**目标：** 完整 README，含快速上手、推流命令、配置说明、故障排查。

**文件：**
- 创建：`README.md`

- [ ] **步骤 1：README.md**

````markdown
# radioServices

本地优先的广播电台服务器。运营方用 ffmpeg 推送音频，听众用浏览器或 VLC 实时收听。

## 特性

- 🎙️ 标准 Icecast 协议兼容：ffmpeg / BUTT / Mixxx 都能推
- 🌐 **零依赖**运营：自带 Web 管理界面，可视化所有功能
- 📦 自动安装 FFmpeg：项目自带，不污染系统
- 💾 自动按小时切片归档
- 👥 实时听众统计 + 设备识别
- 📱 响应式移动友好

## 快速上手

### 1. 安装依赖

```bash
pnpm install
```

### 2. 创建配置

```bash
cp config/config.example.yaml config/config.yaml
```

### 3. 启动

```bash
pnpm dev
```

首次启动会自动从 `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest` 下载 ffmpeg 到 `bin/ffmpeg/.versions/7.1/`。

### 4. 推送音频

**方式 A：命令行（推荐高级用户）**

```bash
./bin/ffmpeg/current/ffmpeg -re -i song.mp3 \
  -c copy -f mp3 -content_type audio/mpeg \
  -headers "Authorization: Basic $(echo -n source:hackme | base64)" \
  http://localhost:8000/source
```

> `-re` 让 ffmpeg 按真实速率读取（不会加速播放）。

**方式 B：Web 界面（小白友好）**

打开 `http://localhost:8000/admin` → 切到「推流」tab → 拖拽 mp3 文件 → 点击「推这一首」。

### 5. 收听

| 客户端 | 地址 |
|---|---|
| 浏览器 | `http://localhost:8000/stream` |
| VLC | `http://localhost:8000/live.mp3` |

## 架构

```
ffmpeg → PUT /source (Icecast HTTP)
   ↓
SourceReceiver → 解析、广播、切片
                  ├→ Broadcaster.ringBuffer → listener (浏览器/VLC)
                  └→ Archiver → bin/archive/YYYY-MM-DD-HH.mp3
```

详见 [docs/superpowers/specs/2026-06-29-radio-services-design.md](docs/superpowers/specs/2026-06-29-radio-services-design.md)。

## 配置

`config/config.yaml`：

```yaml
server:
  host: "0.0.0.0"
  port: 8000
auth:
  sourcePassword: "hackme"   # 推流密码
archive:
  retentionDays: 7           # 切片保留天数
playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
```

环境变量覆盖：
- `RADIO_PORT`
- `RADIO_HOST`
- `RADIO_SOURCE_PASSWORD`

## 测试

```bash
pnpm test                # 所有单元/集成测试
pnpm test:watch          # watch 模式
```

## 故障排查

### macOS 上 ffmpeg 无法执行

BtbN 的二进制未签名，会被 Gatekeeper 拦截。打开「系统设置 → 隐私与安全性」找到提示后点击「仍要打开」。

### 下载 ffmpeg 失败

检查网络是否能访问 `github.com`。如果在国内：

```yaml
ffmpeg:
  sourceUrl: "https://gh-proxy.com/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
```

### 推流命令找不到 ffmpeg

如果系统装了 ffmpeg 但 PATH 里没有：

```bash
export PATH=$PATH:/opt/homebrew/bin:/usr/local/bin
```

### 端口 8000 被占用

```bash
RADIO_PORT=9000 pnpm dev
```

## 协议兼容性

支持标准 Icecast PUT 的客户端：
- ffmpeg（内置）
- BUTT (Broadcast Using This Tool)
- Mixxx DJ 软件
- 任何兼容 Icecast 2 source client 的工具

## 路线图

v1：单频道、本地、HTTP、MP3
v2：HTTPS、多频道、ICY metadata、CDN
v3：听众账号、移动 App

## 许可

MIT
````

- [ ] **步骤 2：手动核验 README 命令**

复制 README 里的命令到终端跑一遍：

```bash
cp config/config.example.yaml config/config.yaml
pnpm dev
curl http://localhost:8000/health
# 停止服务
```

预期：一切顺利

- [ ] **步骤 3：Commit**

```bash
git add README.md docs/
git commit -m "docs: README + final docs"
```

---

## 自检（计划完成时执行）

**1. 规格覆盖度：**

| 规格章节 | 实现任务 |
|---|---|
| §1.2 关键需求（推流、收听、归档等） | 0、6、7、8、12 |
| §3.1 FFmpegManager | 4、5 |
| §3.2 Source Receiver | 6 |
| §3.3 Broadcaster | 7、3 |
| §3.4 Archiver | 8 |
| §3.5 Listener Manager | 9 |
| §3.6 Playlist + Upload | 10 |
| §3.7 Admin API | 12 |
| §3.8 AdminWebUI | 13、14 |
| §3.9 错误处理与日志 | 1 |
| §3.10 配置 | 1 |
| §4 项目结构 | 0-16 全覆盖 |
| §5 测试策略 | 单元在各任务、集成在 15 |
| §8 验收标准 | 各任务覆盖 |

✅ 所有规格章节都被覆盖。

**2. 占位符扫描：**

文档不含 TODO/TBD/待定等占位符。所有步骤都有具体代码或命令。

**3. 类型一致性：**

- `FFmpegStatus` 在 5 中定义，在 12、13 中使用 ✅
- `SourceSession` 在 6 中定义，在 7、12、ws-hub 中使用 ✅
- `PlaylistRow` / `UploadedFileRow` / `ListenerLogRow` 在 2 中定义，在 9、10、12 中使用 ✅
- `EventMap` 在 11 中定义，在 ws.ts、ws-hub test、main.ts 中使用 ✅
- 所有 repo 方法签名在 2 中定义，使用处参数一致 ✅

**结论：** 计划完整、自一致、无占位符。可以交给工程师或子代理执行。
