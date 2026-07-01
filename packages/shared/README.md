# @radio-services/shared

Dependency-free contract layer for the radioServices monorepo.

This package owns the boundaries between every other workspace package. It
contains the typed shape of `RadioConfig`, the loader/validator that turns
`config/config.yaml` into a runtime object, the `Plugin`/`PluginContext`
interfaces every plugin implements against, and a handful of Fastify-shaped
handler interfaces that keep the plugin typings portable.

Server, core, the plugin packages, and the web bundle all consume this
package — so it must remain free of runtime dependencies. Right now it has
exactly one: `js-yaml`.

## Install

It is a workspace package, not published. Resolve it through pnpm:

```jsonc
// package.json
{
  "dependencies": {
    "@radio-services/shared": "workspace:*"
  }
}
```

## Build

```bash
pnpm --filter @radio-services/shared build
```

Outputs `dist/index.js` + `dist/index.d.ts`. Downstream packages resolve
types from `./dist/index.d.ts` via the `exports` map in `package.json`.

## Public API

### Configuration

| Export                  | Description                                                       |
|-------------------------|-------------------------------------------------------------------|
| `RadioConfig` (type)    | The full validated config object.                                |
| `loadConfig(path)`      | Loads `config.yaml`, applies defaults, then environment overrides. |
| `warnIfDefaultPassword` | Logs a security warning if `auth.sourcePassword` equals the default. |
| `DEFAULT_SOURCE_PASSWORD` | The literal default value (`'hackme'`).                          |

### Streaming / API types

Re-exported from `./types/api`, `./types/stream`. These mirror the JSON
shapes used by `/api/status`, `/api/source/*`, `/api/playlist`,
`/api/listeners/*`, `/api/archive/list`, and the SSE event stream of
`/api/ffmpeg/download/status`.

### Plugin contracts

```ts
import type {
  Plugin,
  PluginContext,
  DiscoveredPlugin,
  HealthStatus,
} from '@radio-services/shared';

export default function createMyPlugin(): Plugin {
  return {
    name: 'my-plugin',
    version: '0.1.0',
    init(ctx: PluginContext) { /* register services, routes, ws handlers */ },
    start() { /* async setup */ },
    stop() { /* async teardown */ },
  };
}
```

Handler interfaces (`RouteOptions`, `WsHandler`, `FastifyRequest`,
`FastifyReply`, `EventHandler`, `Logger`) are deliberately Fastify-free so
the type can be reused by both server code and external plugins.

## Project structure

```
packages/shared/
├── src/
│   ├── index.ts              # public re-exports
│   ├── config-func.ts        # loadConfig + warnIfDefaultPassword
│   ├── constants/            # shared constant tables
│   ├── interfaces/           # Plugin, PluginContext, handler shims
│   └── types/                # RadioConfig + API/stream JSON shapes
├── package.json
└── tsconfig.json
```

## Constraints

- **No runtime dependencies** beyond `js-yaml` and Node built-ins. Anything
  added here propagates to every consumer.
- **Type-only re-exports are fine.** Avoid exporting runtime helpers that
  pull Fastify/Express into plugin packages.

## License

MIT
