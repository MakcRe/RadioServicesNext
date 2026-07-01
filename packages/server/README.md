# @radio-services/server

Fastify-based HTTP/WebSocket host. Wires plugins from `@radio-services/core`
into a running HTTP server and exposes the admin Web UI from
`@radio-services/web`.

This package's job is glue:

1. Construct the Fastify app.
2. Register framework services (`broadcaster`, `sourceReceiver`, `wsHub`, `db`)
   on a `PluginContextImpl` **before** plugins load, so plugins can look them up.
3. Run the plugin discoverer + loader.
4. Mount every plugin-registered route and WebSocket handler.
5. Serve the prebuilt `@radio-services/web` bundle under `/admin`.

## Scripts

```bash
pnpm dev          # node --import tsx/esm src/server.ts (no build needed)
pnpm dev:watch    # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
```

> Dev mode goes directly through `tsx`. The plugin loader's `source` field
> is what makes this work — see [`@radio-services/core`](../core/README.md)
> for the resolution rules.

## Build order

The server imports from compiled artifacts, so before running `pnpm start`
(or any CI typecheck over the full workspace):

```bash
pnpm --filter @radio-services/shared build
pnpm --filter @radio-services/core   build
pnpm --filter @radio-services/server build
```

Dev mode (`pnpm dev`) does **not** need this — `tsx` transpiles on the fly
and the loader falls back to `src/index.ts` for plugin imports.

## HTTP surface

| Method        | Path                              | Source        |
|---------------|-----------------------------------|---------------|
| `PUT /source` | Icecast-style MP3 ingest          | core          |
| `GET /stream` | Live audio stream                 | core          |
| `GET /live.mp3` | Alias for `/stream`             | core          |
| `GET /health` | Liveness                          | server        |
| `GET /api/status` | Aggregator (broadcaster, ffmpeg, listeners) | server        |
| `GET /api/config` | Redacted config snapshot       | server        |
| `PUT /api/config` | Update a single nested key     | server        |
| `GET /api/source/files` | List uploaded files      | plugins/playlist |
| `POST /api/source/upload` | Upload file            | plugins/playlist |
| `GET /api/playlist` | List queue                  | plugins/playlist |
| `GET /api/archive/list` | List archive slices      | plugins/archive  |
| `GET /api/listeners/{current,history}` | Listener data | plugins/listeners |
| `GET /api/ffmpeg/*` | ffmpeg control             | plugins/ffmpeg  |
| `GET /ws/*`   | Plugin-registered WebSocket handlers | various    |
| `GET /admin/*` | Static admin UI  (`@radio-services/web`) | web    |

The full plugin contract — including how `init`/`start`/`stop` get called —
is documented in [`@radio-services/core`](../core/README.md).

## Public API

```ts
import {
  createApp,        // builds the Fastify instance
  createLogger,     // pino logger factory
  startServer,      // boot the server
  registerConfigRoutes, // /api/config GET/PUT
} from '@radio-services/server';
```

`createApp` accepts optional dependencies for tests:

```ts
const { app } = await createApp({
  config,           // RadioConfig
  ffmpegBin,        // override ffmpeg.binRoot
  ffmpegPathOverride, // absolute path to a pre-installed ffmpeg
});
```

## Project structure

```
packages/server/
├── src/
│   ├── server.ts           # entry — listen + signal handlers
│   ├── app.ts              # createApp() — registers core services + plugins
│   ├── logger.ts           # pino logger factory
│   ├── index.ts            # public re-exports
│   ├── config.ts           # legacy yaml loader (kept for typecheck)
│   └── routes/
│       ├── stream.ts       # /stream, /live.mp3
│       ├── config.ts       # /api/config
│       └── ws.ts           # generic /ws/* fanout
├── package.json
└── tsconfig.json
```

## Logging

`createLogger(config.logging)` writes to `logs/` with size-based rotation
(via `pino-roll`) and the level from `config.logging.level`. The same
instance is passed to plugins, so all package logs share a single stream.

## License

MIT
