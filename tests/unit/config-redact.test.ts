import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { registerConfigRoutes } from '@radio-services/server'
import { WsHub } from '@radio-services/core'
import type { RadioConfig } from '@radio-services/shared'

function makeConfig(): RadioConfig {
  return {
    db: { path: 'data/radio.db' },
    server: { host: '0.0.0.0', port: 8000 },
    auth: { sourcePassword: 'super-secret-42' },
    ffmpeg: {
      version: '7.1',
      sourceUrl: 'https://example.com/ffmpeg',
    },
    archive: {
      directory: 'bin/archive',
      segmentDurationSec: 3600,
      retentionDays: 7,
      minFreeSpaceMB: 500,
    },
    playlist: {
      uploadDir: 'bin/uploads',
      maxFileSizeMB: 500,
      allowedExtensions: ['.mp3', '.m4a'],
    },
    logging: {
      directory: 'logs',
      level: 'info',
      retentionDays: 30,
    },
    stream: {
      pollIntervalMs: 5000,
      pollIntervalMaxMs: 30000,
    },
  }
}

describe('Config routes', () => {
  let app: ReturnType<typeof Fastify>
  let config: RadioConfig
  let wsHub: WsHub

  beforeEach(async () => {
    config = makeConfig()
    wsHub = new WsHub()
    app = Fastify()
    registerConfigRoutes(app, { config, wsHub })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /api/config', () => {
    it('redacts auth.sourcePassword', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.auth.sourcePassword).toBe('***')
    })

    it('does not leak the real password in the response string', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config' })
      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('super-secret-42')
      expect(res.body).toContain('"sourcePassword":"***"')
    })

    it('does not mutate the original config', async () => {
      await app.inject({ method: 'GET', url: '/api/config' })
      expect(config.auth.sourcePassword).toBe('super-secret-42')
    })

    it('returns all other fields unchanged', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config' })
      const body = JSON.parse(res.body)
      expect(body.server.port).toBe(8000)
      expect(body.archive.retentionDays).toBe(7)
      expect(body.playlist.allowedExtensions).toContain('.mp3')
    })

    it('exposes stream poll interval to the front-end', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config' })
      const body = JSON.parse(res.body)
      expect(body.stream.pollIntervalMs).toBe(5000)
      expect(body.stream.pollIntervalMaxMs).toBe(30000)
    })
  })

  describe('PUT /api/config', () => {
    it('can update auth.sourcePassword', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/config',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'auth.sourcePassword', value: 'new-password-99' }),
      })
      expect(res.statusCode).toBe(200)
      expect(config.auth.sourcePassword).toBe('new-password-99')
    })

    it('reflects the updated password in the next GET', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/config',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'auth.sourcePassword', value: 'next-password' }),
      })
      const res = await app.inject({ method: 'GET', url: '/api/config' })
      const body = JSON.parse(res.body)
      // After updating, the new password is still redacted in GET
      expect(body.auth.sourcePassword).toBe('***')
    })

    it('can write to a nested leaf even if the leaf is new (handler creates it)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/config',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'auth.nonexistent', value: 'x' }),
      })
      expect(res.statusCode).toBe(200)
      expect((config.auth as Record<string, unknown>).nonexistent).toBe('x')
    })
  })
})
