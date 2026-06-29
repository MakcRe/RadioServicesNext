import type { FastifyInstance } from 'fastify'
import type { WsHub } from '../services/ws-hub.js'
import type { EventMap } from '../services/ws-hub.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerWsRoute(app: AnyFastifyInstance, deps: {
  wsHub: WsHub
}): void {
  app.get('/ws', { websocket: true }, (connection, _req) => {
    const socket = (connection as any).socket ?? connection

    const events: (keyof EventMap)[] = [
      'source-start',
      'source-end',
      'listener-count',
      'archive-new',
      'ffmpeg-download',
      'config-changed',
    ]

    const handlers: Record<string, (data: unknown) => void> = {}
    for (const e of events) {
      handlers[e] = (data) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: e, data }))
        }
      }
      deps.wsHub.on(e, handlers[e])
    }

    socket.on('close', () => {
      for (const e of events) {
        deps.wsHub.off(e, handlers[e])
      }
    })
  })
}
