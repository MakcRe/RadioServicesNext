# @radio-services/plugin-ffmpeg

[English](#english) · [中文](#中文)

Built-in plugin that owns the local ffmpeg installation. On startup it
checks whether an ffmpeg binary is already on disk under
`config.ffmpeg.binRoot`; if not, it falls back to GitHub
(`config.ffmpeg.sourceUrl`), downloads the pinned release, verifies
SHA-256, extracts it, and exposes the result through the admin UI's
"FFmpeg" tab.

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

### What it does

- **Routes:** `GET /api/ffmpeg/status`, `POST /api/ffmpeg/download`, `POST /api/ffmpeg/select`, `GET /api/ffmpeg/versions`, `GET /api/ffmpeg/remote-versions`
- **Live progress:** `GET /api/ffmpeg/download/status` (Server-Sent Events)
- **Services registered on `PluginContext`:** `ffmpegManager`, `runtimeState`
- **Dependencies:** `keyv`, `keyv-file`, `pino`, `@radio-services/shared`, `@radio-services/core`

### How it works

- `FfmpegManager.initialize()` runs at boot. It probes `binRoot`, and if
  no binary is present triggers a download via `FfmpegDownloader`.
- Downloads run as a child process writing `*.tar.xz` chunks to disk and
  streaming progress events through a `WsHub` channel (e.g. `/ws/ffmpeg`).
- The runtime state — currently selected version, last download URL —
  is persisted via `keyv-file` so it survives restarts.
- `POST /api/ffmpeg/select` switches the active version without
  re-downloading if a release was already extracted for it.
- `POST /api/ffmpeg/download` forces a re-download — useful after a
  corrupt extraction.

If the system has an `ffmpeg` binary on `PATH`, the manager also accepts
that as a fallback (`config.ffmpeg.ffmpegPathOverride` takes precedence
over both).

### Configuration

```yaml
ffmpeg:
  version: "7.1"                    # version to download if not present
  sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  binRoot: "bin/ffmpeg"             # relative-to-cwd install directory
  ffmpegPathOverride: null          # optional, absolute path overrides everything else
```

### HTTP surface

| Method | URL                                 | Description                                |
|--------|-------------------------------------|--------------------------------------------|
| `GET`  | `/api/ffmpeg/status`                | Current binary, version, availability.     |
| `GET`  | `/api/ffmpeg/versions`              | Locally installed versions.                |
| `GET`  | `/api/ffmpeg/remote-versions`       | Versions published upstream.               |
| `POST` | `/api/ffmpeg/select`                | Switch active version.                     |
| `POST` | `/api/ffmpeg/download`              | Force a re-download.                       |
| `GET`  | `/api/ffmpeg/download/status`       | SSE stream of progress events.             |

### Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { FFmpegManager, normalizeVersion } from './services/ffmpeg-manager.js';
import type { FfmpegRuntimeState } from './services/ffmpeg-state.js';
import type { WsHub } from '@radio-services/core';
import { registerFfmpegRoutes } from './routes/ffmpeg.js';

export { FFmpegManager, normalizeVersion };

export default function createFFmpegPlugin(): Plugin {
  let ctx!: PluginContext;
  let ffmpegManager: FFmpegManager;
  let runtimeState: FfmpegRuntimeState;
  return {
    name: 'ffmpeg',
    version: '0.1.0',
    async init(c) {
      ctx = c;

      const { createFfmpegRuntimeState, defaultStatePath } =
        await import('./services/ffmpeg-state.js');
      runtimeState = createFfmpegRuntimeState(defaultStatePath(ctx.config.ffmpeg.binRoot ?? 'bin/ffmpeg'));

      ffmpegManager = new FFmpegManager({
        binRoot: ctx.config.ffmpeg.binRoot ?? 'bin/ffmpeg',
        version: ctx.config.ffmpeg.version,
        downloadUrl: ctx.config.ffmpeg.sourceUrl,
        ffmpegPathOverride: ctx.config.ffmpeg.ffmpegPathOverride,
        logger: ctx.logger as unknown as import('pino').Logger,
        runtimeState,
      });

      const wsHub = ctx.getService<WsHub>('wsHub');
      if (!wsHub) throw new Error('WsHub service not available');

      await ffmpegManager.initialize();
      registerFfmpegRoutes(ctx, { ffmpegManager, wsHub, runtimeState });
      ctx.registerService('ffmpegManager', ffmpegManager);
      ctx.registerService('runtimeState',   runtimeState);
    },
    async start() { ctx.logger.info('FFmpeg plugin started'); },
    async stop()  { await runtimeState.close(); ctx.logger.info('FFmpeg plugin stopped'); },
    async healthCheck() {
      return { healthy: true, ffmpegAvailable: ffmpegManager.getStatus().available };
    },
  };
}
```

### Scripts

```bash
pnpm --filter @radio-services/plugin-ffmpeg build
pnpm --filter @radio-services/plugin-ffmpeg typecheck
```

See the [umbrella README](../README.md#manifestjson-field-reference) for the
full `manifest.json` field reference.

### Project structure

```
packages/plugins/ffmpeg/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts
│   ├── routes/ffmpeg.ts
│   ├── services/
│   │   ├── ffmpeg-manager.ts        # boot + selection logic
│   │   ├── ffmpeg-downloader.ts     # GitHub fetch + verify
│   │   └── ffmpeg-state.ts          # keyv-file persistence
│   └── types/download-state.ts      # SSE event types
└── tsconfig.json
```

### License

MIT

---

<a id="中文"></a>

## 中文

### 作用

- **路由**：`GET /api/ffmpeg/status`、`POST /api/ffmpeg/download`、`POST /api/ffmpeg/select`、`GET /api/ffmpeg/versions`、`GET /api/ffmpeg/remote-versions`
- **实时进度**：`GET /api/ffmpeg/download/status`（Server-Sent Events）
- **注册到 `PluginContext` 的服务**：`ffmpegManager`、`runtimeState`
- **依赖**：`keyv`、`keyv-file`、`pino`、`@radio-services/shared`、`@radio-services/core`

### 工作原理

- 启动阶段 `FfmpegManager.initialize()` 检查 `binRoot`，如果目录里没有
  ffmpeg，就调 `FfmpegDownloader` 去下载。
- 下载由子进程负责，把 `*.tar.xz` 流式写入磁盘，通过 `WsHub`（如
  `/ws/ffmpeg`）向浏览器发送进度事件。
- 运行时状态（当前选中版本、最近一次下载 URL）通过 `keyv-file` 持久化，
  重启后仍生效。
- `POST /api/ffmpeg/select` 切换当前版本——若对应版本已解压过，不会重新下载。
- `POST /api/ffmpeg/download` 强制重下载——在解压损坏时使用。

若系统 `PATH` 上有 `ffmpeg`，也可以作为兜底来源（`config.ffmpeg.ffmpegPathOverride`
优先级最高，会同时跳过项目内二进制与系统二进制）。

### 配置

```yaml
ffmpeg:
  version: "7.1"                    # 缺二进制时下载的版本
  sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  binRoot: "bin/ffmpeg"             # 相对 cwd 的安装目录
  ffmpegPathOverride: null          # 可选，绝对路径，优先级最高
```

### HTTP 接口

| 方法   | URL                                | 说明                                |
|--------|------------------------------------|-------------------------------------|
| `GET`  | `/api/ffmpeg/status`               | 当前二进制路径、版本、可用性        |
| `GET`  | `/api/ffmpeg/versions`             | 本地已安装的版本                    |
| `GET`  | `/api/ffmpeg/remote-versions`      | 上游可下载的版本                    |
| `POST` | `/api/ffmpeg/select`               | 切换当前版本                        |
| `POST` | `/api/ffmpeg/download`             | 强制重新下载                        |
| `GET`  | `/api/ffmpeg/download/status`      | SSE 进度推送                        |

### 插件签名

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { FFmpegManager } from './services/ffmpeg-manager.js';

export default function createFFmpegPlugin(): Plugin {
  let ctx!: PluginContext;
  let ffmpegManager: FFmpegManager;
  return {
    name: 'ffmpeg',
    version: '0.1.0',
    async init(c) {
      ctx = c;
      // 1. 创建 runtimeState（keyv-file）
      // 2. new FFmpegManager(...)
      // 3. 拿到 wsHub，注册路由
      // 4. await ffmpegManager.initialize()
      // 5. ctx.registerService('ffmpegManager', ffmpegManager)
    },
    async start() {},
    async stop() { await runtimeState.close(); },
    async healthCheck() {
      return { healthy: true, ffmpegAvailable: ffmpegManager.getStatus().available };
    },
  };
}
```

### 脚本

```bash
pnpm --filter @radio-services/plugin-ffmpeg build
pnpm --filter @radio-services/plugin-ffmpeg typecheck
```

完整字段说明见 [伞形 README](../README.md#manifestjson-字段详解)。

### 项目结构

```
packages/plugins/ffmpeg/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts
│   ├── routes/ffmpeg.ts
│   ├── services/
│   │   ├── ffmpeg-manager.ts
│   │   ├── ffmpeg-downloader.ts
│   │   └── ffmpeg-state.ts
│   └── types/download-state.ts
└── tsconfig.json
```

### 许可

MIT