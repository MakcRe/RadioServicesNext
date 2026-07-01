import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { RadioConfig } from '@radio-services/shared';
import { createLogger } from './logger.js';
import { PluginLoader } from '@radio-services/core';
import { PluginRegistry } from '@radio-services/core';
import { PluginContextImpl } from '@radio-services/core';
import { WsHub } from '@radio-services/core';
import { initDb } from '@radio-services/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

type AnyFastifyInstance = ReturnType<typeof Fastify>;

export interface CreateAppDeps {
  config?: RadioConfig;
  configPath?: string;
  ffmpegPathOverride?: string;
  ffmpegBin?: string;
  binRoot?: string; // Alias for ffmpegBin (for backwards compatibility)
}

export async function createApp(deps: CreateAppDeps = {}): Promise<{ app: AnyFastifyInstance }> {
  let config: RadioConfig;
  
  if (deps.config) {
    config = deps.config;
  } else if (deps.configPath) {
    const { loadConfig } = await import('@radio-services/shared');
    config = loadConfig(deps.configPath);
    // Ensure ffmpeg.binRoot is set with default if not in config
    if (!config.ffmpeg.binRoot) {
      config.ffmpeg.binRoot = 'bin/ffmpeg';
    }
  } else {
    config = {
      server: { host: '0.0.0.0', port: 8000 },
      auth: { sourcePassword: 'hackme' },
      ffmpeg: { version: '7.1', sourceUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest', binRoot: 'bin/ffmpeg' },
      archive: { directory: 'bin/archive', segmentDurationSec: 3600, retentionDays: 7, minFreeSpaceMB: 500 },
      playlist: { uploadDir: 'bin/uploads', maxFileSizeMB: 500, allowedExtensions: ['.mp3'] },
      logging: { directory: 'logs', level: 'info', retentionDays: 30 },
      stream: { pollIntervalMs: 5000, pollIntervalMaxMs: 30000 },
      db: { path: 'data/app.db' },
    };
  }

  // Apply ffmpegBin override if provided (ffmpegBin takes precedence over binRoot)
  const resolvedBinRoot = deps.ffmpegBin ?? deps.binRoot;
  if (resolvedBinRoot) {
    config.ffmpeg = { ...config.ffmpeg, binRoot: resolvedBinRoot };
  }

  // Apply ffmpegPathOverride if provided
  if (deps.ffmpegPathOverride) {
    config.ffmpeg = { ...config.ffmpeg, ffmpegPathOverride: deps.ffmpegPathOverride };
  }

  const logger = createLogger(config.logging);
  
  const fastify = Fastify({
    logger,
  });

  await fastify.register(multipart);
  await fastify.register(websocket);

  const registry = new PluginRegistry();
  const loader = new PluginLoader(registry);

  const pluginContext = new PluginContextImpl(logger as any, config);

  // Register core services in the context before loading plugins
  const wsHub = new WsHub();
  pluginContext.registerService('wsHub', wsHub);

  // Initialize database if db.path is configured
  if (config.db?.path) {
    const db = await initDb(config.db.path);
    pluginContext.registerService('db', db);
  }

  const pluginDirs = [
    join(__dirname, '../../plugins'),
  ];
  
  const loadedPlugins = await loader.discoverAndLoad(pluginDirs);

  for (const plugin of loadedPlugins) {
    await plugin.init(pluginContext);
  }

  const pluginRoutes = pluginContext.getRegisteredRoutes();
  for (const route of pluginRoutes) {
    fastify.route({
      method: route.method,
      url: route.url,
      schema: route.schema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (request: any, reply: any) => route.handler(request, reply),
    });
  }

  const wsHandlers = pluginContext.getRegisteredWsHandlers();
  for (const [path, handler] of wsHandlers) {
    fastify.get(path, { websocket: true }, (socket, request) => {
      handler(socket as any, request);
    });
  }

  fastify.get('/health', async () => ({ ok: true }));

  return { app: fastify };
}
