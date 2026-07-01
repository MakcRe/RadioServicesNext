# radioServices / 无线电服务

A self-hosted Icecast-style radio server written in Node.js + TypeScript, organized as a pnpm monorepo.

一个使用 Node.js + TypeScript 实现的本地广播电台服务器，项目采用 pnpm monorepo 架构。

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

### Highlights

- **Zero-config bootstrap** — auto-detects or downloads a pinned ffmpeg build on first run.
- **Dual ingest paths** — accept pushes from ffmpeg/VLC over HTTP, or upload from the browser.
- **Live listeners** — `/stream` and `/live.mp3` are compatible with any Icecast client.
- **Hourly archive** — long-lived pushes are auto-segmented into hour-long MP3 slices.
- **Admin UI** — status dashboard, playlist manager, listener log, ffmpeg download progress.
- **Pluggable backend** — server features live in `@radio-services/plugins/*` and are discovered at boot.

### Repository layout

```
radioServices/
├── packages/
│   ├── shared/          # @radio-services/shared      — types, config, interfaces
│   ├── core/            # @radio-services/core        — services, DB, plugin system
│   ├── server/          # @radio-services/server      — Fastify HTTP/WS server
│   ├── web/             # @radio-services/web         — browser admin UI bundle
│   └── plugins/
│       ├── playlist/    # @radio-services/plugin-playlist
│       ├── archive/     # @radio-services/plugin-archive
│       ├── listeners/   # @radio-services/plugin-listeners
│       └── ffmpeg/      # @radio-services/plugin-ffmpeg
├── tests/               # workspace-root tests (vitest)
├── bin/                 # runtime data: ffmpeg, archive, uploads
├── config/              # config.example.yaml template
├── docs/                # design specs, plans, references
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md (this file)
```

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   radioServices (Node.js)                    │
│                                                              │
│  ┌──────────┐     ┌────────────────┐     ┌──────────────┐   │
│  │ ffmpeg / │────▶│  Source        │     │  Listener    │◀──┼─── Browser / VLC
│  │ browser  │ PUT │  Receiver      │◀───▶│  Broadcaster │──▶│── Browser / VLC
│  └──────────┘     └───────┬────────┘     └──────────────┘   │
│       │                   │                                 │
│       │           ┌───────▼────────┐                        │
│       │           │   Archiver     │ (ffmpeg-plugin)        │
│       │           └───────┬────────┘                        │
│       │                   │                                 │
│       │           ┌───────▼────────┐                        │
│       │           │ bin/archive/   │                        │
│       │           │ YYYY-MM-DD-HH.mp3                       │
│       │           └────────────────┘                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  SQLite  (playlist / config / listener logs)           │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Admin Web UI  (bundled by @radio-services/web)        │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                Plugin system (@radio-services/core)
                Plugins load: playlist, archive, listeners, ffmpeg
```

### Quick start

```bash
# 1. Install (pnpm 9+ required)
pnpm install

# 2. Initialise config
cp config/config.example.yaml config/config.yaml

# 3. Build shared & core first (their `dist/` is consumed by everything else)
pnpm --filter @radio-services/shared build
pnpm --filter @radio-services/core   build

# 4. Run dev servers (server on :8000, web with esbuild --watch)
pnpm dev
# or run everything in parallel
pnpm dev:all
```

On first run, `bin/ffmpeg/current/` is empty. The `ffmpeg` plugin checks the
filesystem, falls back to GitHub, downloads a release, verifies SHA-256, and
extracts the binary in the background. The browser UI subscribes to that
progress over WebSocket and refreshes the dashboard when it finishes.

### Push audio

**Command-line (using the bundled ffmpeg)**

```bash
./bin/ffmpeg/current/ffmpeg -re -i your_audio.mp3 \
  -c copy -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source
```

**Web admin**

Visit `http://localhost:8000/admin`, open the **Source** tab, drag-drop a
file, then click **Push now**.

The default source password is `hackme`. Override it via
`auth.sourcePassword` in `config/config.yaml` or the `RADIO_SOURCE_PASSWORD`
environment variable.

### Listen

- Browser: <http://localhost:8000/stream> or <http://localhost:8000/live.mp3>
- VLC: `vlc http://localhost:8000/live.mp3`
- Archive: visit `/admin` → **Archive** tab.

### Commands

| Command           | What it does                                              |
|-------------------|-----------------------------------------------------------|
| `pnpm install`    | Install all workspace dependencies                        |
| `pnpm dev`        | Run server only (with `tsx watch`)                        |
| `pnpm dev:all`    | Run server and web bundler in parallel                    |
| `pnpm build`      | TypeScript build for every package (`tsc`)                |
| `pnpm start`      | Start the prebuilt server (`dist/server.js`)              |
| `pnpm test`       | Run all tests once (vitest)                               |
| `pnpm typecheck`  | `tsc --noEmit` across every package                       |
| `pnpm clean`      | Remove every package's `dist/`                            |

