import type { PluginContext, RouteOptions } from '@radio-services/shared'
import type { Archiver } from '../services/archiver.js'
import { join, extname } from 'path'
import { stat, readFile } from 'fs/promises'

export function registerArchiveRoutes(
  ctx: PluginContext,
  deps: {
    archiver: Archiver
  }
): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/api/archive/list',
      handler: async () => {
        return { files: await deps.archiver.list() }
      }
    },
    {
      method: 'GET',
      url: '/api/archive/:filename',
      handler: async (params: unknown) => {
        const { filename } = params as { filename: string }
        if (filename.includes('..') || filename.includes('/')) {
          throw new Error('invalid filename')
        }
        if (extname(filename) !== '.mp3') {
          throw new Error('invalid file')
        }
        const archiveDir = deps.archiver.getArchiveDir()
        const filepath = join(archiveDir, filename)
        try {
          const stats = await stat(filepath)
          const buf = await readFile(filepath)
          return {
            data: buf,
            headers: {
              'Content-Length': String(stats.size),
              'Content-Type': 'audio/mpeg',
              'Accept-Ranges': 'bytes',
            }
          }
        } catch {
          throw new Error('not found')
        }
      }
    },
    {
      method: 'POST',
      url: '/api/archive/cleanup',
      handler: async () => {
        await deps.archiver.cleanup()
        return { ok: true }
      }
    }
  ]

  routes.forEach(route => ctx.registerRoute(route))
}
