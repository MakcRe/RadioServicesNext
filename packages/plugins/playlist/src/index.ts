import type Database from 'better-sqlite3'
import type { Plugin, PluginContext } from '@radio-services/shared'
import { PlaylistService } from './services/playlist-service.js'
import { UploadService } from './services/upload-service.js'
import { PlaylistRepo } from './repos/playlist.repo.js'
import { UploadedFilesRepo } from './repos/uploaded-files.repo.js'
import { registerPlaylistRoutes } from './routes/playlist.js'

export { PlaylistService, UploadService }

export default function createPlaylistPlugin(): Plugin {
  let playlistService: PlaylistService
  let uploadService: UploadService
  let context: PluginContext

  return {
    name: 'playlist',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx
      const db = ctx.getService<Database.Database>('db')
      if (!db) {
        throw new Error('Database service not available')
      }

      const playlistRepo = new PlaylistRepo(db)
      const uploadedFilesRepo = new UploadedFilesRepo(db)

      playlistService = new PlaylistService(playlistRepo, uploadedFilesRepo)
      uploadService = new UploadService({
        uploadDir: ctx.config.playlist.uploadDir,
        maxFileSizeMB: ctx.config.playlist.maxFileSizeMB,
        allowedExtensions: ctx.config.playlist.allowedExtensions,
        fileRepo: uploadedFilesRepo,
      })

      registerPlaylistRoutes(ctx, {
        playlistService,
        fileRepo: uploadedFilesRepo,
        uploadService,
      })

      ctx.registerService('uploadService', uploadService)
      ctx.registerService('playlistService', playlistService)
    },

    async start() {
      context.logger.info('Playlist plugin started')
    },

    async stop() {
      context.logger.info('Playlist plugin stopped')
    },

    async healthCheck() {
      return { healthy: true }
    }
  }
}
