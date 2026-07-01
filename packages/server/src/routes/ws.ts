import type { FastifyInstance } from 'fastify';
import type { WsHub, EventMap } from '@radio-services/core';

type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>;

export interface WsRouteDeps {
  wsHub: WsHub;
}

export function registerWsRoute(app: AnyFastifyInstance, deps: WsRouteDeps): void {
  app.get('/ws', { websocket: true }, (connection, _req) => {
    const socket = (connection as any).socket ?? connection;

    type EventKey = keyof EventMap;
    const events: EventKey[] = [
      'source-start',
      'source-end',
      'listener-count',
      'archive-new',
      'ffmpeg-download',
      'config-changed',
    ];

    const handlers: Partial<Record<EventKey, (data: unknown) => void>> = {};
    for (const e of events) {
      handlers[e] = (data: unknown) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: e, data }));
        }
      };
      deps.wsHub.on(e, handlers[e]!);
    }

    socket.on('close', () => {
      for (const e of events) {
        deps.wsHub.off(e, handlers[e]!);
      }
    });
  });
}
