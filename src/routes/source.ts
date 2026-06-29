import type { FastifyInstance } from 'fastify'
import type { SourceReceiver } from '../services/source-receiver.js'
import type { WsHub } from '../services/ws-hub.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerSourceRoutes(_app: AnyFastifyInstance, deps: {
  sourceReceiver: SourceReceiver
  wsHub: WsHub
}): void {
  deps.sourceReceiver.on('session-start', (session) => {
    deps.wsHub.emitEvent('source-start', session)
  })
  deps.sourceReceiver.on('session-end', (session) => {
    deps.wsHub.emitEvent('source-end', { sessionId: session.id })
  })
}
