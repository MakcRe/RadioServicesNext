import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request as httpRequest } from 'http'
import { createApp } from '@radio-services/server'
import type { FastifyInstance } from 'fastify'
import request from 'supertest'
import { silentMp3Frame } from '../helpers/mock-source.js'

let app: FastifyInstance
let tempDir: string
let archiveDir: string
let uploadDir: string
let dbPath: string
let ffmpegBin: string
let configPath: string

function fakeFfmpeg(): string {
  const dir = join(tempDir, 'ffbin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'ffmpeg')
  writeFileSync(
    path,
    `#!/bin/sh
# Fake ffmpeg: write marker and exit immediately
touch "${tempDir}/ffmpeg_marker_$$"
exit 0
`,
  )
  chmodSync(path, 0o755)
  return path
}

function createTestConfig(): string {
  const configPath = join(tempDir, 'config.yaml')
  const config = `
server:
  host: "127.0.0.1"
  port: 18000

auth:
  sourcePassword: "testpass"

ffmpeg:
  version: "7.1"
  sourceUrl: "https://example.com/ffmpeg"

archive:
  directory: "${archiveDir}"
  segmentDurationSec: 3600
  retentionDays: 7
  minFreeSpaceMB: 100

playlist:
  uploadDir: "${uploadDir}"
  maxFileSizeMB: 50
  allowedExtensions:
    - ".mp3"
    - ".m4a"
    - ".aac"
    - ".ogg"
    - ".wav"
    - ".flac"

logging:
  directory: "${join(tempDir, 'logs')}"
  level: "error"
  retentionDays: 1

stream:
  pollIntervalMs: 5000
  pollIntervalMaxMs: 30000

db:
  path: "${dbPath}"
`
  writeFileSync(configPath, config)
  return configPath
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-e2e-'))
  archiveDir = join(tempDir, 'archive')
  uploadDir = join(tempDir, 'uploads')
  dbPath = join(tempDir, 'test.db')
  mkdirSync(archiveDir, { recursive: true })
  mkdirSync(uploadDir, { recursive: true })

  configPath = createTestConfig()
  ffmpegBin = fakeFfmpeg()
  const { app: builtApp } = await createApp({ configPath, ffmpegPathOverride: ffmpegBin })
  app = builtApp
  await app.listen({ port: 0, host: '127.0.0.1' })
})

afterAll(async () => {
  if (app) await app.close()
  rmSync(tempDir, { recursive: true, force: true })
})

afterEach(async () => {
  // Ensure source connections are closed between tests
  await new Promise((r) => setTimeout(r, 100))
})

function authHeader(): string {
  return 'Basic ' + Buffer.from('source:testpass').toString('base64')
}

function putSource(frames: Buffer[], delayMs = 80): Promise<{ success: boolean }> {
  return new Promise((resolve, reject) => {
    const address = app.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/source',
        method: 'PUT',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'audio/mpeg',
          'User-Agent': 'Lavf/60.0.0',
        },
      },
      (res) => {
        res.on('data', () => {})
        res.on('end', () => resolve({ success: res.statusCode === 200 }))
      },
    )
    req.on('error', reject)
    ;(async () => {
      for (const frame of frames) {
        req.write(frame)
        await new Promise((r) => setTimeout(r, delayMs))
      }
      req.end()
    })()
  })
}

function connectListener(durationMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const address = app.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/stream',
        method: 'GET',
        headers: {
          'User-Agent': 'TestListener/1.0',
        },
      },
      (res) => {
        res.on('data', () => {})
        setTimeout(() => {
          req.destroy()
          resolve()
        }, durationMs)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('E2E: Stream → Listen', () => {
  it('returns 503 when no stream is live', async () => {
    const res = await request(app.server).get('/stream')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'no live stream' })
  })

  it('receives data when stream is live (source pushes via ffmpeg mock)', async () => {
    // Write a real MP3 frame to a temp file so ffmpeg can "process" it
    const mp3File = join(tempDir, 'push.mp3')
    writeFileSync(mp3File, Buffer.concat(Array.from({ length: 10 }, () => silentMp3Frame())))

    // Use the app's own /api/source/start to launch ffmpeg to push
    await request(app.server)
      .post('/api/source/start')
      .send({ type: 'file', id: 1 })

    // Start pushing frames with native http.request to ensure proper timing
    const frames = Array.from({ length: 5 }, () => silentMp3Frame())
    const sourcePromise = putSource(frames, 80)

    // Wait for source to start pushing
    await new Promise((r) => setTimeout(r, 150))

    // Now fetch the stream while source is still pushing
    const getRes = await request(app.server)
      .get('/stream')
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        setTimeout(() => {
          res.destroy()
          callback(null, Buffer.concat(chunks))
        }, 200)
      })

    expect(getRes.status).toBe(200)
    expect(getRes.body).toBeInstanceOf(Buffer)
    expect(getRes.body.length).toBeGreaterThan(0)

    // Wait for source to finish
    await sourcePromise
    await new Promise((r) => setTimeout(r, 300))
  })
})

