import type { PluginContext, RouteOptions } from '@radio-services/shared';
import type { ArchiveService } from '../services/archive-service.js';

export function registerArchiveRoutes(ctx: PluginContext, service: ArchiveService): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/archives',
      handler: async () => {
        return service.getAllArchives();
      }
    },
    {
      method: 'GET',
      url: '/archives/:id',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        return service.getArchive(id);
      }
    },
    {
      method: 'POST',
      url: '/archives',
      handler: async (...args: unknown[]) => {
        const data = args[0] as { name: string; description?: string };
        return service.createArchive(data);
      }
    },
    {
      method: 'PUT',
      url: '/archives/:id',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const data = args[1] as { name?: string; description?: string };
        return service.updateArchive(id, data);
      }
    },
    {
      method: 'DELETE',
      url: '/archives/:id',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        return service.deleteArchive(id);
      }
    },
    {
      method: 'GET',
      url: '/archives/:id/entries',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const options = args[1] as { limit?: number; offset?: number } | undefined;
        return service.getEntries(id, options);
      }
    },
    {
      method: 'POST',
      url: '/archives/:id/entries',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const data = args[1] as { trackId: string; metadata?: Record<string, unknown> };
        return service.addEntry(id, data);
      }
    },
    {
      method: 'DELETE',
      url: '/archives/:id/entries/:entryId',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const entryId = args[1] as string;
        return service.removeEntry(id, entryId);
      }
    }
  ];

  routes.forEach(route => ctx.registerRoute(route));
}
