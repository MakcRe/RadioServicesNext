// Fastify-compatible handler types (avoid importing fastify to keep shared package dependency-free)
export interface FastifyRawSocket {
  on(event: 'close' | 'end' | 'error' | 'data', listener: (...args: unknown[]) => void): unknown
}

export interface FastifyRawRequest {
  on(event: 'close' | 'end' | 'error' | 'data', listener: (...args: unknown[]) => void): unknown
  socket?: FastifyRawSocket
}

export type FastifyRequest = {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
  /**
   * Underlying Node IncomingMessage. Only populated by routes that need
   * access to long-lived connection events (SSE, streaming uploads).
   * Type-narrowed via the `FastifyRawRequest` shape above.
   */
  raw?: FastifyRawRequest;
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
