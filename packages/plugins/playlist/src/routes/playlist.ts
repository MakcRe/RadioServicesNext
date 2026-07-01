import type { PluginContext } from '@radio-services/shared';
import type { RouteOptions } from '@radio-services/shared';
import type { PlaylistService } from '../services/playlist-service.js';

export function registerPlaylistRoutes(ctx: PluginContext, service: PlaylistService): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/playlists',
      handler: async () => {
        return service.getAllPlaylists();
      }
    },
    {
      method: 'GET',
      url: '/playlists/:id',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        return service.getPlaylist(id);
      }
    },
    {
      method: 'POST',
      url: '/playlists',
      handler: async (...args: unknown[]) => {
        const data = args[0] as { name: string };
        return service.createPlaylist(data);
      }
    },
    {
      method: 'PUT',
      url: '/playlists/:id',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const data = args[1] as { name: string };
        return service.updatePlaylist(id, data);
      }
    },
    {
      method: 'DELETE',
      url: '/playlists/:id',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        return service.deletePlaylist(id);
      }
    },
    {
      method: 'POST',
      url: '/playlists/:id/tracks',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const data = args[1] as { trackId: string; position?: number };
        return service.addTrack(id, data.trackId, data.position);
      }
    },
    {
      method: 'DELETE',
      url: '/playlists/:id/tracks/:trackId',
      handler: async (...args: unknown[]) => {
        const id = args[0] as string;
        const trackId = args[1] as string;
        return service.removeTrack(id, trackId);
      }
    }
  ];

  routes.forEach(route => ctx.registerRoute(route));
}
