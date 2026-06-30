import type { FastifyInstance } from 'fastify'
import type { PlaylistService } from '../services/playlist-service.js'
import type { UploadedFilesRepo } from '../db/repos/uploaded-files.repo.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

/**
 * Parse a route param string into a finite positive integer, throwing a
 * 400-friendly Error if it is malformed. Replaces bare `Number(id)` which
 * silently produces NaN for inputs like 'abc' or ''.
 */
function parsePositiveId(id: string): number {
  if (!/^[1-9][0-9]*$/.test(id)) {
    throw new Error(`invalid id: ${id}`)
  }
  return Number(id)
}

export function registerPlaylistRoutes(app: AnyFastifyInstance, deps: {
  playlistService: PlaylistService
  fileRepo: UploadedFilesRepo
}): void {
  app.get('/api/playlist', async () => {
    return { items: deps.playlistService.list() }
  })

  app.post('/api/playlist', async (request) => {
    const body = request.body as { filename?: string; displayName?: string; durationSec?: number }
    if (!body.filename || !body.displayName) {
      throw new Error('filename and displayName required')
    }
    const id = deps.playlistService.add({
      filename: body.filename,
      display_name: body.displayName,
      duration_sec: body.durationSec ?? null,
    })
    return { id }
  })

  app.put('/api/playlist/:id', async (request) => {
    const { id } = request.params as { id: string }
    const numId = parsePositiveId(id)
    const body = request.body as { displayName?: string }
    if (body.displayName) {
      deps.playlistService.updateDisplay(numId, body.displayName)
    }
    return { ok: true }
  })

  app.delete('/api/playlist/:id', async (request) => {
    const { id } = request.params as { id: string }
    deps.playlistService.remove(parsePositiveId(id))
    return { ok: true }
  })

  app.post('/api/playlist/reorder', async (request) => {
    const body = request.body as { ids: number[] }
    if (!Array.isArray(body.ids)) throw new Error('ids array required')
    if (!body.ids.every((id: unknown) => typeof id === 'number')) throw new Error('ids must be numbers')
    deps.playlistService.reorder(body.ids)
    return { ok: true }
  })

  app.get('/api/source/files', async () => {
    return { files: deps.fileRepo.list() }
  })

  app.delete('/api/source/files/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const numId = parsePositiveId(id)
    const file = deps.fileRepo.getById(numId)
    if (!file) {
      reply.status(404)
      return { error: 'not found' }
    }
    deps.fileRepo.delete(numId)
    return { ok: true }
  })
}
