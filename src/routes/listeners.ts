import type { FastifyInstance } from 'fastify'
import type { ListenerManager } from '../services/listener-manager.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerListenersRoutes(app: AnyFastifyInstance, deps: {
  listenerManager: ListenerManager
}): void {
  app.get('/api/listeners/current', async () => {
    return {
      count: deps.listenerManager.countCurrent(),
      listeners: deps.listenerManager.current(),
    }
  })

  app.get('/api/listeners/history', async (request) => {
    const { page = '1', pageSize = '50' } = request.query as { page?: string; pageSize?: string }
    const p = Math.max(1, Number(page))
    const ps = Math.max(1, Math.min(500, Number(pageSize)))
    return deps.listenerManager.history(p, ps)
  })
}
