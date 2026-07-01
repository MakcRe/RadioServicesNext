# @radio-services/plugin-archive

[English](#english) · [中文](#中文)

Built-in plugin that records everything flowing through the broadcaster
by piping the source stream into an ffmpeg `segment` muxer. Slices land as
`YYYY-MM-DD-HH.mp3` files in the configured archive directory and are
deleted after the configured retention window.

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

### What it does

- **Routes:** `GET /api/archive/list`
- **Service registered on `PluginContext`:** `archiver`
- **Storage:** plain MP3 files on disk (no DB)
- **Dependencies:** `pino` (typed logger), `@radio-services/shared`, `@radio-services/core`

### How it works

`Archiver.start(sourceStream)` spawns an ffmpeg child process with
`-f segment -segment_atclocktime 1 -strftime 1`, which writes one file
per clock hour. A periodic cleanup sweep removes files older than
`config.archive.retentionDays`.

The plugin reads its ffmpeg binary path lazily, by asking the ffmpeg
plugin for its manager (`ctx.getService('ffmpegManager')`). If no ffmpeg
is available yet, `init` throws — the server surfaces a clear error in
the log and the plugin is not registered.

### Configuration

```yaml
archive:
  directory: "bin/archive"          # output dir
  segmentDurationSec: 3600          # 1 hour per slice
  retentionDays: 7                  # delete files older than N days
  minFreeSpaceMB: 500               # reserved for future alerting
```

`minFreeSpaceMB` is reserved by the config schema but not yet enforced
at runtime — the cleanup sweep is time-based only.

### Scripts

```bash
pnpm --filter @radio-services/plugin-archive build
pnpm --filter @radio-services/plugin-archive typecheck
```

See the [umbrella README](../README.md#manifestjson-field-reference) for the
full `manifest.json` field reference.

### Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { Archiver } from './services/archiver.js';
import { registerArchiveRoutes } from './routes/archive.js';

export { Archiver };

export default function createArchivePlugin(): Plugin {
  let archiver: Archiver;
  let ctx!: PluginContext;
  return {
    name: 'archive',
    version: '0.1.0',
    init(c) {
      ctx = c;

      archiver = new Archiver({
        getFfmpegPath: () => {
          const mgr = ctx.getService<{ getStatus(): { path: string | null } }>('ffmpegManager');
          return mgr?.getStatus().path ?? null;
        },
        archiveDir: ctx.config.archive.directory,
        segmentDurationSec: ctx.config.archive.segmentDurationSec,
        retentionDays: ctx.config.archive.retentionDays,
        logger: ctx.logger as unknown as import('pino').Logger,
      });

      registerArchiveRoutes(ctx, { archiver });
      ctx.registerService('archiver', archiver);
    },
    async start() {
      ctx.logger.info('Archive plugin started');
    },
    async stop() {
      await archiver.stop();
      ctx.logger.info('Archive plugin stopped');
    },
    async healthCheck() {
      return { healthy: true, running: archiver.isRunning() };
    },
  };
}
```

### Project structure

```
packages/plugins/archive/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts
│   ├── routes/archive.ts
│   └── services/archiver.ts
└── tsconfig.json
```

### License

MIT

---

<a id="中文"></a>

## 中文

### 作用

- **路由**：`GET /api/archive/list`
- **注册到 `PluginContext` 的服务**：`archiver`
- **存储**：直接落盘的 MP3 文件（无数据库）
- **依赖**：`pino`（用于类型化 logger）、`@radio-services/shared`、`@radio-services/core`

### 工作原理

`Archiver.start(sourceStream)` 通过 `-f segment -segment_atclocktime 1
-strftime 1` 启动 ffmpeg 子进程，按整点写出切片文件。周期清理任务会把
早于 `config.archive.retentionDays` 的文件删除。

ffmpeg 二进制路径采用**惰性查找**：插件 `init()` 调
`ctx.getService('ffmpegManager')` 获取 ffmpeg 插件的 manager。如果尚未安装，
`init()` 直接抛错 —— 服务端会在日志打印明确错误，且该插件不会被注册。

### 配置

```yaml
archive:
  directory: "bin/archive"          # 输出目录
  segmentDurationSec: 3600          # 每片秒数（默认 1 小时）
  retentionDays: 7                  # 删除多少天前的文件
  minFreeSpaceMB: 500               # 保留字段，目前未生效
```

`minFreeSpaceMB` 已在 schema 中保留，但运行时**仅按时间清理**，未强制磁盘警戒。

### 脚本

```bash
pnpm --filter @radio-services/plugin-archive build
pnpm --filter @radio-services/plugin-archive typecheck
```

完整 `manifest.json` 字段说明见 [伞形 README](../README.md#manifestjson-字段详解)。

### 插件签名

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { Archiver } from './services/archiver.js';
import { registerArchiveRoutes } from './routes/archive.js';

export { Archiver };

export default function createArchivePlugin(): Plugin {
  let archiver: Archiver;
  let ctx!: PluginContext;
  return {
    name: 'archive',
    version: '0.1.0',
    init(c) {
      ctx = c;
      archiver = new Archiver({
        getFfmpegPath: () => {
          const mgr = ctx.getService<{ getStatus(): { path: string | null } }>('ffmpegManager');
          return mgr?.getStatus().path ?? null;
        },
        archiveDir: ctx.config.archive.directory,
        segmentDurationSec: ctx.config.archive.segmentDurationSec,
        retentionDays: ctx.config.archive.retentionDays,
        logger: ctx.logger as unknown as import('pino').Logger,
      });
      registerArchiveRoutes(ctx, { archiver });
      ctx.registerService('archiver', archiver);
    },
    async start() { ctx.logger.info('Archive plugin started'); },
    async stop()  { await archiver.stop(); },
    async healthCheck() { return { healthy: true, running: archiver.isRunning() }; },
  };
}
```

### 项目结构

```
packages/plugins/archive/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts
│   ├── routes/archive.ts
│   └── services/archiver.ts
└── tsconfig.json
```

### 许可

MIT