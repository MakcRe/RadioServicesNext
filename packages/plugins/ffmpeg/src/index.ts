import type { Plugin, PluginContext } from '@radio-services/shared'
import { FFmpegManager, normalizeVersion } from './services/ffmpeg-manager.js'
import type { FfmpegRuntimeState } from './services/ffmpeg-state.js'
import type { WsHub } from '@radio-services/core'
import { registerFfmpegRoutes } from './routes/ffmpeg.js'
import {
  downloadFfmpeg,
  buildDownloadUrl,
  resolveLatestFfmpegVersion,
  listLatestRemoteVersions,
  verifySha256,
  type DownloadState,
  type ProgressCallback,
} from './services/ffmpeg-downloader.js'

export { FFmpegManager, buildDownloadUrl, downloadFfmpeg, resolveLatestFfmpegVersion, listLatestRemoteVersions, verifySha256, normalizeVersion }
export type { DownloadState, ProgressCallback }

export default function createFFmpegPlugin(): Plugin {
  let ffmpegManager: FFmpegManager
  let runtimeState: FfmpegRuntimeState
  let context: PluginContext

  return {
    name: 'ffmpeg',
    version: '0.1.0',

    async init(ctx: PluginContext) {
      context = ctx

      const binRoot = ctx.config.ffmpeg.binRoot ?? 'bin/ffmpeg'
      const ffmpegPathOverride = ctx.config.ffmpeg.ffmpegPathOverride

      const { createFfmpegRuntimeState, defaultStatePath } = await import('./services/ffmpeg-state.js')
      runtimeState = createFfmpegRuntimeState(defaultStatePath(binRoot))

      ffmpegManager = new FFmpegManager({
        binRoot,
        version: ctx.config.ffmpeg.version,
        downloadUrl: ctx.config.ffmpeg.sourceUrl,
        ffmpegPathOverride,
        logger: ctx.logger as unknown as import('pino').Logger,
        runtimeState,
      })

      const wsHub = ctx.getService<WsHub>('wsHub')
      if (!wsHub) {
        throw new Error('WsHub service not available')
      }

      await ffmpegManager.initialize()

      // Get sourceReceiver from context (registered by app.ts before plugins load)
      const sourceReceiver = ctx.getService<{
        attachInternalStream: (stream: import('stream').Readable, metadata?: { name?: string }) => void
        getActiveSession: () => { id: string } | null
      }>('sourceReceiver')

      registerFfmpegRoutes(ctx, {
        ffmpegManager,
        wsHub,
        runtimeState,
        binRoot,
        sourceReceiver: sourceReceiver ?? undefined,
      })

      ctx.registerService('ffmpegManager', ffmpegManager)
      ctx.registerService('runtimeState', runtimeState)
    },

    async start() {
      context.logger.info('FFmpeg plugin started')
    },

    async stop() {
      if (runtimeState) {
        await runtimeState.close()
      }
      context.logger.info('FFmpeg plugin stopped')
    },

    async healthCheck() {
      return { healthy: true, ffmpegAvailable: ffmpegManager.getStatus().available }
    }
  }
}
