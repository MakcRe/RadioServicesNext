import type { FastifyInstance } from 'fastify'
import type { WsHub } from '../services/ws-hub.js'
import type { AppConfig } from '../config.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerConfigRoutes(app: AnyFastifyInstance, deps: {
  config: AppConfig
  wsHub: WsHub
}): void {
  app.get('/api/config', async () => deps.config)

  app.put('/api/config', async (request) => {
    const body = request.body as { key?: string; value?: unknown }
    if (!body.key) throw new Error('key required')

    const parts = body.key.split('.')
    let target: any = deps.config
    for (let i = 0; i < parts.length - 1; i++) {
      const next = target?.[parts[i]]
      if (typeof next !== 'object' || next === null) {
        throw new Error(`unknown key: ${body.key}`)
      }
      target = next
    }
    const leaf = parts[parts.length - 1]
    if (typeof target !== 'object' || target === null) {
      throw new Error(`unknown key: ${body.key}`)
    }
    ;(target as Record<string, unknown>)[leaf] = body.value as never
    deps.wsHub.emitEvent('config-changed', { key: body.key })
    return { ok: true }
  })
}
