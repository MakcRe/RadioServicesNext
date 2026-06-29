import type { FastifyInstance } from 'fastify'
import type { WsHub } from '../services/ws-hub.js'
import type { AppConfig } from '../config.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

const REDACTED_PLACEHOLDER = '***'

const SENSITIVE_KEYS = new Set(['auth.sourcePassword'])

function getIn(obj: unknown, path: string): unknown {
  let current: unknown = obj
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function setIn(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current !== 'object' || current === null) return
    current = (current as Record<string, unknown>)[parts[i]]
  }
  if (typeof current === 'object' && current !== null) {
    ;(current as Record<string, unknown>)[parts[parts.length - 1]] = value as never
  }
}

function redactConfig(cfg: AppConfig): AppConfig {
  const clone = structuredClone(cfg)
  for (const key of SENSITIVE_KEYS) {
    if (getIn(clone, key) !== undefined) {
      setIn(clone, key, REDACTED_PLACEHOLDER)
    }
  }
  return clone
}

export function registerConfigRoutes(app: AnyFastifyInstance, deps: {
  config: AppConfig
  wsHub: WsHub
}): void {
  app.get('/api/config', async () => redactConfig(deps.config))

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
