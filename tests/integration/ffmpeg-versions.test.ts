import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildApp } from '../../src/app.js'
import type { FastifyInstance } from 'fastify'
import request from 'supertest'

let app: FastifyInstance
let tempDir: string
let binRoot: string
let configPath: string

function placeBinary(version: string): void {
  const dir = join(binRoot, '.versions', version)
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, 'ffmpeg')
  writeFileSync(
    bin,
    `#!/bin/sh\necho "ffmpeg version ${version}.0"\nexit 0\n`,
    { mode: 0o755 },
  )
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-versions-'))
  binRoot = join(tempDir, 'bin')
  configPath = join(tempDir, 'config.yaml')

  // Pre-place 7.1 + 8.1
  placeBinary('7.1')
  placeBinary('8.1')

  writeFileSync(
    configPath,
    `
server: { host: "127.0.0.1", port: 0 }
auth: { sourcePassword: "x" }
ffmpeg: { version: "7.1", sourceUrl: "https://example.invalid/" }
archive: { directory: "${join(tempDir, 'arc')}", segmentDurationSec: 3600, retentionDays: 1, minFreeSpaceMB: 100 }
playlist: { uploadDir: "${join(tempDir, 'up')}", maxFileSizeMB: 50, allowedExtensions: [".mp3"] }
logging: { directory: "${join(tempDir, 'logs')}", level: "error", retentionDays: 1 }
stream: { pollIntervalMs: 5000, pollIntervalMaxMs: 30000 }
db: { path: "${join(tempDir, 't.db')}" }
`,
  )
  const built = await buildApp(configPath, { binRoot })
  app = built.app
  await app.listen({ port: 0, host: '127.0.0.1' })
})

afterAll(async () => {
  if (app) await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('GET /api/ffmpeg/versions', () => {
  it('returns installed versions sorted descending', async () => {
    const res = await request(app.server).get('/api/ffmpeg/versions')
    expect(res.status).toBe(200)
    expect(res.body.versions).toEqual(['8.1', '7.1'])
    expect(res.body.recommended).toBe('8.1')
    expect(res.body.current).toBe('8.1')
  })
})

describe('POST /api/ffmpeg/select', () => {
  it('updates config.ffmpeg.version in memory', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '7.1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, message: expect.stringContaining('7.1') })

    const cfg = await request(app.server).get('/api/config')
    expect(cfg.body.ffmpeg.version).toBe('7.1')
  })

  it('returns 400 when version is not installed', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '9.9' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/不存在/)
  })

  it('returns 400 when version binary is missing or broken', async () => {
    // Remove 7.1 binary after the previous test selected it
    rmSync(join(binRoot, '.versions', '7.1', 'ffmpeg'))
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '7.1' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/损坏|不存在/)
  })
})
