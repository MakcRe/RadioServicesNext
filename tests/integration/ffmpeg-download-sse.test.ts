import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request as httpRequest } from 'http'
import { createApp } from '@radio-services/server'
import type { FastifyInstance } from 'fastify'
import { attachDownloadStatusSse, type SseStream } from '@radio-services/plugins/ffmpeg'

/** Build a fake raw stream that records writes & lets us fire 'close'. */
function makeStream(): SseStream & { writes: string[]; headers: Record<string, string | number>; fireClose: () => void } {
  const listeners: Array<() => void> = []
  return {
    writes: [],
    headers: {},
    writeHead(_status, headers = {}) {
      this.headers = { ...this.headers, ...headers }
    },
    write(chunk) {
      this.writes.push(chunk)
      return true
    },
    on(_event, listener) {
      listeners.push(listener)
    },
    off(_event, listener) {
      const idx = listeners.indexOf(listener)
      if (idx >= 0) listeners.splice(idx, 1)
    },
    fireClose() {
      // Copy first; cleanup removes itself from listeners
      for (const l of [...listeners]) l()
    },
  }
}

/** A manager that satisfies the SSE dep's narrow surface. */
function makeManager(): EventEmitter & { onCount: () => number; offCount: () => number } {
  const m = new EventEmitter() as EventEmitter & { onCount: () => number; offCount: () => number }
  let ons = 0
  let offs = 0
  const origOn = m.on.bind(m)
  const origOff = m.off.bind(m)
  m.on = ((...args: unknown[]) => {
    ons++
    // @ts-expect-error - delegating to original
    return origOn(...(args as Parameters<typeof origOn>))
  }) as typeof m.on
  m.off = ((...args: unknown[]) => {
    offs++
    // @ts-expect-error - delegating to original
    return origOff(...(args as Parameters<typeof origOff>))
  }) as typeof m.off
  m.onCount = () => ons
  m.offCount = () => offs
  return m
}

describe('attachDownloadStatusSse (BACKLOG P0-2)', () => {
  it('writes SSE headers, an initial idle frame, and a retry hint', () => {
    const rawReply = makeStream()
    const rawRequest = makeStream()
    const manager = makeManager()
    const hijack = vi.fn()

    attachDownloadStatusSse({
      ffmpegManager: manager,
      rawRequest,
      rawReply,
      hijack,
    })

    expect(hijack).toHaveBeenCalledOnce()
    expect(rawReply.headers['Content-Type']).toBe('text/event-stream')
    const all = rawReply.writes.join('')
    expect(all).toContain('retry: 5000')
    expect(all).toContain('"state":"idle"')
  })

  it('forwards each FFmpegManager "download" event to the response as an SSE data frame', () => {
    const rawReply = makeStream()
    const rawRequest = makeStream()
    const manager = makeManager()

    attachDownloadStatusSse({
      ffmpegManager: manager,
      rawRequest,
      rawReply,
      hijack: () => {},
    })

    manager.emit('download', { state: 'downloading', percent: 50, downloaded: 1, total: 2, speed: 1 })
    manager.emit('download', { state: 'verifying', message: 'sha256 ok' })
    manager.emit('download', { state: 'complete', path: '/x', version: '7.1' })

    const all = rawReply.writes.join('')
    // The three forwards plus the initial idle frame
    expect((all.match(/data: /g) ?? []).length).toBe(4)
    expect(all).toContain('"state":"downloading"')
    expect(all).toContain('"state":"verifying"')
    expect(all).toContain('"state":"complete"')
  })

  it('removes the manager listener when the request closes (no leaks)', () => {
    const rawReply = makeStream()
    const rawRequest = makeStream()
    const manager = makeManager()

    attachDownloadStatusSse({
      ffmpegManager: manager,
      rawRequest,
      rawReply,
      hijack: () => {},
    })
    expect(manager.onCount()).toBe(1)

    rawRequest.fireClose()

    expect(manager.offCount()).toBe(1)
    // After cleanup, future emits must not write to the response.
    const writesBefore = rawReply.writes.length
    manager.emit('download', { state: 'downloading', percent: 1, downloaded: 1, total: 1, speed: 0 })
    expect(rawReply.writes.length).toBe(writesBefore)
  })

  it('removes the manager listener when the response closes (no leaks)', () => {
    const rawReply = makeStream()
    const rawRequest = makeStream()
    const manager = makeManager()

    attachDownloadStatusSse({
      ffmpegManager: manager,
      rawRequest,
      rawReply,
      hijack: () => {},
    })
    expect(manager.onCount()).toBe(1)

    rawReply.fireClose()

    expect(manager.offCount()).toBe(1)
  })

  it('does not double-subscribe or leak if both request and response close (idempotent cleanup)', () => {
    const rawReply = makeStream()
    const rawRequest = makeStream()
    const manager = makeManager()

    attachDownloadStatusSse({
      ffmpegManager: manager,
      rawRequest,
      rawReply,
      hijack: () => {},
    })
    expect(manager.onCount()).toBe(1)

    rawRequest.fireClose()
    rawReply.fireClose()

    // off should have been called once for the manager and the duplicate
    // fire on the other side should be a no-op (off is idempotent).
    expect(manager.offCount()).toBe(1)
  })

  it('skips future frames after cleanup even when many listeners leaked from prior clients', () => {
    // Defensive: a real-world scenario where a previous client's cleanup
    // never ran. We just check that after a single client cleans up, its
    // emit is no longer routed.
    const rawReply = makeStream()
    const rawRequest = makeStream()
    const manager = makeManager()
    attachDownloadStatusSse({
      ffmpegManager: manager,
      rawRequest,
      rawReply,
      hijack: () => {},
    })
    rawRequest.fireClose()
    const writesAfterClose = rawReply.writes.length
    manager.emit('download', { state: 'downloading', percent: 99, downloaded: 9, total: 9, speed: 0 })
    expect(rawReply.writes.length).toBe(writesAfterClose)
  })
})

