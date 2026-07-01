import type { Plugin, PluginContext } from '@radio-services/shared';
import { ArchiveService } from './services/archive-service.js';
import { registerArchiveRoutes } from './routes/archive.js';

export default function createArchivePlugin(): Plugin {
  let archiveService: ArchiveService;
  let context: PluginContext;

  return {
    name: 'archive',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx;
      archiveService = new ArchiveService(ctx);
      registerArchiveRoutes(ctx, archiveService);
    },

    async start() {
      context.logger.info('Archive plugin started');
    },

    async stop() {
      context.logger.info('Archive plugin stopped');
    },

    async healthCheck() {
      return { healthy: true };
    }
  };
}
