# @radio-services/core

Runtime services, SQLite data layer, and the plugin runtime for radioServices.

Everything in `@radio-services/server` and `@radio-services/plugins/*`
either composes with or extends services exported from this package:

- Streaming primitives (`Broadcaster`, `RingBuffer`, `SourceReceiver`)
- Live-listener bookkeeping (`ListenerManager`, `WsHub`)
- A thin SQLite layer driven by `schema.sql`
- A small plugin runtime: `PluginDiscoverer` → `PluginLoader` → `PluginRegistry` → `PluginContextImpl`

## Install / Build

Workspace package. Resolve as `"@radio-services/core": "workspace:*"`.

```bash
pnpm --filter @radio-services/core build   # tsc → dist/
pnpm --filter @radio-services/core test    # vitest
```

**Build order matters.** Consumers (`@radio-services/server` and every
plugin) read `dist/` via the `exports` map, so build `@radio-services/shared`
and then this package before any downstream typecheck.

## Public surface

### Services (`@radio-services/core/services`)

| Class             | Responsibility                                                  |
|-------------------|-----------------------------------------------------------------|
| `Broadcaster`     | Holds the live MP3 ring buffer; serves audio out to listeners.  |
| `RingBuffer`      | Backing ring for `Broadcaster`.                                 |
| `SourceReceiver`  | Authenticated HTTP `PUT /source`; pipes bytes to a `Broadcaster`. |
| `ListenerManager` | Tracks current/historical WS listeners; writes to SQLite.       |
| `WsHub`           | Process-local broadcast hub for plugin → browser events.        |

### Database (`@radio-services/core/db`)

| Export    | Description                                              |
|-----------|----------------------------------------------------------|
| `initDb`  | Opens (or creates) a SQLite database with `schema.sql`.  |

Schema lives at `src/db/schema.sql`; migrations are applied on open.

### Plugin runtime

```ts
import {
  PluginRegistry,
  PluginLoader,
  PluginContextImpl,
  PluginDiscoverer,
} from '@radio-services/core';

const registry = new PluginRegistry();
const loader = new PluginLoader(registry);
const ctx = new PluginContextImpl(logger, config);

// optional: register framework services that plugins may consume
ctx.registerService('db', db);
ctx.registerService('broadcaster', broadcaster);

const discovered = await new PluginDiscoverer().discover(['packages/plugins']);
for (const manifest of discovered) {
  const plugin = await loader.load(manifest);
  await plugin.init(ctx);
}
```

#### `manifest.json` shape

```json
{
  "name": "playlist",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "source": "src/index.ts",
  "priority": 100
}
```

| Field      | Required | Note                                                          |
|------------|----------|---------------------------------------------------------------|
| `name`     | yes      | Stable plugin id, used as registry key.                       |
| `version`  | yes      | Semver-ish string.                                            |
| `entry`    | yes      | Production entry. The loader resolves it first.               |
| `source`   | no       | Dev entry — used when `entry` is missing (tsx/esm context).   |
| `priority` | no       | Lower values load first. Defaults to `100`.                   |

The loader walks the filesystems in priority order. If `entry` is missing
(e.g. running under `tsx` before `pnpm build`), it tries `source`, then
falls back to a conventional `src/index.ts`. See
`src/plugin-system/plugin-loader.ts` for the exact resolution rules.

## Project structure

```
packages/core/
├── src/
│   ├── index.ts
│   ├── plugin-system/
│   │   ├── plugin-discoverer.ts     # reads manifest.json per directory
│   │   ├── plugin-loader.ts        # dynamic import w/ source fallback
│   │   ├── plugin-registry.ts      # service lookup table
│   │   └── plugin-context-impl.ts  # service registration + route/WS buffers
│   ├── services/
│   │   ├── broadcaster.ts
│   │   ├── ring-buffer.ts
│   │   ├── source-receiver.ts
│   │   ├── listener-manager.ts
│   │   └── ws-hub.ts
│   ├── db/
│   │   ├── sqlite.ts
│   │   ├── schema.sql
│   │   └── repos/                  # typed query helpers
│   └── types/                      # ambient declarations (ua-parser-js)
├── package.json
└── tsconfig.json
```

## Testing

```bash
pnpm --filter @radio-services/core test
```

The core test suite covers ring buffer math, broadcaster broadcast
semantics, and basic SQLite CRUD. Plugin-level integration tests live in
the workspace-root `tests/` directory.

## License

MIT
