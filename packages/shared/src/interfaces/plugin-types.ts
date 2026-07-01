// Fastify-compatible handler types (avoid importing fastify to keep shared package dependency-free)
export type FastifyRequest = {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
};

export type FastifyReply = {
  status: (code: number) => FastifyReply;
  send: (data: unknown) => FastifyReply;
};

export interface RouteOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  handler: (request: FastifyRequest, reply: FastifyReply) => unknown;
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
