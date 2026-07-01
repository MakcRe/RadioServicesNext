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
