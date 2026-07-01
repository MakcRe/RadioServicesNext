import type { RouteOptions, WsHandler, EventHandler, Logger } from './plugin-types.js';
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
