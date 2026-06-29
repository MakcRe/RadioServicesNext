import type { FastifyInstance } from 'fastify'
import { join, extname } from 'path'
import { stat, readFile } from 'fs/promises'
import type { Archiver } from '../services/archiver.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerArchiveRoutes(app: AnyFastifyInstance, deps: {
  archiver: Archiver
}): void {
  app.get('/api/archive/list', async () => {
    return { files: await deps.archiver.list() }
  })

  app.get('/api/archive/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string }

    if (filename.includes('..') || filename.includes('/')) {
      reply.status(400)
      return { error: 'invalid filename' }
    }
    if (extname(filename) !== '.mp3') {
      reply.status(400)
      return { error: 'invalid file' }
    }

    const archiveDir = deps.archiver.getArchiveDir()
    const filepath = join(archiveDir, filename)

    try {
      const stats = await stat(filepath)
      const range = request.headers.range
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d+)?/)
        if (match) {
          const start = Number(match[1])
          const end = match[2] ? Number(match[2]) : stats.size - 1
          reply.status(206)
          reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`)
          reply.header('Content-Length', String(end - start + 1))
          reply.header('Content-Type', 'audio/mpeg')
          const buf = await readFile(filepath)
          return buf.subarray(start, end + 1)
        }
      }
      reply.header('Content-Length', String(stats.size))
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Accept-Ranges', 'bytes')
      return await readFile(filepath)
    } catch {
      reply.status(404)
      return { error: 'not found' }
    }
  })

  app.post('/api/archive/cleanup', async () => {
    await deps.archiver.cleanup()
    return { ok: true }
  })
}
