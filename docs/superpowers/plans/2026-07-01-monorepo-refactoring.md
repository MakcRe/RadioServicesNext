# radioServices Monorepo 重构实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 radioServices 从单包项目重构为五包 monorepo 结构（shared/core/server/web/plugins）

**架构：** 采用五包结构，shared 提供类型/接口，core 实现业务逻辑与插件系统，server 组装运行，web 提供前端，plugins 存放内置插件。通过 pnpm-workspace 管理包间依赖，TypeScript 独立构建。

**技术栈：** pnpm workspaces, TypeScript, Fastify, Vitest

---

## 文件结构概览

```
# 将创建/修改的文件

# === 根级配置文件 ===
创建: pnpm-workspace.yaml           # 已有，修改以启用 workspace
创建: tsconfig.base.json            # 共享 TypeScript 基础配置
修改: package.json                  # 添加 workspace scripts
创建: packages/.gitkeep            # 占位，确保目录存在

# === packages/shared ===
创建: packages/shared/package.json
创建: packages/shared/tsconfig.json
创建: packages/shared/src/index.ts
创建: packages/shared/src/types/config.ts           # 从 src/config.ts 迁移
创建: packages/shared/src/types/api.ts
创建: packages/shared/src/types/stream.ts
创建: packages/shared/src/constants/index.ts
创建: packages/shared/src/interfaces/plugin.ts
创建: packages/shared/src/interfaces/plugin-context.ts

# === packages/core ===
创建: packages/core/package.json
创建: packages/core/tsconfig.json
创建: packages/core/src/index.ts
迁移: src/db/ → packages/core/src/db/
迁移: src/services/ → packages/core/src/services/
创建: packages/core/src/plugin-system/plugin-discoverer.ts
创建: packages/core/src/plugin-system/plugin-registry.ts
创建: packages/core/src/plugin-system/plugin-loader.ts
创建: packages/core/src/plugin-system/plugin-context-impl.ts

# === packages/server ===
创建: packages/server/package.json
创建: packages/server/tsconfig.json
创建: packages/server/src/index.ts
迁移: src/app.ts → packages/server/src/app.ts
迁移: src/server.ts → packages/server/src/server.ts
迁移: src/routes/stream.ts → packages/server/src/routes/stream.ts
迁移: src/routes/ws.ts → packages/server/src/routes/ws.ts
迁移: src/logger.ts → packages/server/src/logger.ts

# === packages/web ===
创建: packages/web/package.json
创建: packages/web/tsconfig.json
创建: packages/web/src/index.ts
迁移: src/web/ → packages/web/src/

# === 内置插件 ===
创建: packages/plugins/manifest.json
创建: packages/plugins/playlist/package.json
创建: packages/plugins/playlist/tsconfig.json
创建: packages/plugins/playlist/manifest.json
创建: packages/plugins/playlist/src/index.ts
迁移: src/routes/playlist.ts → packages/plugins/playlist/src/routes/playlist.ts
迁移: src/services/playlist-service.ts → packages/plugins/playlist/src/services/playlist-service.ts
迁移: src/services/upload-service.ts → packages/plugins/playlist/src/services/upload-service.ts
迁移: src/db/repos/playlist.repo.ts → packages/plugins/playlist/src/repos/playlist.repo.ts
迁移: src/db/repos/uploaded-files.repo.ts → packages/plugins/playlist/src/repos/uploaded-files.repo.ts

# ... archive, listeners, ffmpeg 插件类似

# === 测试 ===
创建: tests/unit/shared/        # shared 包测试
创建: tests/unit/core/           # core 包测试
创建: tests/integration/core.test.ts
创建: tests/integration/server.test.ts

# === 删除旧文件 ===
删除: src/ (迁移完成后)
删除: public/admin/app.js (由 web 包构建替代)
```

---

## Phase 1: 骨架搭建

### 任务 1：配置根级 TypeScript 基础配置

**文件：**
- 创建：`tsconfig.base.json`