/**
 * End-to-end smoke test: the SSE route is actually wired into Fastify and
 * responds with the expected Content-Type and an initial idle frame. We
 * intentionally don't drive a download here — that path is covered by the
 * unit tests above (where vi.spyOn can take effect) and by manual UI
 * testing in dev. This test exists to catch regressions in the route
 * registration itself (e.g. handler moved, path typo, Fastify hijack
 * accident).
 */
describe('SSE smoke: /api/ffmpeg/download/status end-to-end (BACKLOG P0-2)', () => {
  let app: FastifyInstance
  let tempDir: string
  let archiveDir: string
  let uploadDir: string
  let dbPath: string

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'radio-sse-smoke-'))
    archiveDir = join(tempDir, 'archive')
    uploadDir = join(tempDir, 'uploads')
    dbPath = join(tempDir, 'test.db')
    mkdirSync(archiveDir, { recursive: true })
    mkdirSync(uploadDir, { recursive: true })

    const configPath = join(tempDir, 'config.yaml')
    const { writeFileSync } = await import('fs')
    writeFileSync(
      configPath,
      `
server:
  host: "127.0.0.1"
  port: 18001

auth:
  sourcePassword: "testpass"

ffmpeg:
  version: "7.1"
  sourceUrl: "https://example.invalid/"

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

logging:
  directory: "${join(tempDir, 'logs')}"
  level: "error"
  retentionDays: 1

stream:
  pollIntervalMs: 5000
  pollIntervalMaxMs: 30000

db:
  path: "${dbPath}"
`,
    )

    // Provide a fake ffmpeg so initialize() doesn't try to download.
    const { writeFileSync: wfs, chmodSync } = await import('fs')
    const fakeDir = join(tempDir, 'ffbin')
    mkdirSync(fakeDir, { recursive: true })
    const fakeBin = join(fakeDir, 'ffmpeg')
    wfs(
      fakeBin,
      '#!/bin/sh\necho "ffmpeg version 7.1 fake"\nexit 0\n',
    )
    chmodSync(fakeBin, 0o755)

    const built = await createApp({ configPath, ffmpegPathOverride: fakeBin })
    app = built.app
    await app.listen({ port: 0, host: '127.0.0.1' })
  })

  afterAll(async () => {
    if (app) await app.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('GET /api/ffmpeg/download/status returns text/event-stream with an initial idle frame', async () => {
    const address = app.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const chunks: string[] = []
    const headers: Record<string, string | string[] | undefined> = {}

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        { hostname: '127.0.0.1', port, path: '/api/ffmpeg/download/status', method: 'GET' },
        (res) => {
          for (const [k, v] of Object.entries(res.headers)) headers[k] = v as string
          res.setEncoding('utf8')
          // Capture just enough to see the headers + initial frame.
          res.on('data', (chunk: string) => {
            chunks.push(chunk)
            if (chunks.join('').includes('"state":"idle"')) {
              req.destroy()
            }
          })
          res.on('end', () => resolve())
          res.on('close', () => resolve())
        },
      )
      req.on('error', () => {
        // destroy() raises ECONNRESET; we're done anyway.
        resolve()
      })
      req.setTimeout(2000, () => {
        req.destroy()
        reject(new Error('timed out before initial idle frame'))
      })
      req.end()
    })

    expect(headers['content-type']).toMatch(/text\/event-stream/)
    expect(chunks.join('')).toContain('"state":"idle"')
  })
})
