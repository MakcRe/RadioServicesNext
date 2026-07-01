import type { PluginContext } from './plugin-context.js';

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
