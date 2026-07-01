import type { PluginContext, RouteOptions } from '@radio-services/shared';
import type { FFmpegService } from '../services/ffmpeg-service.js';

export function registerFFmpegRoutes(ctx: PluginContext, service: FFmpegService): void {
  const routes: RouteOptions[] = [
    {
      method: 'POST',
      url: '/ffmpeg/transcode',
      handler: async (...args: unknown[]) => {
        const data = args[0] as { path: string; options?: Record<string, unknown> };
        return service.transcode(data);
      }
    },
    {
      method: 'GET',
      url: '/ffmpeg/jobs/:jobId',
      handler: async (...args: unknown[]) => {
        const jobId = args[0] as string;
        return service.getTranscodeStatus(jobId);
      }
    },
    {
      method: 'GET',
      url: '/ffmpeg/audio-info',
      handler: async (...args: unknown[]) => {
        const params = args[0] as { path: string };
        return service.getAudioInfo(params.path);
      }
    },
    {
      method: 'POST',
      url: '/ffmpeg/convert',
      handler: async (...args: unknown[]) => {
        const data = args[0] as { path: string; outputFormat: string };
        return service.convertFormat(data);
      }
    },
    {
      method: 'POST',
      url: '/ffmpeg/extract-cover',
      handler: async (...args: unknown[]) => {
        const data = args[0] as { path: string; outputPath?: string };
        return service.extractCoverArt(data);
      }
    },
    {
      method: 'POST',
      url: '/ffmpeg/normalize',
      handler: async (...args: unknown[]) => {
        const data = args[0] as { path: string; targetLevel?: number };
        return service.normalizeAudio(data);
      }
    },
    {
      method: 'GET',
      url: '/ffmpeg/formats',
      handler: async () => {
        return service.getAvailableFormats();
      }
    }
  ];

  routes.forEach(route => ctx.registerRoute(route));
}
