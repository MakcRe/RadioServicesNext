import Fastify, { FastifyInstance } from 'fastify'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import type pino from 'pino'

export async function buildApp(configPath = 'config/config.yaml'): Promise<FastifyInstance> {
  const config = loadConfig(configPath)
  const logger = createLogger(config.logging)

  const app = Fastify({ logger: logger as unknown as pino.Logger })

  app.get('/health', async () => ({ ok: true }))
  app.get('/api/status', async () => ({ ffmpeg: 'pending', listeners: 0 }))

  return app as unknown as FastifyInstance
}
