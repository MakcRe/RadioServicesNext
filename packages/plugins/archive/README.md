# @radio-services/plugin-archive

Built-in plugin that records everything flowing through the broadcaster by
piping the source stream into an ffmpeg `segment` muxer. Slices land as
`YYYY-MM-DD-HH.mp3` files in the configured archive directory and are
deleted after the configured retention window.

- Routes: `GET /api/archive/list`
- Services on `PluginContext`: `archiver`
- Storage: plain MP3 files on disk (no DB)
- Depends on: `pino` (for typed logger), `@radio-services/shared`, `@radio-services/core`

## How it works

`Archiver.start(sourceStream)` spawns an ffmpeg child process with
`-f segment -segment_atclocktime 1 -strftime 1`, which writes one file
per clock hour. After every successful session the cleanup timer sweeps
the archive directory and removes files older than
`config.archive.retentionDays`.

The plugin reads its ffmpeg binary path lazily, by asking the ffmpeg
plugin for its manager (`ctx.getService('ffmpegManager')`). If no ffmpeg
is available yet, `init` throws — the server surfaces a clear error in
the log and the plugin is not registered.

## Configuration

```yaml
archive:
  directory: "bin/archive"          # output dir
  segmentDurationSec: 3600          # 1 hour per slice
  retentionDays: 7                  # delete files older than N days
  minFreeSpaceMB: 500               # reserved for future alerting
```

`minFreeSpaceMB` is reserved by the config schema but not yet enforced at
runtime — the cleanup sweep is time-based only.

## Scripts

```bash
pnpm --filter @radio-services/plugin-archive build
pnpm --filter @radio-services/plugin-archive typecheck
```

## Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { Archiver } from './services/archiver.js';
import { registerArchiveRoutes } from './routes/archive.js';

export default function createArchivePlugin(): Plugin {
  let archiver: Archiver;
  let ctx!: PluginContext;
  return {
    name: 'archive',
    version: '0.1.0',
    init(c) {
      ctx = c;
      archiver = new Archiver({ /* ... */ });
      registerArchiveRoutes(ctx, { archiver });
      ctx.registerService('archiver', archiver);
    },
    async start() {},
    async stop() { await archiver.stop(); },
  };
}
```

## Project structure

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

## License

MIT
