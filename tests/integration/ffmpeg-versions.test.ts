import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApp } from '@radio-services/server'
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

// Place a binary with a version string that disagrees with its directory name.
// Useful for testing that `current` follows the configured/selected version,
// not the probed `-version` output of whichever binary happens to live in
// that slot.
function placeBinaryWithProbedVersion(dirVersion: string, probedVersion: string): void {
  const dir = join(binRoot, '.versions', dirVersion)
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, 'ffmpeg')
  writeFileSync(
    bin,
    `#!/bin/sh\necho "ffmpeg version ${probedVersion}.0"\nexit 0\n`,
    { mode: 0o755 },
  )
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-versions-'))
  // binRoot matches the production default ("bin/ffmpeg") so the layout
  // matches what ffmpeg-manager.ts expects: .versions/{v}/ffmpeg under it.
  binRoot = join(tempDir, 'bin', 'ffmpeg')
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
  const built = await createApp({ configPath })
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
    // `current` follows the configured `ffmpeg.version` (config.yaml = "7.1"),
    // not the highest installed. This is the new precedence: config wins over
    // auto-resolve, and the user selection wins over both. See the manager
    // bundled-priority block for the rationale.
    expect(res.body.current).toBe('7.1')
  })
})

describe('POST /api/ffmpeg/select', () => {
  it('updates the active version immediately (no restart required)', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '7.1' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toContain('7.1')
    expect(res.body.available).toBe(true)

    // /api/ffmpeg/status reflects the new version on the very next call —
    // this is the "live switch" promise to the operator.
    const status = await request(app.server).get('/api/ffmpeg/status')
    expect(status.body.path).toBe('bin/ffmpeg/.versions/7.1/ffmpeg')
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

  it('returns 400 when version is empty string', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('returns 400 when version field is missing', async () => {
    const res = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('persists the user selection to bin/ffmpeg/.state.json (survives restart)', async () => {
    // Pick the OTHER installed version so we exercise both directions.
    const target = (await request(app.server).get('/api/ffmpeg/versions')).body.current === '7.1' ? '8.1' : '7.1'

    const sel = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: target })
    expect(sel.status).toBe(200)
    expect(sel.body.success).toBe(true)

    // keyv-file stores entries as `cache: [[namespace:key, {value}], ...]`.
    // We assert the user's choice round-trips through the on-disk format.
    const stateFile = join(binRoot, '.state.json')
    const persisted = JSON.parse(readFileSync(stateFile, 'utf8'))
    expect(persisted.cache).toBeDefined()
    const entries = (persisted.cache as Array<[string, { value: string }]>)
    const entry = entries.find(([k]) => k === 'ffmpeg:selected_version')
    expect(entry).toBeDefined()
    expect(JSON.parse(entry![1].value).value).toBe(target)
  })
})

describe('Restart survival: user selection is honored across buildApp()', () => {
  it('after selecting 8.1 then restarting, /api/ffmpeg/versions reports current=8.1', async () => {
    // First, make a selection we can observe after restart.
    const sel = await request(app.server)
      .post('/api/ffmpeg/select')
      .send({ version: '8.1' })
    expect(sel.status).toBe(200)

    // Tear down the running app (which also flushes keyv-file's debounced
    // write — the writer uses ~100ms writeDelay so the previous test's
    // write is flushed by app.close()).
    await app.close()

    // Rebuild from the SAME config + binRoot so .state.json is reused.
    const rebuilt = await buildApp(configPath, { binRoot })
    app = rebuilt.app
    await app.listen({ port: 0, host: '127.0.0.1' })

    const res = await request(app.server).get('/api/ffmpeg/versions')
    expect(res.status).toBe(200)
    expect(res.body.current).toBe('8.1')

    // Status path must point at the .versions/8.1 binary, not 7.1.
    const statusRes = await request(app.server).get('/api/ffmpeg/status')
    expect(statusRes.status).toBe(200)
    expect(statusRes.body.path).toBe('bin/ffmpeg/.versions/8.1/ffmpeg')
    expect(statusRes.body.path).not.toContain(process.cwd())
  })
})

describe('GET /api/ffmpeg/remote-versions', () => {
  it('annotates installed versions and hides download affordance for them', async () => {
    // Stub fetch so we don't depend on network in CI. Return a tiny
    // list of two remote versions — one we have installed locally,
    // one we don't — so we can assert the `installed` flag.
    const realFetch = globalThis.fetch
    const fakeBody = [{ name: 'n7.1.2' }, { name: 'n9.0' }]
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => fakeBody,
      text: async () => JSON.stringify(fakeBody),
    } as unknown as Response) as unknown as typeof fetch
    try {
      const res = await request(app.server).get('/api/ffmpeg/remote-versions')
      expect(res.status).toBe(200)
      // 9.0 first (highest), then 7.1.2. The currently-restored app has
      // 8.1 installed from the previous test — so 7.1 (matching 7.1.2 by
      // major.minor) is NOT installed; 8.1 isn't even in the remote
      // list, so we expect both to be marked as not installed.
      expect(res.body.versions).toEqual([
        { version: '9.0', installed: false },
        { version: '7.1.2', installed: false },
      ])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('marks a remote version as installed when its major.minor matches a local slot', async () => {
    const realFetch = globalThis.fetch
    const fakeBody = [{ name: 'n8.1' }, { name: 'n9.0' }]
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => fakeBody,
      text: async () => JSON.stringify(fakeBody),
    } as unknown as Response) as unknown as typeof fetch
    try {
      const res = await request(app.server).get('/api/ffmpeg/remote-versions')
      expect(res.status).toBe(200)
      // 8.1.1 remote patch is higher than installed 8.1 — still marked
      // installed because major.minor (8.1) matches.
      const e81 = res.body.versions.find((v: { version: string }) => v.version.startsWith('8.1'))
      expect(e81.installed).toBe(true)
      const e90 = res.body.versions.find((v: { version: string }) => v.version.startsWith('9.0'))
      expect(e90.installed).toBe(false)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
