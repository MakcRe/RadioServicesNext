import type { Plugin, PluginContext } from '@radio-services/shared'
import { Archiver } from './services/archiver.js'
import { registerArchiveRoutes } from './routes/archive.js'

export { Archiver }

export default function createArchivePlugin(): Plugin {
  let archiver: Archiver
  let context: PluginContext

  return {
    name: 'archive',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx

      archiver = new Archiver({
        getFfmpegPath: () => {
          const ffmpegManager = ctx.getService<{ getStatus(): { path: string | null } }>('ffmpegManager')
          return ffmpegManager?.getStatus().path ?? null
        },
        archiveDir: ctx.config.archive.directory,
        segmentDurationSec: ctx.config.archive.segmentDurationSec,
        retentionDays: ctx.config.archive.retentionDays,
        logger: ctx.logger as unknown as import('pino').Logger,
      })

      registerArchiveRoutes(ctx, { archiver })

      ctx.registerService('archiver', archiver)
    },

    async start() {
      context.logger.info('Archive plugin started')
    },

    async stop() {
      await archiver.stop()
      context.logger.info('Archive plugin stopped')
    },

    async healthCheck() {
      return { healthy: true, running: archiver.isRunning() }
    }
  }
}
