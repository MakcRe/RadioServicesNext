# @radio-services/plugin-playlist

First-priority built-in plugin. Owns the upload queue and the playlist
ordering that the admin UI uses to push audio into the server.

- Routes: `GET /api/source/files`, `POST /api/source/upload`, `GET /api/playlist`
- Services on `PluginContext`: `playlistService`, `uploadService`
- Persistence: SQLite (`playlist_repo`, `uploaded_files_repo`)
- Depends on: `better-sqlite3`, `@radio-services/shared`, `@radio-services/core`

## Scripts

```bash
pnpm --filter @radio-services/plugin-playlist build       # tsc → dist/
pnpm --filter @radio-services/plugin-playlist typecheck   # tsc --noEmit
```

This plugin is consumed via `dist/index.js`. In dev mode (`pnpm dev`) the
core plugin loader transparently falls back to `src/index.ts` via the
`source` field in `manifest.json`, so you do not need to rebuild while
iterating.

## Routes registered by `init`

| Method | URL                    | Purpose                                            |
|--------|------------------------|----------------------------------------------------|
| `GET`  | `/api/source/files`    | List uploaded source files (id, name, size, etc.). |
| `POST` | `/api/source/upload`   | Multipart upload to `playlist.uploadDir`.          |
| `GET`  | `/api/playlist`        | List queue items in playback order.                |

## SQLite schema

Tables created on first DB init (`@radio-services/core/db/schema.sql`):

- `playlist` — ordered rows pointing at entries in `uploaded_files`.
- `uploaded_files` — actual file metadata + on-disk path.

The plugin uses `better-sqlite3` prepared statements for both. Repos live
in `src/repos/`.

## Configuration

This plugin reads nothing exotic from `RadioConfig` — it consumes the
canonical `playlist` block:

```yaml
playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]
```

`upload-service.ts` enforces the size and extension limits before
persisting; `playlist-service.ts` operates only on rows already in the DB.

## Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';

export default function createPlaylistPlugin(): Plugin {
  let ctx!: PluginContext;
  return {
    name: 'playlist',
    version: '0.1.0',
    init(c) {
      ctx = c;
      const db = ctx.getService<Database.Database>('db');
      // wire routes, services...
    },
    async start() {},
    async stop() {},
  };
}
```

## Project structure

```
packages/plugins/playlist/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts             # factory + re-exports
│   ├── routes/playlist.ts
│   ├── services/playlist-service.ts
│   ├── services/upload-service.ts
│   └── repos/{playlist,uploaded-files}.repo.ts
└── tsconfig.json
```

## License

MIT