### Configuration

All runtime configuration lives in `config/config.yaml`:

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

playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]
```

Selected environment overrides:

- `RADIO_PORT` — override `server.port`
- `RADIO_HOST` — override `server.host`
- `RADIO_SOURCE_PASSWORD` — override `auth.sourcePassword`
- `RADIO_DB_PATH` — override `db.path`

### Plugin system

Each feature is a workspace package under `packages/plugins/*` with its own
`manifest.json`. The discoverer walks the plugins directory at startup, the
loader imports each `dist/index.js` (or `src/index.ts` under tsx in dev) and
the registry exposes the resulting `Plugin` objects.

A plugin implements:

```ts
export default function createMyPlugin(): Plugin {
  return {
    name: 'my-plugin',
    version: '0.1.0',
    init(ctx) { /* register routes, services */ },
    start() { /* async setup */ },
    stop() { /* async teardown */ },
  }
}
```

See [`packages/core/src/plugin-system`](packages/core/src/plugin-system) for
the discoverer/loader/registry contracts and
[`packages/plugins`](packages/plugins) for working examples.

### Troubleshooting

| Symptom                              | Fix                                                                                       |
|--------------------------------------|-------------------------------------------------------------------------------------------|
| macOS Gatekeeper blocks bundled ffmpeg | System Settings → Privacy & Security → "Open Anyway"                                    |
| ffmpeg download fails                | Check outbound access to `github.com/BtbN`, or drop a binary into `bin/ffmpeg/current/`  |
| Port 8000 already in use             | Change `server.port` in `config.yaml`                                                     |
| Stream returns 401                   | Password mismatch — `auth.sourcePassword` must match the value sent by the source client |
| Silent listen                        | Confirm a push is active and the listener URL is correct                                  |

### License

MIT

---

<a id="中文"></a>

## 中文

### 特性

- **零配置启动** — 自动检测或下载指定版本的 ffmpeg，无需手动安装
- **双入口推流** — 兼容 ffmpeg / VLC 命令行 PUT，也支持 Web 界面拖拽上传
- **实时收听** — `/stream`、`/live.mp3` 双 URL，浏览器和 Icecast 客户端均可播放
- **自动存档** — 持续推流时按整点切片为 MP3，支持回放最近 N 天
- **管理界面** — 状态面板、歌单管理、听众日志、ffmpeg 下载进度
- **插件化架构** — 服务端能力全部位于 `@radio-services/plugins/*`，启动时自动发现

### 项目结构

```
radioServices/
├── packages/
│   ├── shared/          # @radio-services/shared      — 类型、配置、接口契约
│   ├── core/            # @radio-services/core        — 服务、数据库、插件系统
│   ├── server/          # @radio-services/server      — Fastify HTTP/WS 服务
│   ├── web/             # @radio-services/web         — 浏览器管理界面打包产物
│   └── plugins/
│       ├── playlist/    # @radio-services/plugin-playlist
│       ├── archive/     # @radio-services/plugin-archive
│       ├── listeners/   # @radio-services/plugin-listeners
│       └── ffmpeg/      # @radio-services/plugin-ffmpeg
├── tests/               # 工作区根测试（vitest）
├── bin/                 # 运行时数据：ffmpeg / 存档 / 上传
├── config/              # config.example.yaml 配置模板
├── docs/                # 设计规格 / 实施计划 / 参考资料
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

### 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                   radioServices (Node.js)                    │
│                                                              │
│  ┌──────────┐     ┌────────────────┐     ┌──────────────┐   │
│  │ ffmpeg / │────▶│  Source        │     │  Listener    │◀──┼─── 浏览器 / VLC
│  │ 浏览器   │ PUT │  Receiver      │◀───▶│  Broadcaster │──▶│── 浏览器 / VLC
│  └──────────┘     └───────┬────────┘     └──────────────┘   │
│       │                   │                                 │
│       │           ┌───────▼────────┐                        │
│       │           │   Archiver     │（ffmpeg 插件）         │
│       │           └───────┬────────┘                        │
│       │                   │                                 │
│       │           ┌───────▼────────┐                        │
│       │           │ bin/archive/   │                        │
│       │           │ YYYY-MM-DD-HH.mp3                       │
│       │           └────────────────┘                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  SQLite  (歌单 / 配置 / 听众日志)                       │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Admin Web UI  (由 @radio-services/web 打包)            │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                插件系统（@radio-services/core）
                加载顺序：playlist / archive / listeners / ffmpeg
```

### 快速上手

```bash
# 1. 安装依赖（需要 pnpm 9+）
pnpm install

# 2. 初始化配置
cp config/config.example.yaml config/config.yaml

# 3. 先构建 shared 与 core（下游包依赖它们的 dist/）
pnpm --filter @radio-services/shared build
pnpm --filter @radio-services/core   build

# 4. 启动开发服务（server 监听 :8000，web 用 esbuild --watch）
pnpm dev
# 也可并行启动所有包的 dev 脚本
pnpm dev:all
```

首次启动时，`bin/ffmpeg/current/` 是空的。`ffmpeg` 插件会检查文件系统，
回退到 GitHub 下载对应版本，校验 SHA-256 后解压到目标目录。Web 界面通过
WebSocket 订阅下载进度，下载完成会自动刷新状态面板。

### 推流音频

**命令行推流（使用项目内 ffmpeg）**

```bash
./bin/ffmpeg/current/ffmpeg -re -i your_audio.mp3 \
  -c copy -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source
```

**Web 界面上传**

浏览器打开 `http://localhost:8000/admin`，进入「推流」标签页，拖拽上传音频文件，点击「立即推流」。

默认推流密码为 `hackme`，可通过 `config.yaml` 的 `auth.sourcePassword`
字段或环境变量 `RADIO_SOURCE_PASSWORD` 修改。

### 收听

- 浏览器：<http://localhost:8000/stream> 或 <http://localhost:8000/live.mp3>
- VLC：`vlc http://localhost:8000/live.mp3`
- 回放：访问 `/admin` 页面，进入「回放」标签页

### 常用命令

| 命令              | 作用                                                  |
|-------------------|-------------------------------------------------------|
| `pnpm install`    | 安装整个工作区的依赖                                   |
| `pnpm dev`        | 仅启动 server（含 `tsx watch` 热重启）                |
| `pnpm dev:all`     | 并行启动 server 与 web 的 watch                       |
| `pnpm build`      | 每个包都执行 `tsc` 编译                               |
| `pnpm start`      | 启动预先构建好的 server（`dist/server.js`）          |
| `pnpm test`       | 运行所有测试（vitest）                                |
| `pnpm typecheck`  | 每个包执行 `tsc --noEmit`                             |
| `pnpm clean`      | 删除所有包下的 `dist/`                                |

### 配置说明

所有运行时配置位于 `config/config.yaml`：

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

playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]
```

支持的环境变量覆盖：

- `RADIO_PORT` — 覆盖 `server.port`
- `RADIO_HOST` — 覆盖 `server.host`
- `RADIO_SOURCE_PASSWORD` — 覆盖 `auth.sourcePassword`
- `RADIO_DB_PATH` — 覆盖 `db.path`

> ⚠️ **安全提醒**：生产部署前请修改 `auth.sourcePassword`。启动时若使用默认值，服务器会在日志中打印警告，但这是 fail-open 检查，不应作为唯一防线。

### 插件系统

每个特性都是一个工作区包，位于 `packages/plugins/*`，并附带 `manifest.json`。启动时 discoverer 扫描该目录，loader 负责加载 `dist/index.js`（dev 模式由 tsx 加载 `src/index.ts`），registry 统一对外暴露 `Plugin` 实例。

插件接口：

```ts
export default function createMyPlugin(): Plugin {
  return {
    name: 'my-plugin',
    version: '0.1.0',
    init(ctx) { /* 注册路由 / 服务 */ },
    start() { /* 异步启动 */ },
    stop() { /* 异步停止 */ },
  }
}
```

更详细的发现器 / 加载器 / 注册中心契约见
[`packages/core/src/plugin-system`](packages/core/src/plugin-system)；
可运行的样例见 [`packages/plugins`](packages/plugins)。

### 故障排查

| 症状                                 | 处理                                                                     |
|--------------------------------------|--------------------------------------------------------------------------|
| macOS Gatekeeper 阻止 ffmpeg 执行      | 系统设置 → 隐私与安全性 → 仍要打开                                       |
| ffmpeg 下载失败                       | 检查 `github.com/BtbN` 的网络连通性，或手动放入 `bin/ffmpeg/current/`     |
| 8000 端口被占用                       | 修改 `config.yaml` 中的 `server.port`                                    |
| 推流返回 401                          | 密码不匹配：`auth.sourcePassword` 必须与推流端一致                       |
| 听众收听无声音                       | 确认推流正在进行，检查浏览器 / VLC 连接的 URL                             |

### 许可

MIT
