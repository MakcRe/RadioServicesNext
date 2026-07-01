# @radio-services/plugin-listeners

Built-in plugin that tracks every WebSocket connection on `/stream` and
records them in SQLite. The admin UI reads from this plugin to render the
"current listeners" panel and the historical log.

- Routes: `GET /api/listeners/current`, `GET /api/listeners/history`
- Services on `PluginContext`: `listenerManager`
- Persistence: SQLite (`listener_logs` table)
- Depends on: `better-sqlite3`, `ua-parser-js`, `@radio-services/shared`, `@radio-services/core`

## How it works

`ListenerManager` registers with the `Broadcaster` to receive connect /
disconnect events. On connect it parses the `User-Agent` header through
`ua-parser-js`, persists a row, and exposes the result through `current()`
and `history({ page, pageSize })`.

The plugin requires the `db` service to already be registered on the
context — the server does this in `createApp` before any plugin loads.

## HTTP surface

| Method | URL                              | Description                          |
|--------|----------------------------------|--------------------------------------|
| `GET`  | `/api/listeners/current`         | Currently connected listeners.       |
| `GET`  | `/api/listeners/history?page&pageSize` | Paginated history view.         |

Query params follow the response shape declared in
`@radio-services/shared/src/types/api.ts`.

## Configuration

The plugin consumes the canonical `RadioConfig.stream.pollIntervalMs` /
`pollIntervalMaxMs` and the database path. There are no listener-specific
config keys.

## Scripts

```bash
pnpm --filter @radio-services/plugin-listeners build
pnpm --filter @radio-services/plugin-listeners typecheck
```

## Plugin signature

```ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { ListenerManager } from './services/listener-manager.js';
import { ListenerLogsRepo } from './repos/listener-logs.repo.js';

export default function createListenersPlugin(): Plugin {
  let ctx!: PluginContext;
  return {
    name: 'listeners',
    version: '0.1.0',
    init(c) {
      ctx = c;
      const db = ctx.getService<Database.Database>('db');
      const repo = new ListenerLogsRepo(db);
      const manager = new ListenerManager(repo);
      registerListenersRoutes(ctx, { listenerManager: manager });
      ctx.registerService('listenerManager', manager);
    },
    async start() {},
    async stop() {},
  };
}
```

## Project structure

```
packages/plugins/listeners/
├── manifest.json
├── package.json
├── src/
│   ├── index.ts
│   ├── routes/listeners.ts
│   ├── services/listener-manager.ts
│   └── repos/listener-logs.repo.ts
└── tsconfig.json
```

## License

MIT
