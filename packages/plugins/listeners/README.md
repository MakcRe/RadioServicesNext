# @radio-services/plugin-listeners

[English](#english) · [中文](#中文)

Built-in plugin that tracks every WebSocket connection on `/stream` and
records them in SQLite. The admin UI reads from this plugin to render
the "current listeners" panel and the historical log.

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

### What it does

- **Routes:** `GET /api/listeners/current`, `GET /api/listeners/history`
- **Service registered on `PluginContext`:** `listenerManager`
- **Persistence:** SQLite (`listener_logs` table)
- **Dependencies:** `better-sqlite3`, `ua-parser-js`, `@radio-services/shared`, `@radio-services/core`

### How it works

`ListenerManager` subscribes to the broadcaster's connect / disconnect
events. On connect it parses the `User-Agent` header through
`ua-parser-js`, persists a row, and exposes the result through
`current()` and `history({ page, pageSize })`.

The plugin requires the `db` service to already be registered on the
context — the server does this in `createApp` before any plugin loads.

### HTTP surface

| Method | URL                              | Description                          |
|--------|----------------------------------|--------------------------------------|
| `GET`  | `/api/listeners/current`         | Currently connected listeners.       |
| `GET`  | `/api/listeners/history?page&pageSize` | Paginated history view.         |

Query params follow the response shape declared in
`packages/shared/src/types/api.ts`.

### Configuration

The plugin consumes the canonical `RadioConfig.stream.pollIntervalMs` /
`pollIntervalMaxMs` and the database path. There are no
listener-specific config keys.

### Scripts

```bash
pnpm --filter @radio-services/plugin-listeners build
pnpm --filter @radio-services/plugin-listeners typecheck
```

See the [umbrella README](../README.md#manifestjson-field-reference) for the
full `manifest.json` field reference.

### Plugin signature

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
      if (!db) throw new Error('Database service not available');
      const repo = new ListenerLogsRepo(db);
      const manager = new ListenerManager(repo);
      registerListenersRoutes(ctx, { listenerManager: manager });
      ctx.registerService('listenerManager', manager);
    },
    async start() { ctx.logger.info('Listeners plugin started'); },
    async stop()  { ctx.logger.info('Listeners plugin stopped'); },
    async healthCheck() { return { healthy: true }; },
  };
}
```

### Project structure

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

### License

MIT

---

<a id="中文"></a>

## 中文

### 作用

- **路由**：`GET /api/listeners/current`、`GET /api/listeners/history`
- **注册到 `PluginContext` 的服务**：`listenerManager`
- **持久化**：SQLite（`listener_logs` 表）
- **依赖**：`better-sqlite3`、`ua-parser-js`、`@radio-services/shared`、`@radio-services/core`

### 工作原理

`ListenerManager` 订阅 broadcaster 的 connect / disconnect 事件。连接建
立时用 `ua-parser-js` 解析 `User-Agent`，写入一行，并通过 `current()` 与
`history({ page, pageSize })` 暴露给上层。

本插件依赖 context 中的 `db` 服务。server 在 `createApp` 中、任何插件
加载**之前**就注册 `db`。

### HTTP 接口

| 方法   | URL                                | 说明                          |
|--------|------------------------------------|-------------------------------|
| `GET`  | `/api/listeners/current`           | 当前在线听众列表              |
| `GET`  | `/api/listeners/history?page&pageSize` | 分页历史记录              |

响应结构由 `packages/shared/src/types/api.ts` 定义。

### 配置

读取 `RadioConfig.stream.pollIntervalMs` / `pollIntervalMaxMs` 和数据库
路径，**没有 listeners 专属的配置项**。

### 脚本

```bash
pnpm --filter @radio-services/plugin-listeners build
pnpm --filter @radio-services/plugin-listeners typecheck
```

完整字段说明见 [伞形 README](../README.md#manifestjson-字段详解)。

### 插件签名

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
      if (!db) throw new Error('Database service not available');
      const repo = new ListenerLogsRepo(db);
      const manager = new ListenerManager(repo);
      registerListenersRoutes(ctx, { listenerManager: manager });
      ctx.registerService('listenerManager', manager);
    },
    async start() { ctx.logger.info('Listeners plugin started'); },
    async stop()  { ctx.logger.info('Listeners plugin stopped'); },
    async healthCheck() { return { healthy: true }; },
  };
}
```

### 项目结构

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

### 许可

MIT