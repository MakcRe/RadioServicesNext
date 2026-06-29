import Fastify, { FastifyInstance } from 'fastify'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: 'info' },
  })

  app.get('/health', async () => ({ ok: true }))

  return app
}
