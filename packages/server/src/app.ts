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

const __dirname = dirname(fileURLToPath(import.meta.url));

type AnyFastifyInstance = ReturnType<typeof Fastify>;

export interface BuildAppDeps {
  config?: RadioConfig;
}

export async function createApp(deps: BuildAppDeps = {}): Promise<AnyFastifyInstance> {
  const config = deps.config ?? {
    server: { host: '0.0.0.0', port: 8000 },
    auth: { sourcePassword: 'hackme' },
    ffmpeg: { version: '7.1', sourceUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest' },
    archive: { directory: 'bin/archive', segmentDurationSec: 3600, retentionDays: 7, minFreeSpaceMB: 500 },
    playlist: { uploadDir: 'bin/uploads', maxFileSizeMB: 500, allowedExtensions: ['.mp3'] },
    logging: { directory: 'logs', level: 'info', retentionDays: 30 },
    stream: { pollIntervalMs: 5000, pollIntervalMaxMs: 30000 },
  };

  const logger = createLogger(config.logging);
  
  const fastify = Fastify({
    logger,
  });

  await fastify.register(multipart);
  await fastify.register(websocket);

  const registry = new PluginRegistry();
  const loader = new PluginLoader(registry);

  const pluginContext = new PluginContextImpl(logger as any, config);

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
      handler: route.handler as any,
    });
  }

  const wsHandlers = pluginContext.getRegisteredWsHandlers();
  for (const [path, handler] of wsHandlers) {
    fastify.get(path, { websocket: true }, (socket, request) => {
      handler(socket as any, request);
    });
  }

  fastify.get('/health', async () => ({ ok: true }));

  return fastify;
}
