# @radio-services/plugins

[English](#english) · [中文](#中文)

The built-in plugins for `@radio-services/core`. Each plugin is its own
workspace package so it can be built, typechecked, and versioned
independently. The plugin discoverer walks this directory at startup.

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

### Built-in plugins

| Package                                       | Purpose                                                       |
|-----------------------------------------------|---------------------------------------------------------------|
| [`playlist`](./playlist/README.md)            | Upload queue + `/api/source/*` + `/api/playlist`             |
| [`archive`](./archive/README.md)              | Hourly MP3 segmenter + `/api/archive/*`                       |
| [`listeners`](./listeners/README.md)          | Listener bookkeeping + `/api/listeners/*`                     |
| [`ffmpeg`](./ffmpeg/README.md)                | Auto-install / version switch + `/api/ffmpeg/*`               |

### Layout

```
packages/plugins/
├── manifest.json            # allow-list of plugin folders; the discoverer scans ONLY these
├── playlist/
│   ├── manifest.json        # plugin-level manifest (entry, source, priority, ...)
│   ├── package.json
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

Two manifests coexist on purpose:

- **Umbrella `manifest.json`** (this directory's root) is an allow-list:
  the discoverer iterates over the directories listed here. Drop a folder
  in here and it's picked up at next boot.
- **Per-plugin `manifest.json`** lives next to each plugin's code and
  describes the plugin itself: `name`, `version`, `entry`, `source`,
  `priority`. The loader reads it.

> ⚠️ The umbrella list is the only place that controls *which* plugins
> load. A folder under `packages/plugins/` that is **not** listed in the
> umbrella `manifest.json` will not be discovered, even if it has a
> per-plugin `manifest.json`.

### `manifest.json` field reference

The full schema enforced by `PluginDiscoverer` and `PluginLoader`
(`packages/core/src/plugin-system/`):

| Field      | Type     | Required | Default  | Purpose                                                  |
|------------|----------|----------|----------|----------------------------------------------------------|
| `name`     | `string` | **yes**  | —        | Stable plugin id; matches `Plugin.name` and is the registry key. |
| `version`  | `string` | **yes**  | —        | SemVer-ish string. Surfaced in logs and `/api/health`.  |
| `entry`    | `string` | **yes**  | —        | Production entry path (e.g. `dist/index.js`), resolved relative to the plugin folder. Must be a `.js` file produced by `pnpm build`. |
| `source`   | `string` | no       | —        | Dev-mode fallback when `entry` is missing (tsx/esm runs `src/index.ts` directly). Usually `src/index.ts`. |
| `priority` | `number` | no       | `100`    | Load order — **lower values load first**. Plugins are loaded in ascending priority, then iterated in load order to run `init()` → `start()`. |

Real manifest example (this is what `packages/plugins/playlist/manifest.json` looks like today):

```json
{
  "name": "playlist",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "source": "src/index.ts"
}
```

Note that `priority` is **omitted** here — the discoverer fills in `100`.

### `priority` explained

Plugins boot in `init()` order; `init()` is where each plugin registers
routes, services, WS handlers on the shared `PluginContext`. Some plugins
declare dependencies on services owned by others (e.g. the archive
plugin's `Archiver` calls `ctx.getService<FFmpegManager>('ffmpegManager')`),
so the plugin providing those services must run `init()` **before** the
consumer.

Two ways to control order:

1. **`priority` (recommended):** integer, lower = earlier.
   - When multiple plugins share the same priority the discovered-order
     (filesystem iteration) breaks the tie — that order is stable for a
     given directory but **not** portable across hosts.
2. **`umbrella manifest.json` listing order:** if you want a *predictable*
   load order that does not depend on filesystem sort, omit `priority`
   from every plugin (so they all default to `100`) and rely on the
   umbrella list ordering instead.

#### Reserved priority bands

These aren't enforced by code today, but the built-in plugins use them
as a convention so third-party plugins don't collide:

| Priority band | Intended for                                              |
|---------------|-----------------------------------------------------------|
| `0–9`         | Reserved for the application shell — runs *before* the workspace plugins (none ship today). |
| `10–49`       | Foundational data / route providers (e.g. **playlist** ships at 10 — its routes the UI's Source view calls must exist before any consumer registers). |
| `50–89`       | Generic features (most plugin authors should land here).  |
| `90–99`       | Optional / slow-start features (e.g. analytics).          |
| `100`         | Default when `priority` is omitted.                       |
| `101+`        | Hot-fix / experimental plugins that should boot last.     |

The current built-ins **omit** `priority` (all default to 100) and rely
on the umbrella list ordering (`playlist → archive → listeners → ffmpeg`)
to load `playlist` first. They would survive the priority scheme if you
renumbered them, but doing so is not required.

### Plugin loader resolution rules

`PluginLoader.resolveEntry()` (`packages/core/src/plugin-system/plugin-loader.ts`)
walks three candidates in order; the **first that exists on disk** is used:

1. `manifest.entry` (e.g. `dist/index.js`) — used after `pnpm build`.
2. `manifest.source` (e.g. `src/index.ts`) — used in dev mode when the
   plugin hasn't been built yet.
3. A last-resort convention: `src/index.ts` relative to the plugin folder.

If none of these exist the loader throws a clear error pointing at which
paths it tried. See the source for the exact wording.

### Module shape

The loader accepts three module shapes (in order):

1. **Factory function** — `export default function createPlugin() { return { name, version, init, ... } }`
2. **Direct plugin object** — `export default { name, version, init, ... }`
3. **Named export** — `export const plugin = { name, version, init, ... }`

All built-in plugins use the factory shape (option 1).

After loading, the loader calls `validate()` which enforces that
`name`, `version`, `init`, `start`, and `stop` are all defined —
everything else (e.g. `healthCheck`) is optional.

### Adding a new plugin

1. Add a folder under `packages/plugins/<name>/`.
2. Copy a peer plugin's `package.json`. Change `name` to
   `@radio-services/plugin-<name>`.
3. Add `manifest.json`:
   ```json
   {
     "name": "<name>",
     "version": "0.1.0",
     "entry": "dist/index.js",
     "source": "src/index.ts",
     "priority": 50
   }
   ```
4. Implement a default-export factory in `src/index.ts`:
   ```ts
   import type { Plugin, PluginContext } from '@radio-services/shared';

   export default function createMyPlugin(): Plugin {
     let ctx!: PluginContext;
     return {
       name: '<name>',
       version: '0.1.0',
       init(c) {
         ctx = c;
         ctx.registerRoute({ method: 'GET', url: '/api/<name>/ping', handler: () => ({ ok: true }) });
       },
       async start() {},
       async stop() {},
     };
   }
   ```
5. Append `"<name>"` to the umbrella `manifest.json`.
6. Build (`pnpm --filter @radio-services/plugin-<name> build`) and
   restart the server.

### Build & test

Each plugin runs its own build:

```bash
pnpm --filter @radio-services/plugin-playlist  build
pnpm --filter @radio-services/plugin-archive   build
pnpm --filter @radio-services/plugin-listeners build
pnpm --filter @radio-services/plugin-ffmpeg    build
```

Plugin-level integration tests live at the workspace root
(`tests/integration/*`); unit tests for internal helpers live next to the
plugin code in `src/`.

### License

MIT

---

<a id="中文"></a>

## 中文

### 内置插件一览

| 包                                            | 作用                                                            |
|-----------------------------------------------|-----------------------------------------------------------------|
| [`playlist`](./playlist/README.md)            | 上传队列 + `/api/source/*` + `/api/playlist`                     |
| [`archive`](./archive/README.md)              | 按小时切片 + `/api/archive/*`                                    |
| [`listeners`](./listeners/README.md)          | 听众记录 + `/api/listeners/*`                                    |
| [`ffmpeg`](./ffmpeg/README.md)                | 自动下载 / 版本切换 + `/api/ffmpeg/*`                            |

### 目录结构

```
packages/plugins/
├── manifest.json            # discoverer 扫描的白名单（仅列在其中的目录会被扫描）
├── playlist/
│   ├── manifest.json        # 插件自身清单（entry / source / priority / ...）
│   ├── package.json
│   ├── src/
│   │   ├── index.ts         # 默认导出工厂函数：() => Plugin
│   │   ├── routes/
│   │   ├── services/
│   │   └── repos/
│   └── tsconfig.json
├── archive/...
├── listeners/...
└── ffmpeg/...
```

工程中有两份清单，作用不同：

- **伞形 `manifest.json`**（本目录根）：白名单。discoverer 只扫描列在
  `plugins` 数组下的目录，新插件必须追加进来才会被加载。
- **插件自身 `manifest.json`**：描述该插件的 `name` / `version` /
  `entry` / `source` / `priority`，由 loader 在加载时读取。

> ⚠️ 伞形清单才是决定"哪些插件会被加载"的唯一地方。即便子目录里有
> `manifest.json`，**只要没列在伞形清单里就不会被发现**。

### `manifest.json` 字段详解

完整 schema 见 `packages/core/src/plugin-system/` 中的 `PluginDiscoverer`
与 `PluginLoader`：

| 字段        | 类型     | 必填 | 默认值 | 说明                                                                          |
|-------------|----------|------|--------|-------------------------------------------------------------------------------|
| `name`      | `string` | **是** | —     | 插件唯一标识；必须与 `Plugin.name` 一致，也是 registry 的 key                  |
| `version`   | `string` | **是** | —     | SemVer 字符串，日志与 `/api/health` 中会显示                                  |
| `entry`     | `string` | **是** | —     | 生产环境入口（如 `dist/index.js`），相对插件目录解析；必须是 `pnpm build` 产出的 `.js` 文件 |
| `source`    | `string` | 否   | —     | dev 模式回退入口（tsx/esm 直接运行 `src/index.ts`），通常填 `src/index.ts`    |
| `priority`  | `number` | 否   | `100`  | 加载顺序，**数字越小越先加载**；discoverer 按升序排序，loader 顺序调用 `init()` / `start()` |

实际示例（即 `packages/plugins/playlist/manifest.json` 当前内容）：

```json
{
  "name": "playlist",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "source": "src/index.ts"
}
```

注意此例**省略**了 `priority`，由 discoverer 填默认值 `100`。

### `priority` 详解

插件加载过程是按顺序调用 `init()` —— 每个插件在 `init()` 中向共享的
`PluginContext` 注册路由、服务、WS handler。某些插件依赖另一个插件
初始化的服务（例如 archive 插件里的 `Archiver` 会调
`ctx.getService<FFmpegManager>('ffmpegManager')`），因此：
**服务提供者必须先 init()，消费者后 init()**。

控制加载顺序有两种方式：

1. **`priority`（推荐）**：整数，越小越先加载。
   - 多个插件 priority 相同时，discoverer 用文件系统遍历顺序做 tie-break。
     该顺序在单一文件系统上是稳定的，但**跨主机不一定便携**。
2. **伞形 `manifest.json` 的列出顺序**：若想要"不依赖文件系统排序"的
   可预测加载顺序，可以让所有插件都不填 `priority`（统一默认 100），
   改由伞形清单顺序决定。

#### 推荐 priority 分段

代码层并未强制要求，仅作为约定避免插件互踩：

| Priority 区间 | 用途                                                              |
|---------------|-------------------------------------------------------------------|
| `0–9`         | 保留给应用外壳（必须最先加载，工作区插件目前没有用到）           |
| `10–49`       | 基础数据 / 路由提供者（例如 **playlist** 应在 10，保证它的路由先于其他插件注册） |
| `50–89`       | 一般特性（第三方插件建议落在此区间）                               |
| `90–99`       | 可选 / 启动较慢的功能（例如分析类插件）                            |
| `100`         | 省略 `priority` 时的默认值                                         |
| `101+`        | 热修补 / 实验性插件（最后加载）                                    |

当前内置插件**全部省略** `priority`（都默认 100），改由伞形清单顺序
（`playlist → archive → listeners → ffmpeg`）保证 playlist 先加载。如果
你愿意给它们分配 priority，并不影响运行结果。

### Loader 入口解析规则

`PluginLoader.resolveEntry()`（位于
`packages/core/src/plugin-system/plugin-loader.ts`）按以下顺序找到第一个
**磁盘上真实存在**的候选：

1. `manifest.entry`（如 `dist/index.js`）—— `pnpm build` 后使用
2. `manifest.source`（如 `src/index.ts`）—— dev 模式构建产物缺失时的回退
3. 兜底约定：`src/index.ts`（相对于插件目录）

若三者都不存在，loader 会抛错，错误信息直接列出尝试过的路径。详见源码。

### 模块形状

loader 按以下顺序接受三种模块导出：

1. **工厂函数** —— `export default function createPlugin() { return { name, version, init, ... } }`
2. **直接导出插件对象** —— `export default { name, version, init, ... }`
3. **具名导出** —— `export const plugin = { name, version, init, ... }`

当前内置插件全部采用第 1 种（工厂函数）。

加载后 loader 会调 `validate()`，强制要求 `name` / `version` / `init` /
`start` / `stop` 都已定义 —— 其他字段（如 `healthCheck`）是可选的。

### 新增一个插件

1. 在 `packages/plugins/<name>/` 下新建目录
2. 复制兄弟插件的 `package.json`，把 `name` 改为 `@radio-services/plugin-<name>`
3. 新建 `manifest.json`：
   ```json
   {
     "name": "<name>",
     "version": "0.1.0",
     "entry": "dist/index.js",
     "source": "src/index.ts",
     "priority": 50
   }
   ```
4. 在 `src/index.ts` 中实现一个默认导出的工厂函数：
   ```ts
   import type { Plugin, PluginContext } from '@radio-services/shared';

   export default function createMyPlugin(): Plugin {
     let ctx!: PluginContext;
     return {
       name: '<name>',
       version: '0.1.0',
       init(c) {
         ctx = c;
         ctx.registerRoute({ method: 'GET', url: '/api/<name>/ping', handler: () => ({ ok: true }) });
       },
       async start() {},
       async stop() {},
     };
   }
   ```
5. 把 `"<name>"` 追加到伞形 `manifest.json`
6. 构建并重启服务：`pnpm --filter @radio-services/plugin-<name> build`

### 构建与测试

每个插件独立构建：

```bash
pnpm --filter @radio-services/plugin-playlist  build
pnpm --filter @radio-services/plugin-archive   build
pnpm --filter @radio-services/plugin-listeners build
pnpm --filter @radio-services/plugin-ffmpeg    build
```

插件级集成测试位于工作区根 `tests/integration/*`；内部 helper 的单元测试
位于各插件 `src/` 内。

### 许可

MIT