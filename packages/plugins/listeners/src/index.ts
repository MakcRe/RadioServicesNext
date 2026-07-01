import type { Plugin, PluginContext } from '@radio-services/shared';
import { ListenersService } from './services/listeners-service.js';
import { registerListenersRoutes } from './routes/listeners.js';

export default function createListenersPlugin(): Plugin {
  let listenersService: ListenersService;
  let context: PluginContext;

  return {
    name: 'listeners',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx;
      listenersService = new ListenersService(ctx);
      registerListenersRoutes(ctx, listenersService);
    },

    async start() {
      context.logger.info('Listeners plugin started');
    },

    async stop() {
      context.logger.info('Listeners plugin stopped');
    },

    async healthCheck() {
      return { healthy: true };
    }
  };
}
