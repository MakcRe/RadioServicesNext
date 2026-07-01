# @radio-services/plugins

Built-in plugins for `@radio-services/core`. Each plugin is its own
workspace package so it can be built, typechecked, and versioned
independently. The discoverer walks this directory at startup.

| Package                                        | Purpose                                                      | Priority |
|------------------------------------------------|--------------------------------------------------------------|----------|
| [`playlist`](./playlist/README.md)             | Playlist/upload queue + `/api/source/*` + `/api/playlist`    | 10       |
| [`archive`](./archive/README.md)               | Hourly MP3 segmenter + `/api/archive/*`                      | 20       |
| [`listeners`](./listeners/README.md)           | Live-listener bookkeeping + `/api/listeners/*`               | 30       |
| [`ffmpeg`](./ffmpeg/README.md)                 | Auto-install / version switch + `/api/ffmpeg/*`              | 40       |

Lower priority numbers load first. The playlist plugin registers routes
that the source view depends on, so it leads.

## Layout

```
packages/plugins/
├── manifest.json            # list of plugin folder names; the registry scans these
├── playlist/
│   ├── manifest.json        # { name, version, entry, source? }
│   ├── package.json         # @radio-services/plugin-playlist
│   ├── src/
│   │   ├── index.ts         # default-export factory: () => Plugin
│   │   ├── routes/
│   │   ├── services/
│   │   └── repos/
│   └── tsconfig.json
├── archive/...
├── listeners/...
└── ffmpeg/...
```

The umbrella `manifest.json` exists so additional plugins can be added
without code changes — drop a folder in here and the discoverer picks it
up at next boot. Each plugin's package also publishes its own
`manifest.json` (read by the loader for entry, source, and priority).

## Writing a new plugin

1. Add a folder under `packages/plugins/<name>/`.
2. Copy a peer plugin's `package.json`, change `name` to
   `@radio-services/plugin-<name>`.
3. Add `manifest.json`:
   ```json
   { "name": "<name>", "version": "0.1.0", "entry": "dist/index.js", "source": "src/index.ts", "priority": 50 }
   ```
4. Implement the default-export factory in `src/index.ts`:
   ```ts
   import type { Plugin, PluginContext } from '@radio-services/shared';

   export default function createMyPlugin(): Plugin {
     let ctx!: PluginContext;
     return {
       name: '<name>',
       version: '0.1.0',
       init(c) { ctx = c; ctx.registerRoute({ method: 'GET', url: '/api/<name>/ping', handler: () => ({ ok: true }) }); },
       async start() {},
       async stop() {},
     };
   }
   ```
5. Append `"<name>"` to the umbrella `manifest.json`.
6. Build (`pnpm --filter @radio-services/plugin-<name> build`) and restart
   the server.

See [`@radio-services/core`](../core/README.md) for the full plugin
runtime contract.

## Build & test

There is no aggregate build script — each plugin runs its own:

```bash
pnpm --filter @radio-services/plugin-playlist build
pnpm --filter @radio-services/plugin-archive  build
pnpm --filter @radio-services/plugin-listeners build
pnpm --filter @radio-services/plugin-ffmpeg    build
```

Plugin-level integration tests live at the workspace root
(`tests/integration/*`); unit tests for internal helpers live next to the
plugin code in `src/`.

## License

MIT
