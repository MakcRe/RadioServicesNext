import type { Plugin, PluginContext } from '@radio-services/shared';
import { PlaylistService } from './services/playlist-service.js';
import { registerPlaylistRoutes } from './routes/playlist.js';

export default function createPlaylistPlugin(): Plugin {
  let playlistService: PlaylistService;
  let context: PluginContext;

  return {
    name: 'playlist',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx;
      playlistService = new PlaylistService(ctx);
      registerPlaylistRoutes(ctx, playlistService);
    },

    async start() {
      context.logger.info('Playlist plugin started');
    },

    async stop() {
      context.logger.info('Playlist plugin stopped');
    },

    async healthCheck() {
      return { healthy: true };
    }
  };
}
