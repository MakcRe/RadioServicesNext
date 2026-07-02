import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { PassThrough } from 'stream';
import type { RadioConfig } from '@radio-services/shared';
import { createLogger } from './logger.js';
import { PluginLoader, PluginRegistry, PluginContextImpl, WsHub, initDb, Broadcaster, ListenerManager, SourceReceiver } from '@radio-services/core';
import { registerStreamRoutes } from './routes/stream.js';

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

  // Serve static files from <repo-root>/public/ (BACKLOG P0-1 + P2-11).
  // Must be registered before any catch-all route; @fastify/static only
  // responds when a matching file exists, otherwise it calls next() and
  // other handlers (API routes, 404) take over.
  //
  // The path is resolved relative to this source file rather than process.cwd()
  // because `pnpm --filter @radio-services/server dev` runs server with cwd =
  // packages/server, not the monorepo root. Layout:
  //   <repo-root>/packages/server/src/app.ts   (this file)
  //   <repo-root>/public/                      (3 levels up)
  const publicDir = resolvePath(__dirname, '..', '..', '..', 'public');
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    index: ['index.html'],
  });

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

  // Create core streaming services and register them immediately so plugins can access them
  const broadcaster = new Broadcaster({ ringCapacity: 1024 });
  pluginContext.registerService('broadcaster', broadcaster);

  const sourceReceiver = new SourceReceiver({
    sourcePassword: config.auth.sourcePassword,
  });
  pluginContext.registerService('sourceReceiver', sourceReceiver);

  const pluginDirs = [
    join(__dirname, '../../plugins'),
  ];

  const loadedPlugins = await loader.discoverAndLoad(pluginDirs);

  for (const plugin of loadedPlugins) {
    await plugin.init(pluginContext);
  }

  // Now plugins have registered their services; retrieve listenerManager if available
  const listenerManager = pluginContext.getService<ListenerManager>('listenerManager');
  if (listenerManager) {
    registerStreamRoutes(fastify, { broadcaster, listenerManager });
  } else {
    // Fallback: register stream route without listener tracking
    registerStreamRoutes(fastify, {
      broadcaster,
      listenerManager: {
        connect: () => 0,
        disconnect: () => {},
        countCurrent: () => 0,
        current: () => [],
        history: () => ({ rows: [], total: 0 }),
      } as unknown as ListenerManager,
    });
  }

  // Register source PUT/POST endpoint
  await sourceReceiver.register(fastify);

  // Wire SourceReceiver → Broadcaster so incoming audio flows to listeners
  let activePassthrough: PassThrough | null = null;
  sourceReceiver.on('session-start', () => {
    activePassthrough = new PassThrough();
    broadcaster.pipeFrom(activePassthrough, sourceReceiver.getActiveSession() ?? undefined);
  });
  sourceReceiver.on('data', (chunk: Buffer) => {
    if (activePassthrough) {
      activePassthrough.write(chunk);
    }
  });
  sourceReceiver.on('session-end', () => {
    if (activePassthrough) {
      activePassthrough.end();
      activePassthrough = null;
    }
  });

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

  // Register /api/status — aggregates broadcaster, ffmpeg, and listener info
  fastify.get('/api/status', async () => {
    const ffmpegManager = pluginContext.getService<{ getStatus(): { available: boolean; path: string | null; version: string | null } }>('ffmpegManager');
    return {
      ffmpeg: ffmpegManager?.getStatus() ?? { available: false, path: null, version: null },
      broadcaster: {
        isLive: broadcaster.isLive(),
        ringBufferSize: broadcaster.ringBufferSize(),
      },
      listeners: listenerManager ? {
        count: listenerManager.countCurrent(),
        listeners: listenerManager.current(),
      } : { count: 0, listeners: [] },
    };
  });

  fastify.get('/health', async () => ({ ok: true }));

  return { app: fastify };
}