describe('E2E: Upload', () => {
  it('accepts MP3 file upload', async () => {
    const mp3Data = Buffer.concat(Array.from({ length: 5 }, () => silentMp3Frame()))

    const res = await request(app.server)
      .post('/api/source/upload')
      .attach('file', mp3Data, {
        filename: 'test.mp3',
        contentType: 'audio/mpeg',
      })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('filename')
    expect(res.body).toHaveProperty('originalName')
    expect(res.body).toHaveProperty('sizeBytes')
  })

  it('rejects upload without file', async () => {
    const res = await request(app.server)
      .post('/api/source/upload')
      .field('other', 'data')

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })
})

describe('E2E: Archive', () => {
  it('archive directory is created', async () => {
    expect(existsSync(archiveDir)).toBe(true)
  })
})

describe('E2E: Listeners', () => {
  it('returns listener count via correct endpoint', async () => {
    const res = await request(app.server).get('/api/listeners/current')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('count')
    expect(res.body).toHaveProperty('listeners')
  })

  it('increments listener count when connected', async () => {
    // Get initial listener count
    const initialRes = await request(app.server).get('/api/listeners/current')
    const countInitial = initialRes.body.count ?? 0

    // Start source with a continuous stream using native http.request
    const frames = Array.from({ length: 30 }, () => silentMp3Frame())
    const sourceResultPromise = putSource(frames, 30)

    // Wait for source to establish
    await new Promise((r) => setTimeout(r, 500))

    // Check source result
    const sourceResult = await sourceResultPromise
    expect(sourceResult.success).toBe(true)

    // Connect a listener using native http.request (not supertest)
    // Keep connection open for 500ms to ensure listener is registered
    const listenerPromise = connectListener(500)

    // Wait for listener to connect
    await new Promise((r) => setTimeout(r, 200))

    // Check listener count while connection is still open
    const afterRes = await request(app.server).get('/api/listeners/current')
    const countAfter = afterRes.body.count

    // Wait for listener to disconnect
    await listenerPromise

    // Verify listener count increased
    expect(countAfter).toBeGreaterThanOrEqual(countInitial + 1)
  })
})