- [ ] **步骤 1：创建 tsconfig.base.json**

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
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add tsconfig.base.json && git commit -m "chore: add TypeScript base config for monorepo"
```

---

### 任务 2：创建 packages/shared 包

**文件：**
- 创建：`packages/shared/package.json`
- 创建：`packages/shared/tsconfig.json`
- 创建：`packages/shared/src/index.ts`
- 创建：`packages/shared/src/types/config.ts`
- 创建：`packages/shared/src/types/api.ts`
- 创建：`packages/shared/src/types/stream.ts`
- 创建：`packages/shared/src/constants/index.ts`
- 创建：`packages/shared/src/interfaces/plugin.ts`
- 创建：`packages/shared/src/interfaces/plugin-context.ts`

- [ ] **步骤 1：创建 packages/shared/package.json**

```json
{
  "name": "@radio-services/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **步骤 2：创建 packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **步骤 3：创建 packages/shared/src/types/config.ts**

从 `src/config.ts` 提取配置类型定义：

```typescript
export interface ServerConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  sourcePassword: string;
}

export interface FfmpegConfig {
  version: string;
  sourceUrl: string;
}

export interface ArchiveConfig {
  directory: string;
  segmentDurationSec: number;
  retentionDays: number;
  minFreeSpaceMB: number;
}

export interface PlaylistConfig {
  uploadDir: string;
  maxFileSizeMB: number;
  allowedExtensions: string[];
}

export interface LoggingConfig {
  directory: string;
  level: string;
  retentionDays: number;
}

export interface StreamConfig {
  pollIntervalMs: number;
  pollIntervalMaxMs: number;
}

export interface RadioConfig {
  server: ServerConfig;
  auth: AuthConfig;
  ffmpeg: FfmpegConfig;
  archive: ArchiveConfig;
  playlist: PlaylistConfig;
  logging: LoggingConfig;
  stream: StreamConfig;
}
```

- [ ] **步骤 4：创建 packages/shared/src/types/api.ts**

```typescript
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **步骤 5：创建 packages/shared/src/types/stream.ts**

```typescript
export interface StreamState {
  isLive: boolean;
  sourceConnected: boolean;
  bitrate: number;
  sampleRate: number;
  channels: number;
  currentListenerCount: number;
}

export interface ListenerInfo {
  id: string;
  ip: string;
  userAgent: string;
  connectedAt: Date;
  bytesReceived: number;
}
```

- [ ] **步骤 6：创建 packages/shared/src/constants/index.ts**

```typescript
export const DEFAULT_PORT = 8000;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_SOURCE_PASSWORD = 'hackme';

export const STREAM_METADATA_INTERVAL_MS = 5000;

export const SUPPORTED_AUDIO_EXTENSIONS = [
  '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac'
] as const;

export const DEFAULT_ARCHIVE_SEGMENT_DURATION_SEC = 3600;
export const DEFAULT_RETENTION_DAYS = 7;
```

- [ ] **步骤 7：创建 packages/shared/src/interfaces/plugin.ts**

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

export interface DiscoveredPlugin {
  name: string;
  version: string;
  entry: string;
  priority: number;
  path: string;
}

export interface RouteOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  handler: (...args: unknown[]) => unknown;
  schema?: Record<string, unknown>;
}

export interface WsHandler {
  (socket: WebSocket, request: unknown): void;
}

export interface EventHandler {
  (data: unknown): void;
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}
```

- [ ] **步骤 8：创建 packages/shared/src/interfaces/plugin-context.ts**

```typescript
import type { RouteOptions, WsHandler, EventHandler, Logger } from './plugin.js';
import type { RadioConfig } from '../types/config.js';

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
  /** 注册核心服务 */
  registerService(name: string, service: unknown): void;
  /** 日志 */
  logger: Logger;
  /** 配置（只读） */
  config: Readonly<RadioConfig>;
}
```

- [ ] **步骤 9：创建 packages/shared/src/index.ts**

```typescript
// Types
export * from './types/config.js';
export * from './types/api.js';
export * from './types/stream.js';

// Constants
export * from './constants/index.js';

// Interfaces
export * from './interfaces/plugin.js';
export * from './interfaces/plugin-context.js';
```

- [ ] **步骤 10：Commit**

```bash
git add packages/shared/ && git commit -m "feat: create @radio-services/shared package"
```

---

### 任务 3：创建 packages/core 包骨架

**文件：**
- 创建：`packages/core/package.json`
- 创建：`packages/core/tsconfig.json`
- 创建：`packages/core/src/index.ts`

- [ ] **步骤 1：创建 packages/core/package.json**

```json
{
  "name": "@radio-services/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@radio-services/shared": "workspace:*"
  }
}
```

- [ ] **步骤 2：创建 packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **步骤 3：创建 packages/core/src/index.ts（初始空壳）**

```typescript
// Core exports will be added as services are migrated
export * from './services/broadcaster.js';
export * from './services/ws-hub.js';
export * from './services/ring-buffer.js';
export * from './plugin-system/plugin-discoverer.js';
export * from './plugin-system/plugin-registry.js';
export * from './plugin-system/plugin-loader.js';
```

- [ ] **步骤 4：Commit**

```bash
git add packages/core/ && git commit -m "feat: create @radio-services/core package skeleton"
```

---

### 任务 4：迁移 services 到 core 包

**文件：**
- 创建：`packages/core/src/services/broadcaster.ts`
- 创建：`packages/core/src/services/ring-buffer.ts`
- 创建：`packages/core/src/services/ws-hub.ts`
- 创建：`packages/core/src/services/listener-manager.ts`
- 创建：`packages/core/src/services/source-receiver.ts`
- 创建：`packages/core/src/db/sqlite.ts`
- 创建：`packages/core/src/db/repos/playlist.repo.ts`
- 创建：`packages/core/src/db/repos/uploaded-files.repo.ts`
- 创建：`packages/core/src/db/repos/listener-logs.repo.ts`
- 创建：`packages/core/src/db/schema.sql`

- [ ] **步骤 1：读取源文件并迁移到 packages/core/src/**

读取 `src/services/broadcaster.ts`、`src/services/ring-buffer.ts`、`src/services/ws-hub.ts`、`src/services/listener-manager.ts`、`src/services/source-receiver.ts`，然后创建迁移后的版本。

- [ ] **步骤 2：迁移数据库层**

读取 `src/db/sqlite.ts`、`src/db/schema.sql`、`src/db/repos/*.ts`，创建迁移后的版本。

- [ ] **步骤 3：更新 imports**

将所有 `@radio-services/shared` 的 import 添加到迁移后的文件中。

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/services/ packages/core/src/db/ && git commit -m "feat: migrate services and db to @radio-services/core"
```

---

### 任务 5：创建插件系统实现

**文件：**
- 创建：`packages/core/src/plugin-system/plugin-discoverer.ts`
- 创建：`packages/core/src/plugin-system/plugin-registry.ts`
- 创建：`packages/core/src/plugin-system/plugin-loader.ts`
- 创建：`packages/core/src/plugin-system/plugin-context-impl.ts`

- [ ] **步骤 1：创建 plugin-discoverer.ts**

```typescript
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { DiscoveredPlugin } from '@radio-services/shared';

export class PluginDiscoverer {
  async discover(dirs: string[]): Promise<DiscoveredPlugin[]> {
    const plugins: DiscoveredPlugin[] = [];

    for (const dir of dirs) {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const manifestPath = join(dir, entry.name, 'manifest.json');
        
        try {
          const manifestContent = await readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent);
          
          plugins.push({
            name: manifest.name,
            version: manifest.version,
            entry: manifest.entry,
            priority: manifest.priority ?? 100,
            path: join(dir, entry.name),
          });
        } catch {
          // Skip if manifest doesn't exist or is invalid
        }
      }
    }

    // Sort by priority (lower = earlier)
    return plugins.sort((a, b) => a.priority - b.priority);
  }
}
```

- [ ] **步骤 2：创建 plugin-registry.ts**

```typescript
import type { Plugin } from '@radio-services/shared';

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }
}
```

- [ ] **步骤 3：创建 plugin-loader.ts**

```typescript
import type { Plugin, DiscoveredPlugin, HealthStatus } from '@radio-services/shared';
import { PluginRegistry } from './plugin-registry.js';
import { PluginDiscoverer } from './plugin-discoverer.js';

export class PluginLoader {
  private discoverer: PluginDiscoverer;
  private registry: PluginRegistry;
  private loaded = new Map<string, Plugin>();

  constructor(registry: PluginRegistry) {
    this.registry = registry;
    this.discoverer = new PluginDiscoverer();
  }

  async discoverAndLoad(dirs: string[]): Promise<Plugin[]> {
    const discovered = await this.discoverer.discover(dirs);
    const loaded: Plugin[] = [];

    for (const manifest of discovered) {
      const plugin = await this.load(manifest);
      loaded.push(plugin);
    }

    return loaded;
  }

  async load(manifest: DiscoveredPlugin): Promise<Plugin> {
    const module = await import(manifest.entry);
    const plugin: Plugin = module.default ?? module;

    if (!this.validate(plugin)) {
      throw new Error(`Invalid plugin: ${manifest.name}`);
    }

    this.loaded.set(plugin.name, plugin);
    this.registry.register(plugin);
    
    return plugin;
  }

  async unload(name: string): Promise<void> {
    const plugin = this.loaded.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} is not loaded`);
    }

    if (plugin.stop) {
      await plugin.stop();
    }

    this.loaded.delete(name);
    this.registry.unregister(name);
  }

  private validate(plugin: unknown): plugin is Plugin {
    if (typeof plugin !== 'object' || plugin === null) return false;
    const p = plugin as Record<string, unknown>;
    return (
      typeof p.name === 'string' &&
      typeof p.version === 'string' &&
      typeof p.init === 'function' &&
      typeof p.start === 'function' &&
      typeof p.stop === 'function'
    );
  }

  getLoaded(): Plugin[] {
    return Array.from(this.loaded.values());
  }
}
```

- [ ] **步骤 4：创建 plugin-context-impl.ts**

```typescript
import type {
  PluginContext,
  RouteOptions,
  WsHandler,
  EventHandler,
  Logger,
  RadioConfig,
} from '@radio-services/shared';

export class PluginContextImpl implements PluginContext {
  private services = new Map<string, unknown>();
  private eventHandlers = new Map<string, EventHandler[]>();
  private registeredRoutes: RouteOptions[] = [];
  private registeredWsHandlers = new Map<string, WsHandler>();

  constructor(
    public readonly logger: Logger,
    public readonly config: Readonly<RadioConfig>
  ) {}

  registerRoute(options: RouteOptions): void {
    this.registeredRoutes.push(options);
  }

  registerWsHandler(path: string, handler: WsHandler): void {
    this.registeredWsHandlers.set(path, handler);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        this.logger.error(`Error in event handler for ${event}`, err);
      }
    }
  }

  on(event: string, handler: EventHandler): void {
    const existing = this.eventHandlers.get(event) ?? [];
    this.eventHandlers.set(event, [...existing, handler]);
  }

  getService<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  registerService(name: string, service: unknown): void {
    this.services.set(name, service);
  }

  getRegisteredRoutes(): RouteOptions[] {
    return this.registeredRoutes;
  }

  getRegisteredWsHandlers(): Map<string, WsHandler> {
    return this.registeredWsHandlers;
  }
}
```

- [ ] **步骤 5：Commit**

```bash
git add packages/core/src/plugin-system/ && git commit -m "feat(core): implement plugin system (discoverer, registry, loader, context)"
```

---

### 任务 6：创建 packages/server 包

**文件：**
- 创建：`packages/server/package.json`
- 创建：`packages/server/tsconfig.json`
- 创建：`packages/server/src/index.ts`
- 创建：`packages/server/src/logger.ts`
- 创建：`packages/server/src/app.ts`
- 创建：`packages/server/src/server.ts`
- 创建：`packages/server/src/routes/stream.ts`
- 创建：`packages/server/src/routes/ws.ts`

- [ ] **步骤 1：创建 packages/server/package.json**

```json
{
  "name": "@radio-services/server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "dev": "node --import tsx/esm src/server.ts",
    "dev:watch": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@radio-services/core": "workspace:*",
    "@radio-services/shared": "workspace:*",
    "@fastify/multipart": "^8.3.0",
    "@fastify/static": "^7.0.0",
    "@fastify/websocket": "^10.0.0",
    "better-sqlite3": "^11.3.0",
    "fastify": "^4.28.0",
    "js-yaml": "^4.1.0",
    "keyv": "^5.6.0",
    "keyv-file": "^5.3.5",
    "pino": "^9.4.0",
    "pino-roll": "^2.0.0",
    "ua-parser-js": "^1.0.39",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@radio-services/shared": "workspace:*",
    "@types/better-sqlite3": "^7.6.11",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.16.0",
    "@types/supertest": "^6.0.2",
    "@types/ws": "^8.5.12",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **步骤 2：创建 packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **步骤 3：迁移并修改 app.ts（整合插件系统）**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as loadYaml } from 'js-yaml';
import { createLogger } from './logger.js';
import { PluginLoader } from '@radio-services/core';
import { PluginRegistry } from '@radio-services/core';
import { PluginContextImpl } from '@radio-services/core';
import type { RadioConfig } from '@radio-services/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createApp(config: RadioConfig): Promise<FastifyInstance> {
  const logger = createLogger(config.logging);
  
  const fastify = Fastify({
    logger,
  });

  // Register plugins
  await fastify.register(multipart);
  await fastify.register(websocket);

  // Initialize plugin system
  const registry = new PluginRegistry();
  const loader = new PluginLoader(registry);

  // Create plugin context
  const pluginContext = new PluginContextImpl(logger, config);

  // Discover and load plugins
  const pluginDirs = [
    join(__dirname, '../../plugins'),
  ];
  
  const loadedPlugins = await loader.discoverAndLoad(pluginDirs);

  // Initialize plugins
  for (const plugin of loadedPlugins) {
    await plugin.init(pluginContext);
  }

  // Register plugin routes
  const pluginRoutes = pluginContext.getRegisteredRoutes();
  for (const route of pluginRoutes) {
    fastify.route({
      method: route.method,
      url: route.url,
      schema: route.schema,
      handler: route.handler as any,
    });
  }

  // Register plugin WebSocket handlers
  const wsHandlers = pluginContext.getRegisteredWsHandlers();
  for (const [path, handler] of wsHandlers) {
    fastify.get(path, { websocket: true }, (socket, request) => {
      handler(socket as any, request);
    });
  }

  return fastify;
}
```

- [ ] **步骤 4：Commit**

```bash
git add packages/server/ && git commit -m "feat: create @radio-services/server package with plugin integration"
```

---

### 任务 7：创建 packages/web 包

**文件：**
- 创建：`packages/web/package.json`
- 创建：`packages/web/tsconfig.json`
- 创建：`packages/web/src/index.ts`
- 迁移：`src/web/*` → `packages/web/src/`

- [ ] **步骤 1：创建 packages/web/package.json**

```json
{
  "name": "@radio-services/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev": "node esbuild.config.mjs --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@radio-services/shared": "workspace:*"
  },
  "devDependencies": {
    "@radio-services/shared": "workspace:*",
    "esbuild": "^0.23.0",
    "esbuild-plugin-copy": "^2.1.1"
  }
}
```

- [ ] **步骤 2：创建 packages/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **步骤 3：迁移前端代码**

读取 `src/web/` 目录下的所有文件，迁移到 `packages/web/src/`。

- [ ] **步骤 4：更新 esbuild.config.mjs**

更新 esbuild 配置使其输出到正确的位置。

- [ ] **步骤 5：Commit**

```bash
git add packages/web/ && git commit -m "feat: create @radio-services/web package"
```

---

### 任务 8：更新根级配置

**文件：**
- 修改：`package.json`
- 修改：`pnpm-workspace.yaml`（如需要）
- 修改：`vitest.config.ts`

- [ ] **步骤 1：更新根级 package.json**

```json
{
  "name": "radio-services",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "pnpm --filter @radio-services/server dev",
    "dev:all": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "build:web": "pnpm --filter @radio-services/web build",
    "build:server": "pnpm --filter @radio-services/server build",
    "start": "pnpm --filter @radio-services/server start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r typecheck",
    "clean": "pnpm -r exec rm -rf dist"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **步骤 2：更新 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'

ignoredBuiltDependencies:
  - esbuild

onlyBuiltDependencies:
  - better-sqlite3
```

- [ ] **步骤 3：Commit**

```bash
git add package.json pnpm-workspace.yaml && git commit -m "chore: update root package.json and workspace config for monorepo"
```

---

## Phase 2: 插件化

### 任务 9：创建内置插件骨架

**文件：**
- 创建：`packages/plugins/manifest.json`
- 创建：`packages/plugins/playlist/package.json`
- 创建：`packages/plugins/playlist/tsconfig.json`
- 创建：`packages/plugins/playlist/manifest.json`
- 创建：`packages/plugins/playlist/src/index.ts`

- [ ] **步骤 1：创建 packages/plugins/manifest.json**

```json
{
  "plugins": [
    "playlist",
    "archive",
    "listeners",
    "ffmpeg"
  ]
}
```

- [ ] **步骤 2：创建 playlist 插件**

```json
// packages/plugins/playlist/package.json
{
  "name": "@radio-services/plugin-playlist",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@radio-services/shared": "workspace:*",
    "@radio-services/core": "workspace:*"
  }
}
```

```json
// packages/plugins/playlist/manifest.json
{
  "name": "playlist",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "priority": 100
}
```

```typescript
// packages/plugins/playlist/src/index.ts
import type { Plugin, PluginContext } from '@radio-services/shared';
import { PlaylistService } from './services/playlist-service.js';
import { registerPlaylistRoutes } from './routes/playlist.js';

export default function createPlaylistPlugin(): Plugin {
  let playlistService: PlaylistService;
  let context: PluginContext;

  return {
    name: 'playlist',
    version: '0.1.0',
    
    init(ctx: PluginContext) {
      context = ctx;
      playlistService = new PlaylistService(ctx);
      registerPlaylistRoutes(ctx, playlistService);
    },
    
    async start() {
      context.logger.info('Playlist plugin started');
    },
    
    async stop() {
      context.logger.info('Playlist plugin stopped');
    },
    
    async healthCheck() {
      return { healthy: true };
    }
  };
}
```

- [ ] **步骤 3：类似创建 archive、listeners、ffmpeg 插件**

- [ ] **步骤 4：Commit**

```bash
git add packages/plugins/ && git commit -m "feat(plugins): create builtin plugins skeleton (playlist, archive, listeners, ffmpeg)"
```

---

### 任务 10：迁移路由和服务到插件

**文件：**
- 迁移：各类路由和服务文件到对应插件

- [ ] **步骤 1：迁移 playlist 相关文件到插件**

将 `src/routes/playlist.ts`、`src/services/playlist-service.ts`、`src/services/upload-service.ts` 等迁移到 `packages/plugins/playlist/src/`。

- [ ] **步骤 2：类似迁移其他插件**

- [ ] **步骤 3：Commit**

```bash
git add packages/plugins/ && git commit -m "feat(plugins): migrate routes and services to plugins"
```

---

## Phase 3: 清理与验证

### 任务 11：清理旧文件

**文件：**
- 删除：`src/` 目录（迁移完成后）

- [ ] **步骤 1：确认所有文件已迁移**

- [ ] **步骤 2：删除旧 src 目录**

- [ ] **步骤 3：更新 .gitignore**

- [ ] **步骤 4：Commit**

```bash
git rm -rf src/ && git add .gitignore && git commit -m "refactor: remove old src/ directory after monorepo migration"
```

---

### 任务 12：验证构建

- [ ] **步骤 1：运行 pnpm install**

```bash
pnpm install
```

预期：无错误，所有依赖安装成功

- [ ] **步骤 2：运行 pnpm typecheck**

```bash
pnpm typecheck
```

预期：所有包类型检查通过

- [ ] **步骤 3：运行 pnpm build**

```bash
pnpm build
```

预期：所有包构建成功

- [ ] **步骤 4：运行 pnpm test**

```bash
pnpm test
```

预期：所有测试通过

- [ ] **步骤 5：运行 pnpm dev 测试服务器**

```bash
pnpm dev
```

预期：服务器正常启动

- [ ] **步骤 6：Commit**

```bash
git add -A && git commit -m "chore: complete monorepo refactoring - all packages built and tested"
```

---

## 验收标准检查

| # | 标准 | 验证命令 |
|---|------|----------|
| 1 | `pnpm install` 成功 | `pnpm install` |
| 2 | `pnpm typecheck` 通过 | `pnpm typecheck` |
| 3 | `pnpm build` 构建成功 | `pnpm build` |
| 4 | `pnpm test` 测试通过 | `pnpm test` |
| 5 | `pnpm dev` 启动正常 | `pnpm dev` |
| 6 | 插件系统可加载/卸载 | 运行时验证 |
| 7 | 现有功能兼容 | 功能测试 |

---

## 规格覆盖度检查

| 规格章节 | 对应任务 |
|----------|----------|
| 五包结构 (shared/core/server/web/plugins) | 任务 2, 3, 6, 7, 9 |
| 依赖关系设计 | 任务 2, 3, 6, 7 |
| TypeScript 独立构建策略 | 任务 1, 2, 3, 6, 7 |
| pnpm-workspace 配置 | 任务 8 |
| 插件系统实现 | 任务 5 |
| 插件发现/注册/加载 | 任务 5 |
| Plugin 接口 | 任务 2 |
| PluginContext 接口 | 任务 2, 5 |
| 插件约定目录结构 | 任务 9 |
| 迁移计划 | 任务 4, 6, 7, 10, 11 |
| 验收标准 | 任务 12 |
