# @radio-services/plugin-playlist

[English](#english) · [中文](#中文)

Highest-priority built-in plugin. Owns the upload queue and the playlist
ordering that the admin UI uses to push audio into the server.

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

### What it does

- **Routes:** `GET /api/source/files`, `POST /api/source/upload`, `GET /api/playlist`
- **Services registered on `PluginContext`:** `playlistService`, `uploadService`
- **Persistence:** SQLite (`playlist` + `uploaded_files` tables)
- **Dependencies:** `better-sqlite3`, `@radio-services/shared`, `@radio-services/core`

### Scripts

```bash
pnpm --filter @radio-services/plugin-playlist build       # tsc → dist/
pnpm --filter @radio-services/plugin-playlist typecheck   # tsc --noEmit
```

In production (`pnpm start`) the loader uses `manifest.entry → dist/index.js`.
In dev (`pnpm dev`), `manifest.source → src/index.ts` is used and tsx/esm
transpiles on the fly — no prior build needed.

See the [umbrella README](../README.md#manifestjson-field-reference) for the
full `manifest.json` field reference.

### Routes registered by `init`

| Method | URL                    | Purpose                                             |
|--------|------------------------|-----------------------------------------------------|
| `GET`  | `/api/source/files`    | List uploaded source files (id, name, size, etc.).  |
| `POST` | `/api/source/upload`   | Multipart upload to `playlist.uploadDir`.           |
| `GET`  | `/api/playlist`        | List queue items in playback order.                 |

### SQLite schema

Tables created on first DB init (`packages/core/src/db/schema.sql`):

- `playlist` — ordered rows pointing at entries in `uploaded_files`.
- `uploaded_files` — actual file metadata + on-disk path.

The plugin uses `better-sqlite3` prepared statements for both. Repos live
in `src/repos/`.

### Configuration

This plugin reads the canonical `playlist` block from `RadioConfig`:

```yaml
playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]
```

`upload-service.ts` enforces the size and extension limits before
persisting; `playlist-service.ts` operates only on rows already in the DB.

### Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { PlaylistService } from './services/playlist-service.js';
import { UploadService } from './services/upload-service.js';
import { PlaylistRepo } from './repos/playlist.repo.js';
import { UploadedFilesRepo } from './repos/uploaded-files.repo.js';

export { PlaylistService, UploadService };

export default function createPlaylistPlugin(): Plugin {
  let ctx!: PluginContext;
  return {
    name: 'playlist',
    version: '0.1.0',
    init(c) {
      ctx = c;
      const db = ctx.getService<Database.Database>('db');
      const playlistRepo  = new PlaylistRepo(db);
      const uploadedRepo  = new UploadedFilesRepo(db);
      const playlistService = new PlaylistService(playlistRepo);
      const uploadService   = new UploadService(uploadedRepo, /* ... */);
      registerPlaylistRoutes(ctx, { playlistService, uploadService });
      ctx.registerService('playlistService', playlistService);
      ctx.registerService('uploadService',   uploadService);
    },
    async start() {},
    async stop() {},
  };
}
```

### Project structure

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

### License

MIT

---

<a id="中文"></a>

## 中文

### 作用

- **路由**：`GET /api/source/files`、`POST /api/source/upload`、`GET /api/playlist`
- **注册到 `PluginContext` 的服务**：`playlistService`、`uploadService`
- **持久化**：SQLite（`playlist` 与 `uploaded_files` 两张表）
- **依赖**：`better-sqlite3`、`@radio-services/shared`、`@radio-services/core`

### 脚本

```bash
pnpm --filter @radio-services/plugin-playlist build       # tsc → dist/
pnpm --filter @radio-services/plugin-playlist typecheck   # tsc --noEmit
```

生产环境（`pnpm start`）走 `manifest.entry` 即 `dist/index.js`；开发环境
（`pnpm dev`）走 `manifest.source` 即 `src/index.ts`，由 tsx/esm 即时转译，
无需预先构建。完整字段说明见 [伞形 README](../README.md#manifestjson-字段详解)。

### `init()` 注册的路由

| 方法   | URL                    | 用途                                              |
|--------|------------------------|---------------------------------------------------|
| `GET`  | `/api/source/files`    | 列出已上传的源文件（id、名称、大小等）            |
| `POST` | `/api/source/upload`   | 通过 multipart 上传文件到 `playlist.uploadDir`   |
| `GET`  | `/api/playlist`        | 列出播放队列（按播放顺序）                        |

### SQLite schema

数据库首次初始化时（`packages/core/src/db/schema.sql`）创建：

- `playlist` —— 顺序队列，指向上传文件表中的条目
- `uploaded_files` —— 文件元数据 + 磁盘路径

全部使用 `better-sqlite3` 预编译语句，对应 repo 实现位于 `src/repos/`。

### 配置

读取 `RadioConfig` 中标准的 `playlist` 段：

```yaml
playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]
```

`upload-service.ts` 在落盘前强制校验大小与扩展名；
`playlist-service.ts` 仅操作已落库的记录。

### 插件签名

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
      // 创建 service / repo，注册路由
      // ctx.registerService('playlistService', playlistService);
    },
    async start() {},
    async stop() {},
  };
}
```

### 项目结构

```
packages/plugins/playlist/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts
│   ├── routes/playlist.ts
│   ├── services/playlist-service.ts
│   └── services/upload-service.ts
│   └── repos/{playlist,uploaded-files}.repo.ts
└── tsconfig.json
```

### 许可

MIT