import type { PluginContext, RouteOptions, FastifyReply } from '@radio-services/shared'
import type { PlaylistService } from '../services/playlist-service.js'
import type { UploadedFilesRepo } from '../repos/uploaded-files.repo.js'
import type { UploadService } from '../services/upload-service.js'
import { spawn } from 'child_process'

function parsePositiveId(id: string): number {
  if (!/^[1-9][0-9]*$/.test(id)) {
    throw new Error(`invalid id: ${id}`)
  }
  return Number(id)
}

async function getAudioDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    let output = ''
    proc.stdout.on('data', (c: Buffer) => (output += c.toString()))
    proc.on('close', (code) => {
      if (code === 0) {
        const parsed = parseFloat(output.trim())
        resolve(isNaN(parsed) ? null : parsed)
      } else {
        resolve(null)
      }
    })
    proc.on('error', () => resolve(null))
    setTimeout(() => { try { proc.kill() } catch {}; resolve(null) }, 5000)
  })
}

export function registerPlaylistRoutes(
  ctx: PluginContext,
  deps: {
    playlistService: PlaylistService
    fileRepo: UploadedFilesRepo
    uploadService: UploadService
  }
): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/api/playlist',
      handler: async () => {
        return { items: deps.playlistService.list() }
      }
    },
    {
      method: 'POST',
      url: '/api/playlist',
      handler: async (body: unknown) => {
        const { filename, displayName, durationSec } = body as {
          filename?: string
          displayName?: string
          durationSec?: number
        }
        if (!filename || !displayName) {
          throw new Error('filename and displayName required')
        }
        const id = deps.playlistService.add({
          filename,
          display_name: displayName,
          duration_sec: durationSec ?? null,
        })
        return { id }
      }
    },
    {
      method: 'PUT',
      url: '/api/playlist/:id',
      handler: async (params: unknown, body: unknown) => {
        const { id } = params as { id: string }
        const { displayName } = body as { displayName?: string }
        if (displayName) {
          deps.playlistService.updateDisplay(parsePositiveId(id), displayName)
        }
        return { ok: true }
      }
    },
    {
      method: 'DELETE',
      url: '/api/playlist/:id',
      handler: async (params: unknown) => {
        const { id } = params as { id: string }
        deps.playlistService.remove(parsePositiveId(id))
        return { ok: true }
      }
    },
    {
      method: 'POST',
      url: '/api/playlist/reorder',
      handler: async (body: unknown) => {
        const { ids } = body as { ids: number[] }
        if (!Array.isArray(ids)) throw new Error('ids array required')
        if (!ids.every((id: unknown) => typeof id === 'number')) throw new Error('ids must be numbers')
        deps.playlistService.reorder(ids)
        return { ok: true }
      }
    },
    {
      method: 'GET',
      url: '/api/source/files',
      handler: async () => {
        return { files: deps.fileRepo.list() }
      }
    },
    {
      method: 'DELETE',
      url: '/api/source/files/:id',
      handler: async (params: unknown) => {
        const { id } = params as { id: string }
        const numId = parsePositiveId(id)
        const file = deps.fileRepo.getById(numId)
        if (!file) {
          throw new Error('not found')
        }
        deps.fileRepo.delete(numId)
        return { ok: true }
      }
    },
    {
      method: 'POST',
      url: '/api/source/upload',
      handler: async (request: unknown, reply: FastifyReply) => {
        const req = request as {
          file?: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer>; mimetype?: string } | null>
        }
        const file = await req.file?.()
        if (!file) {
          return reply.status(400).send({ error: 'no file provided' })
        }
        const buffer = await file.toBuffer()
        const originalName = file.filename ?? 'unknown'
        const result = await deps.uploadService.save({
          buffer,
          originalName,
          getDuration: getAudioDuration,
        })
        return {
          filename: result.filename,
          originalName: result.originalName,
          sizeBytes: result.sizeBytes,
        }
      }
    }
  ]

  routes.forEach(route => ctx.registerRoute(route))
}
