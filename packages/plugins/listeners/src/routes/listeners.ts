import type { PluginContext, RouteOptions } from '@radio-services/shared'
import type { ListenerManager } from '../services/listener-manager.js'

export function registerListenersRoutes(
  ctx: PluginContext,
  deps: {
    listenerManager: ListenerManager
  }
): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/api/listeners/current',
      handler: async () => {
        return {
          count: deps.listenerManager.countCurrent(),
          listeners: deps.listenerManager.current(),
        }
      }
    },
    {
      method: 'GET',
      url: '/api/listeners/history',
      handler: async (query: unknown) => {
        const { page = '1', pageSize = '50' } = query as { page?: string; pageSize?: string }
        const p = Math.max(1, Number(page))
        const ps = Math.max(1, Math.min(500, Number(pageSize)))
        return deps.listenerManager.history(p, ps)
      }
    }
  ]

  routes.forEach(route => ctx.registerRoute(route))
}
