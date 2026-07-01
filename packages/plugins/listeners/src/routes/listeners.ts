import type { PluginContext, RouteOptions } from '@radio-services/shared';
import type { ListenersService } from '../services/listeners-service.js';

export function registerListenersRoutes(ctx: PluginContext, service: ListenersService): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/listeners/stats',
      handler: async () => {
        return service.getListenerStats();
      }
    },
    {
      method: 'GET',
      url: '/listeners/history',
      handler: async (...args: unknown[]) => {
        const options = args[0] as { limit?: number; since?: string } | undefined;
        const since = options?.since ? new Date(options.since) : undefined;
        return service.getListenerHistory({ ...options, since });
      }
    },
    {
      method: 'GET',
      url: '/listeners/:sessionId',
      handler: async (...args: unknown[]) => {
        const sessionId = args[0] as string;
        return service.getListenerInfo(sessionId);
      }
    },
    {
      method: 'POST',
      url: '/listeners/:sessionId/track',
      handler: async (...args: unknown[]) => {
        const sessionId = args[0] as string;
        const data = args[1] as Record<string, unknown>;
        return service.trackListener(sessionId, data);
      }
    },
    {
      method: 'DELETE',
      url: '/listeners/:sessionId',
      handler: async (...args: unknown[]) => {
        const sessionId = args[0] as string;
        return service.disconnectListener(sessionId);
      }
    }
  ];

  routes.forEach(route => ctx.registerRoute(route));
}
