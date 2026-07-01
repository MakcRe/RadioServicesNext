# radioServices Monorepo 架构设计

**日期**：2026-07-01
**目的**：将 radioServices 从单包项目重构为 monorepo 结构，支持多团队协作、代码复用、未来独立部署、细粒度插件系统

## 目录结构

```
radioServices/                          # Monorepo 根目录
├── pnpm-workspace.yaml                 # Workspace 包配置
├── package.json                        # Root: scripts, workspaces metadata, cross-package scripts
├── tsconfig.json                       # Root: shared base config (extends path aliases)
├── tsconfig.base.json                   # 各包 tsconfig 继承的基础配置
├── vitest.config.ts                    # 根级 Vitest 配置（tests/ 保持扁平）
├── packages/
│   ├── shared/                        # 共享类型、接口、常量
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # 统一导出
│   │       ├── types/                 # 共享类型定义
│   │       │   ├── config.ts          # 配置类型
│   │       │   ├── api.ts             # API 响应类型
│   │       │   └── stream.ts          # 流媒体相关类型
│   │       ├── constants/             # 共享常量
│   │       │   └── index.ts
│   │       └── interfaces/            # 核心接口
│   │           ├── plugin.ts          # Plugin 接口
│   │           └── plugin-context.ts  # PluginContext 接口
│   │
│   ├── core/                         # 核心业务逻辑
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # 统一导出
│   │       ├── db/                    # 数据库层
│   │       │   ├── sqlite.ts
│   │       │   ├── schema.sql
│   │       │   └── repos/
│   │       ├── services/              # 核心服务
│   │       │   ├── broadcaster.ts
│   │       │   ├── source-receiver.ts
│   │       │   ├── listener-manager.ts
│   │       │   ├── ring-buffer.ts
│   │       │   └── ws-hub.ts
│   │       └── plugin-system/         # 插件系统
│   │           ├── plugin-discoverer.ts
│   │           ├── plugin-registry.ts
│   │           ├── plugin-loader.ts
│   │           └── plugin-context-impl.ts
│   │
│   ├── server/                       # Fastify 服务器入口
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # 统一导出
│   │       ├── app.ts                 # Fastify 实例工厂
│   │       ├── server.ts              # 入口文件
│   │       ├── config/                # 服务器配置
│   │       └── routes/                # 基础路由
│   │           ├── stream.ts
│   │           └── ws.ts
│   │
│   ├── web/                          # 管理后台前端
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts              # 统一导出
│   │   │   ├── main.ts
│   │   │   ├── api-client.ts
│   │   │   ├── ws-client.ts
│   │   │   ├── types.ts
│   │   │   ├── ui.ts
│   │   │   └── views/
│   │   └── public/                    # 前端静态资源输出
│   │
│   └── plugins/                      # 内置插件（约定目录）
│       ├── manifest.json              # 插件清单（见 §插件约定）
│       ├── playlist/                  # 插件: 播放列表
│       ├── archive/                   # 插件: 录音存档
│       ├── listeners/                 # 插件: 听众统计
│       └── ffmpeg/                    # 插件: FFmpeg 管理
│
├── config/                            # 运行时配置（YAML）
├── public/                            # 服务器静态资源
│   ├── index.html                    # 听众落地页
│   └── admin/                        # Web 打包输出
├── tests/                             # 测试（保持扁平，方便跨包测试）
├── docs/
└── bin/                               # 运行时数据（archive, uploads, ffmpeg）
```

## 依赖关系

```
web ──────► shared (types, interfaces, constants)
              ▲
core ────────┤
              │
server ─────► core ──────► shared
              │
              └──► plugins ◄─────────────► shared
```

| 包 | 依赖 | 说明 |
|----|------|------|
| `shared` | 无 | 纯类型/常量/接口包 |
| `core` | `shared` | 核心业务逻辑，可独立于 server 使用 |
| `server` | `core`, `shared`, `plugins/*` | 运行时组装插件 |
| `web` | `shared` | 前端引用共享类型 |
| `plugins/*` | `shared`, `core`（可选） | 插件可依赖 core 扩展功能 |

## 包详细设计

### 1. `packages/shared`

纯类型包，无运行时依赖。

**接口定义** (`interfaces/plugin.ts`):

```typescript
export interface Plugin {
  /** 插件唯一标识 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件元数据 */
  meta?: Record<string, unknown>;
  /** 初始化（同步，插件实例化后立即调用） */
  init(context: PluginContext): void | Promise<void>;
  /** 启动（异步，服务启动后调用） */
  start(): void | Promise<void>;
  /** 停止（异步，服务关闭前调用） */
  stop(): void | Promise<void>;
  /** 健康检查 */
  healthCheck?(): Promise<HealthStatus>;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
}
```

**PluginContext 接口** (`interfaces/plugin-context.ts`):

```typescript
import type { FastifyInstance } from 'fastify';

export interface PluginContext {
  /** 注册 REST 路由 */
  registerRoute(options: RouteOptions): void;
  /** 注册 WebSocket 处理器 */
  registerWsHandler(path: string, handler: WsHandler): void;
  /** 发布事件 */
  emit(event: string, data: unknown): void;
  /** 订阅事件 */
  on(event: string, handler: EventHandler): void;
  /** 获取核心服务 */
  getService<T>(name: string): T | undefined;
  /** 日志 */
  logger: Logger;
  /** 配置（只读） */
  config: Readonly<RadioConfig>;
}
```

