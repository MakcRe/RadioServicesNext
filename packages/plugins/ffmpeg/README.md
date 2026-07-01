# @radio-services/plugin-ffmpeg

Built-in plugin that owns the local ffmpeg installation. On startup it
checks whether an ffmpeg binary is already on disk under
`config.ffmpeg.binRoot`; if not, it falls back to GitHub
(`config.ffmpeg.sourceUrl`), downloads the pinned release, verifies
SHA-256, extracts it, and exposes the result through the admin UI's
"FFmpeg" tab.

- Routes: `GET /api/ffmpeg/status`, `POST /api/ffmpeg/download`, `POST /api/ffmpeg/select`, `GET /api/ffmpeg/versions`, `GET /api/ffmpeg/remote-versions`
- Live progress: `GET /api/ffmpeg/download/status` (Server-Sent Events)
- Services on `PluginContext`: `ffmpegManager`, `runtimeState`
- Depends on: `keyv`, `keyv-file`, `pino`, `@radio-services/shared`, `@radio-services/core`

## How it works

- `FfmpegManager.initialize()` runs at boot. It probes `binRoot`, and if
  no binary is present triggers a download via `FfmpegDownloader`.
- Downloads run as a child process writing `*.tar.xz` chunks to disk and
  streaming progress events through a `WsHub` channel (e.g. `/ws/ffmpeg`).
- The runtime state — currently selected version, last download URL —
  is persisted via `keyv-file` so it survives restarts.
- `POST /api/ffmpeg/select` switches the active version without
  re-downloading if a release was already extracted for it.
- `POST /api/ffmpeg/download` forces a redownload — useful after a
  corrupt extraction.

If the system has an `ffmpeg` binary on `PATH`, the manager also accepts
that as a fallback (`config.ffmpeg.ffmpegPathOverride` takes precedence
over both).

## Configuration

```yaml
ffmpeg:
  version: "7.1"                    # version to download if not present
  sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  binRoot: "bin/ffmpeg"             # relative-to-cwd install directory
  ffmpegPathOverride: null          # optional, absolute path overrides everything else
```

## HTTP surface

| Method | URL                                 | Description                                |
|--------|-------------------------------------|--------------------------------------------|
| `GET`  | `/api/ffmpeg/status`                | Current binary, version, availability.     |
| `GET`  | `/api/ffmpeg/versions`              | Locally installed versions.                |
| `GET`  | `/api/ffmpeg/remote-versions`       | Versions published upstream.               |
| `POST` | `/api/ffmpeg/select`                | Switch active version.                     |
| `POST` | `/api/ffmpeg/download`              | Force a redownload.                        |
| `GET`  | `/api/ffmpeg/download/status`       | SSE stream of progress events.             |

## Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { FFmpegManager } from './services/ffmpeg-manager.js';

export default function createFFmpegPlugin(): Plugin {
  let ctx!: PluginContext;
  return {
    name: 'ffmpeg',
    version: '0.1.0',
    async init(c) {
      ctx = c;
      // initialize runtimeState, FFmpegManager; register routes; etc.
    },
    async start() {},
    async stop() {},
  };
}
```

## Scripts

```bash
pnpm --filter @radio-services/plugin-ffmpeg build
pnpm --filter @radio-services/plugin-ffmpeg typecheck
```

## Project structure

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

## License

MIT