describe('E2E: Status & Health', () => {
  it('returns server status', async () => {
    const res = await request(app.server).get('/api/status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('ffmpeg')
    expect(res.body).toHaveProperty('broadcaster')
    expect(res.body).toHaveProperty('listeners')
  })

  it('health check returns ok', async () => {
    const res = await request(app.server).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('E2E: Source-switch resilience (HANDOFF B7)', () => {
  it('keeps listener alive across a source-end / re-pipe cycle', async () => {
    // Start source 1 with a long-ish push so the listener has time to attach
    const source1Frames = Array.from({ length: 10 }, () => silentMp3Frame())
    const source1Promise = putSource(source1Frames, 50)

    // Give the broadcaster time to bind to source 1
    await new Promise((r) => setTimeout(r, 200))

    expect((await request(app.server).get('/api/status')).body.broadcaster.isLive).toBe(true)

    // Open a listener and capture chunks. After source 1 ends, we expect
    // the listener's HTTP connection to still be open (broadcaster no
    // longer kicks listeners on source-end).
    const listenerChunks: Buffer[] = []
    const listenerPromise = new Promise<void>((resolve, reject) => {
      const address = app.server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/stream',
          method: 'GET',
          headers: { 'User-Agent': 'ResilienceTester/1.0' },
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error('listener got ' + res.statusCode))
            return
          }
          res.on('data', (c: Buffer) => listenerChunks.push(c))
          res.on('end', () => reject(new Error('listener stream ended unexpectedly')))
          res.on('close', () => resolve())
        },
      )
      req.on('error', reject)
      req.end()
      setTimeout(() => req.destroy(), 1000)
    })

    // Wait for source 1 to end and verify the listener was NOT kicked
    await source1Promise
    await new Promise((r) => setTimeout(r, 600))

    expect(listenerChunks.length).toBeGreaterThan(0)
    // broadcaster reports offline after source-end
    const status = (await request(app.server).get('/api/status')).body
    expect(status.broadcaster.isLive).toBe(false)

    await listenerPromise
  })

  it('switching to a second source reuses the same listener connection', async () => {
    // Phase 1: source1 pushes, listener attaches, listener gets chunks.
    // Phase 2: source1 ends. listener survives (verified by T1 — here we
    // focus on reuse: same socket sees chunks from source2 without being
    // re-issued).

    let listenerChunks = 0
    let listenerStatus: number | null = null
    let listenerReq: ReturnType<typeof httpRequest> | null = null
    let listenerDestroyed = false

    function destroyListener(): void {
      if (listenerReq && !listenerDestroyed) {
        listenerDestroyed = true
        try { listenerReq.destroy() } catch {}
      }
    }

    function attachListener(): Promise<void> {
      const address = app.server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      return new Promise<void>((resolve) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: '/stream',
            method: 'GET',
            headers: { 'User-Agent': 'ResilienceTester/2.0' },
          },
          (res) => {
            listenerStatus = res.statusCode ?? null
            if (res.statusCode !== 200) { resolve(); return }
            res.on('data', () => { listenerChunks += 1 })
            res.on('close', () => resolve())
            res.on('end', () => resolve())
          },
        )
        listenerReq = req
        req.on('error', () => resolve())
        req.end()
      })
    }

    // Phase 1: start source1 first, then attach listener
    const source1Frames = Array.from({ length: 15 }, () => silentMp3Frame())
    const source1Promise = putSource(source1Frames, 50)
    // Give broadcaster a moment, then attach
    await new Promise((r) => setTimeout(r, 150))
    const listenerPromise = attachListener()

    // Wait for source1 to end
    await source1Promise
    await new Promise((r) => setTimeout(r, 300))
    const chunksAfterSource1 = listenerChunks
    expect(chunksAfterSource1).toBeGreaterThan(0)
    expect(listenerStatus).toBe(200)

    // Phase 2: start source2. The listener is still attached (T1 verified
    // survival). It should receive source2's chunks without re-subscribing.
    const source2Frames = Array.from({ length: 15 }, () => silentMp3Frame())
    const source2Promise = putSource(source2Frames, 50)
    await source2Promise
    await new Promise((r) => setTimeout(r, 300))

    expect(listenerChunks).toBeGreaterThan(chunksAfterSource1)

    destroyListener()
    await listenerPromise
  })
})

describe('E2E: Static assets (BACKLOG P0-1 + P2-11)', () => {
  it('serves the listener landing page at GET /', async () => {
    const res = await request(app.server).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('radioServices')
    expect(res.text).toContain('/stream')
  })

  it('serves the admin shell at GET /admin', async () => {
    const res = await request(app.server).get('/admin')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('Radio Services 管理后台')
  })

  it('serves the admin shell at GET /admin/index.html', async () => {
    const res = await request(app.server).get('/admin/index.html')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
  })

  it('serves the admin bundle at GET /admin/app.js', async () => {
    const res = await request(app.server)
      .get('/admin/app.js')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/javascript|text\/javascript/)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('serves the admin stylesheet at GET /admin/app.css', async () => {
    const res = await request(app.server)
      .get('/admin/app.css')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/css/)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('returns 404 for paths that match no static file and no API route (no static-serve regression)', async () => {
    const res = await request(app.server).get('/totally-nonexistent-path-xyz')
    expect(res.status).toBe(404)
  })
})

describe('E2E: Static assets are cwd-independent (BACKLOG P0-1 + P2-11 regression)', () => {
  // When `pnpm --filter @radio-services/server dev` runs the server, the
  // working directory is packages/server/ — NOT the monorepo root. Static
  // serving must resolve the public/ directory relative to the source file,
  // not process.cwd(). This test simulates that by spawning a second app
  // with cwd set to a subdirectory.
  it('serves /admin/app.js even when process.cwd() is a non-repo subdirectory', async () => {
    const subDir = mkdtempSync(join(tmpdir(), 'radio-cwd-'))
    const originalCwd = process.cwd()
    try {
      process.chdir(subDir)
      const { app: app2 } = await createApp({ configPath, ffmpegPathOverride: ffmpegBin })
      await app2.listen({ port: 0, host: '127.0.0.1' })
      try {
        const res = await request(app2.server).get('/admin/app.js')
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/application\/javascript|text\/javascript/)
      } finally {
        await app2.close()
      }
    } finally {
      process.chdir(originalCwd)
      rmSync(subDir, { recursive: true, force: true })
    }
  })
})
