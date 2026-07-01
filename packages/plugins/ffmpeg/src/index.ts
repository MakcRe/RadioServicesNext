import type { Plugin, PluginContext } from '@radio-services/shared';
import { FFmpegService } from './services/ffmpeg-service.js';
import { registerFFmpegRoutes } from './routes/ffmpeg.js';

export default function createFFmpegPlugin(): Plugin {
  let ffmpegService: FFmpegService;
  let context: PluginContext;

  return {
    name: 'ffmpeg',
    version: '0.1.0',

    init(ctx: PluginContext) {
      context = ctx;
      ffmpegService = new FFmpegService(ctx);
      registerFFmpegRoutes(ctx, ffmpegService);
    },

    async start() {
      context.logger.info('FFmpeg plugin started');
    },

    async stop() {
      context.logger.info('FFmpeg plugin stopped');
    },

    async healthCheck() {
      return { healthy: true };
    }
  };
}
