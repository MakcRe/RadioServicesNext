# @radio-services/web

Browser admin UI for radioServices. A small, framework-free TypeScript bundle
that the Fastify server serves under `/admin`.

- Vanilla TS — no React/Vue/Svelte runtime. The bundle ships raw DOM calls.
- Bundled by esbuild into `dist/app.js` (+ `dist/app.css`) in `esm` format.
- Talks to the server over the same JSON endpoints and a single WebSocket.
- Re-exports its API from `index.ts` so it can also be consumed in headless
  contexts (integration tests, smoke checks).

## Scripts

```bash
pnpm dev       # esbuild --watch (rebuilds on save)
pnpm build     # esbuild production bundle → dist/app.js + dist/app.css
pnpm typecheck # tsc --noEmit
```

The build does not depend on `@radio-services/shared` being prebuilt — it
imports types via the workspace alias declared in `package.json` (both
`dependencies` and `devDependencies`), so `tsc` resolves `dist/index.d.ts`
when the package is built and falls through cleanly otherwise.

> TypeScript will not find types unless you have previously run
> `pnpm --filter @radio-services/shared build`. If you want zero-build
> typecheck, add a `paths` entry to `tsconfig.json` pointing at
> `../shared/src/index.ts`.

## Public API

```ts
import {
  api,                        // fetch wrapper
  startFfmpegDownloadStream,  // SSE consumer
  wsClient,                   // WebSocket helper
  $, $$,                       // tiny DOM helpers
  initDashboard, renderSource, renderListeners,
  renderArchive, renderFfmpegPanel,
} from '@radio-services/web';
```

Most callers are the entry point itself (`src/main.ts`), which boots one of
the `renderX` views. The other helpers stay exported for testing and for
view modules to share.

## HTTP endpoints used

| Endpoint                          | Direction     | Notes                                  |
|-----------------------------------|---------------|----------------------------------------|
| `GET /api/status`                | poll          | status dashboard                       |
| `GET /api/config` / `PUT /api/config` | read / write | settings panel                      |
| `GET /api/source/files`          | poll          | source / playlist tab                  |
| `POST /api/source/upload`        | action        | file upload form                       |
| `GET /api/playlist`              | poll          | queue ordering                         |
| `GET /api/listeners/{current,history}` | poll    | listener tab                           |
| `GET /api/archive/list`          | poll          | archive tab                            |
| `GET /api/ffmpeg/status`         | poll          | ffmpeg panel                           |
| `GET /api/ffmpeg/download/status`| SSE stream    | download progress                      |
| `POST /api/ffmpeg/{select,download}` | action   | version switch + manual download       |
| `WS  /ws/*`                      | push          | event fanout (registered by plugins)   |

## Project structure

```
packages/web/
├── src/
│   ├── main.ts            # entry — boots the dashboard
│   ├── api-client.ts      # fetch + SSE helper
│   ├── ws-client.ts       # WebSocket wrapper
│   ├── ui.ts              # tiny DOM helpers
│   ├── types.ts           # mirrored response/event types
│   ├── styles.css         # plain CSS, copied to dist/app.css
│   └── views/
│       ├── dashboard.ts
│       ├── source.ts
│       ├── listeners.ts
│       ├── archive.ts
│       └── ffmpeg-panel.ts
├── esbuild.config.mjs     # bundler entry point
├── package.json
└── tsconfig.json
```

## Styling

There is **no CSS framework**. `styles.css` is hand-written, copied into
`dist/app.css` at build time, and served alongside `dist/app.js`. Themes
are toggled by adding/removing a single `dark` class on `<body>`.

## Adding a new view

1. Create `src/views/<name>.ts` exporting `render<X>(host: HTMLElement, deps)`.
2. Re-export it from `src/index.ts`.
3. Add a navigation entry in `src/main.ts` (or wherever routing lives).

## License

MIT
