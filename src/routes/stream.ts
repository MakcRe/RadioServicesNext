import type { FastifyInstance } from 'fastify'
import type { Broadcaster } from '../services/broadcaster.js'
import type { ListenerManager } from '../services/listener-manager.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerStreamRoutes(app: AnyFastifyInstance, deps: {
  broadcaster: Broadcaster
  listenerManager: ListenerManager
}): void {
  const liveHandler = async (request: any, reply: any) => {
    if (!deps.broadcaster.isLive()) {
      reply.status(503)
      return { error: 'no live stream' }
    }

    const ip = request.ip ?? ''
    const ua = (request.headers['user-agent'] as string) ?? ''
    const referer = (request.headers['referer'] as string) ?? null
    const logId = deps.listenerManager.connect({ ip, userAgent: ua, referer })

    const listener = deps.broadcaster.subscribe()
    reply.hijack()

    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-store',
        'icy-name': 'radioServices',
        'icy-public': '1',
      })
    } catch (err) {
      deps.listenerManager.disconnect(logId)
      return
    }

    const snapshot = listener.readSnapshot()
    if (snapshot.length > 0) {
      reply.raw.write(snapshot)
    }

    listener.on('data', (chunk: Buffer) => {
      try {
        reply.raw.write(chunk)
      } catch (err) {
        listener.end()
        deps.listenerManager.disconnect(logId)
      }
    })

    const cleanup = () => {
      deps.listenerManager.disconnect(logId)
    }
    listener.on('end', cleanup)
    listener.on('close', cleanup)
    request.raw.on('close', cleanup)
  }

  app.get('/stream', liveHandler)
  app.get('/live.mp3', liveHandler)
}