### 2. `packages/core`

核心业务逻辑，**无 Fastify 依赖**，可通过 `PluginContext.getService()` 访问。

**插件系统实现**:

```typescript
// plugin-discoverer.ts
export class PluginDiscoverer {
  async discover(dirs: string[]): Promise<DiscoveredPlugin[]>;
}

// plugin-registry.ts
export class PluginRegistry {
  register(plugin: Plugin): void;
  unregister(name: string): void;
  get(name: string): Plugin | undefined;
  list(): Plugin[];
}

// plugin-loader.ts
export class PluginLoader {
  async load(manifest: DiscoveredPlugin): Promise<Plugin>;
  async unload(name: string): Promise<void>;
}

// plugin-context-impl.ts
export class PluginContextImpl implements PluginContext {
  // 实现 PluginContext 接口
}
```

**约定：插件发现规则**

1. 扫描 `packages/plugins/*/manifest.json`
2. 读取 `manifest.json` 获取入口文件路径
3. 动态 `import()` 入口文件，校验实现 `Plugin` 接口
4. 按 `manifest.json` 中 `priority` 排序加载

### 3. `packages/server`

Fastify 应用入口，负责：
- 加载 `core` 的插件系统
- 注册基础路由（`/stream`, `/ws`）
- 注册来自插件的路由
- 生命周期管理

### 4. `packages/plugins/*`

**插件约定目录结构**:

```
plugins/
  └── <plugin-name>/
      ├── manifest.json       # 插件清单
      ├── package.json       # 独立包配置
      ├── tsconfig.json
      └── src/
          └── index.ts       # 入口，导出 Plugin 实例
```

**`manifest.json` 结构**:

```json
{
  "name": "playlist",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "priority": 100,
  "dependencies": {
    "core": "workspace:*"
  }
}
```

**优先级**（数字越小越先加载）：
- `priority: 10` — 核心依赖（如数据库初始化）
- `priority: 50` — 基础服务（如听众统计）
- `priority: 100` — 功能模块（如播放列表）
- `priority: 200` — UI 相关（如后台面板）

### 5. `packages/web`

管理后台前端，独立构建，输出到 `public/admin/`。

## TypeScript 配置策略

采用 **独立构建 + workspace 引用**：

```jsonc
// packages/shared/package.json
{
  "name": "@radio-services/shared",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

```jsonc
// packages/core/package.json
{
  "dependencies": {
    "@radio-services/shared": "workspace:*"
  }
}
```

**各包 `tsconfig.json`** 继承基础配置：

```jsonc
// packages/shared/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**根级 `tsconfig.base.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

## pnpm-workspace 配置

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'

ignoredBuiltDependencies:
  - esbuild

onlyBuiltDependencies:
  - better-sqlite3
```

## 根级 Scripts

```json
{
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "build:web": "pnpm --filter @radio-services/web build",
    "test": "vitest run",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  }
}
```

## 测试策略

测试保持扁平结构（`tests/`），通过 workspace 引用测试各包：

```
tests/
├── unit/
│   ├── core/                        # core 包单元测试
│   └── shared/                      # shared 包单元测试
├── integration/
│   ├── core.test.ts                 # core 集成测试
│   └── server.test.ts               # server 集成测试
└── e2e/
    └── e2e.test.ts                  # 端到端测试
```

## 插件动态加载实现

```typescript
// core/src/plugin-system/plugin-loader.ts
export class PluginLoader {
  private loaded = new Map<string, Plugin>();

  async load(manifest: DiscoveredPlugin): Promise<Plugin> {
    const module = await import(manifest.entry);
    const plugin: Plugin = module.default ?? module;

    if (!this.validate(plugin)) {
      throw new Error(`Invalid plugin: ${manifest.name}`);
    }

    this.loaded.set(plugin.name, plugin);
    return plugin;
  }

  async unload(name: string): Promise<void> {
    const plugin = this.loaded.get(name);
    if (plugin?.stop) {
      await plugin.stop();
    }
    this.loaded.delete(name);
  }
}
```

## 迁移计划

### Phase 1: 骨架搭建
1. 创建 `packages/shared/`，迁移类型/接口/常量
2. 创建 `packages/core/`，迁移 services/db
3. 创建 `packages/server/`，迁移路由/入口
4. 创建 `packages/web/`，迁移前端代码

### Phase 2: 插件化
5. 创建 `packages/plugins/` 目录结构
6. 实现插件发现/注册/加载系统
7. 将现有功能迁移为插件

### Phase 3: 完善
8. 配置 CI/CD
9. 更新文档
10. 端到端测试

## 验收标准

1. `pnpm install` 成功安装所有依赖
2. `pnpm typecheck` 通过所有包的类型检查
3. `pnpm build` 构建所有包
4. `pnpm test` 运行所有测试
5. `pnpm dev` 启动开发服务器正常运行
6. 插件系统可动态加载/卸载
7. 现有功能完全兼容（无破坏性变更）
