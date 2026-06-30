import Fastify, { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { PassThrough } from 'stream'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { isAbsolute, resolve as resolvePath } from 'path'
import { loadConfig, type AppConfig, warnIfDefaultPassword } from './config.js'
import { createLogger } from './logger.js'
import { initDb } from './db/sqlite.js'
import { PlaylistRepo } from './db/repos/playlist.repo.js'
import { UploadedFilesRepo } from './db/repos/uploaded-files.repo.js'
import { ListenerLogsRepo } from './db/repos/listener-logs.repo.js'
import { FFmpegManager } from './services/ffmpeg-manager.js'
import { createFfmpegRuntimeState, defaultStatePath } from './services/ffmpeg-state.js'
import { SourceReceiver } from './services/source-receiver.js'
import { Broadcaster } from './services/broadcaster.js'
import { Archiver } from './services/archiver.js'
import { ListenerManager } from './services/listener-manager.js'
import { PlaylistService } from './services/playlist-service.js'
import { UploadService } from './services/upload-service.js'
import { WsHub } from './services/ws-hub.js'

import { registerStreamRoutes } from './routes/stream.js'
import { registerSourceRoutes } from './routes/source.js'
import { registerArchiveRoutes } from './routes/archive.js'
import { registerPlaylistRoutes } from './routes/playlist.js'
import { registerListenersRoutes } from './routes/listeners.js'
import { registerFfmpegRoutes } from './routes/ffmpeg.js'
import { registerConfigRoutes } from './routes/config.js'
import { registerWsRoute } from './routes/ws.js'

export interface BuildAppDeps {
  ffmpegPathOverride?: string
  binRoot?: string
}

export async function buildApp(
  configPath = 'config/config.yaml',
  deps: BuildAppDeps = {},
): Promise<{ app: FastifyInstance; config: AppConfig }> {
  const config = loadConfig(configPath)
  const logger = createLogger(config.logging)
  warnIfDefaultPassword(config, logger)
  await mkdir('data', { recursive: true })
  await mkdir(config.playlist.uploadDir, { recursive: true })
  await mkdir(config.archive.directory, { recursive: true })
  const db = await initDb(config.db.path)

  // Runtime state store: holds the user-selected ffmpeg version (and
  // potentially other runtime-only choices). Persisted as a JSON file
  // under bin/ffmpeg/ — completely separate from config.yaml.
  const binRootAbs = isAbsolute(deps.binRoot ?? 'bin/ffmpeg')
    ? (deps.binRoot ?? 'bin/ffmpeg')
    : resolvePath(process.cwd(), deps.binRoot ?? 'bin/ffmpeg')
  const runtimeState = createFfmpegRuntimeState(defaultStatePath(binRootAbs))

  const ffmpegManager = new FFmpegManager({
    binRoot: deps.binRoot ?? 'bin/ffmpeg',
    version: config.ffmpeg.version,
    downloadUrl: config.ffmpeg.sourceUrl,
    ffmpegPathOverride: deps.ffmpegPathOverride,
    logger,
    runtimeState,
  })
  await ffmpegManager.initialize()

  const broadcaster = new Broadcaster({ ringCapacity: 128 * 1024 })
  const sourceReceiver = new SourceReceiver({
    sourcePassword: config.auth.sourcePassword,
    onData: undefined,
  })
  const archiver = new Archiver({
    // Resolver — read fresh on every start so live-switching via the
    // admin UI takes effect on the next recording session. The cached
    // value in ffmpegManager.status is updated by setVersion() so this
    // picker stays in sync without further plumbing.
    getFfmpegPath: () => ffmpegManager.getStatus().path,
    archiveDir: config.archive.directory,
    segmentDurationSec: config.archive.segmentDurationSec,
    retentionDays: config.archive.retentionDays,
    logger,
  })
  const listenerManager = new ListenerManager(new ListenerLogsRepo(db))
  const playlistRepo = new PlaylistRepo(db)
  const uploadedFilesRepo = new UploadedFilesRepo(db)
  const playlistService = new PlaylistService(playlistRepo, uploadedFilesRepo)
  const uploadService = new UploadService({
    uploadDir: config.playlist.uploadDir,
    maxFileSizeMB: config.playlist.maxFileSizeMB,
    allowedExtensions: config.playlist.allowedExtensions,
    fileRepo: uploadedFilesRepo,
  })
  const wsHub = new WsHub()

  let sourceStream: PassThrough | null = null
  const pushProcs: import('child_process').ChildProcess[] = []

  sourceReceiver.on('session-start', (session) => {
    // Close the previous local PassThrough (if any) before opening a new one.
    // The broadcaster keeps existing listeners alive across session switches
    // (it only un-subscribes from the old source stream).
    if (sourceStream && !sourceStream.destroyed) {
      sourceStream.end()
    }
    sourceStream = new PassThrough()
    // Start archiver only on the very first source. Subsequent switches
    // re-use the same archiver instance so listeners don't observe a cut.
    if (!archiver.isRunning()) {
      archiver.start(sourceStream).catch((err) =>
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'archiver start failed'),
      )
    }
    broadcaster.pipeFrom(sourceStream, session)
    wsHub.emitEvent('source-start', session)
  })

  sourceReceiver.on('data', (chunk: Buffer) => {
    if (sourceStream && !sourceStream.destroyed) {
      sourceStream.write(chunk)
    }
  })

  sourceReceiver.on('session-end', (session) => {
    // End the local PassThrough. The broadcaster's pipeFrom handler will
    // automatically unbind from this (now-ending) source — listeners survive.
    if (sourceStream && !sourceStream.destroyed) {
      sourceStream.end()
    }
    sourceStream = null
    // Archiver is intentionally NOT stopped here — it persists across session
    // switches. The next session-start reuses the same archiver.
    wsHub.emitEvent('source-end', { sessionId: session.id })
  })

  const app = Fastify({ logger, bodyLimit: 50 * 1024 * 1024 }) as FastifyInstance<any, any, any, any, any>

  await app.register(websocket)
  await app.register(multipart, {
    limits: { fileSize: config.playlist.maxFileSizeMB * 1024 * 1024 },
  })
  await app.register(staticFiles, {
    root: join(process.cwd(), 'public'),
    prefix: '/',
    decorateReply: false,
  })

  await sourceReceiver.register(app)

  registerStreamRoutes(app, { broadcaster, listenerManager })
  registerSourceRoutes(app, { sourceReceiver, wsHub })
  registerArchiveRoutes(app, { archiver })
  registerPlaylistRoutes(app, { playlistService, fileRepo: uploadedFilesRepo })
  registerListenersRoutes(app, { listenerManager })
  registerFfmpegRoutes(app, { ffmpegManager, wsHub, logger, config, runtimeState, binRoot: binRootAbs })
  registerConfigRoutes(app, { config, wsHub })
  registerWsRoute(app, { wsHub })

  app.get('/api/status', async () => ({
    ffmpeg: ffmpegManager.getStatus(),
    broadcaster: { isLive: broadcaster.isLive() },
    listeners: { count: listenerManager.countCurrent() },
  }))

  /** Stop and remove every push ffmpeg subprocess. Used by start/stop paths. */
  async function stopAllPushProcs(): Promise<{ killed: number }> {
    const snapshot = [...pushProcs]
    let killed = 0
    for (const proc of snapshot) {
      try {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGTERM')
          killed += 1
        }
      } catch {
        // process already gone
      }
    }
    // wait 500ms then SIGKILL survivors
    await new Promise((r) => setTimeout(r, 500))
    for (const proc of snapshot) {
      try {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGKILL')
        }
      } catch {}
    }
    return { killed }
  }

  app.post('/api/source/start', async (request) => {
    const body = request.body as { type: 'file' | 'playlist'; id: number | string }
    if (!body.type || body.id === undefined || body.id === null) {
      throw new Error('type and id required')
    }
    const rawId = String(body.id)
    if (!/^[1-9][0-9]*$/.test(rawId)) {
      throw new Error(`invalid id: ${rawId}`)
    }
    const numId = Number(rawId)
    let inputPath: string | null = null
    let displayName: string | null = null

    if (body.type === 'file') {
      const file = uploadedFilesRepo.getById(numId)
      if (!file) throw new Error('file not found')
      inputPath = join(config.playlist.uploadDir, file.filename)
      displayName = file.original_name
    } else if (body.type === 'playlist') {
      const song = playlistService.list().find((s) => s.id === numId)
      if (!song) throw new Error('song not found')
      const file = uploadedFilesRepo.list().find((f) => f.filename === song.filename)
      if (!file) throw new Error('uploaded file not found')
      inputPath = join(config.playlist.uploadDir, file.filename)
      displayName = song.display_name
    } else {
      throw new Error('invalid type')
    }

    if (!inputPath) throw new Error('no input')

    // Stop any existing push ffmpeg before starting a new one so listeners
    // don't hear two streams mixed together. The old ffmpeg's session-end
    // flows through the broadcaster's unbindSource path — listeners survive.
    await stopAllPushProcs()

    const ffmpegStatus = ffmpegManager.getStatus()
    if (!ffmpegStatus.available || !ffmpegStatus.path) {
      throw new Error('ffmpeg not available')
    }
    const { spawn } = await import('child_process')
    const proc = spawn(ffmpegStatus.path, [
      '-re',
      '-i', inputPath,
      '-map', '0:a:0',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-f', 'mp3',
      '-content_type', 'audio/mpeg',
      'pipe:1',
    ])
    proc.stderr?.on('data', (c) => logger.debug({ msg: c.toString() }, 'ffmpeg push'))

    sourceReceiver.attachInternalStream(proc.stdout, { name: displayName ?? undefined })

    proc.on('exit', (code, signal) => {
      sourceReceiver.detachInternalStream()
      const idx = pushProcs.indexOf(proc)
      if (idx >= 0) pushProcs.splice(idx, 1)
      logger.info({ code, signal }, 'source push exited')
    })
    pushProcs.push(proc)

    return { ok: true, displayName, pid: proc.pid }
  })

  app.post('/api/source/stop', async () => {
    const { killed } = await stopAllPushProcs()
    // Closing all listeners triggers the client-side audio 'error' event,
    // which kicks the landing-page reconnect / poll loop.
    broadcaster.endAll()
    // Archiver persists across sessions; only stop it on explicit shutdown.
    return { ok: true, killed }
  })

  app.post('/api/source/upload', async (request, reply) => {
    if (!request.isMultipart()) {
      reply.status(400)
      return { error: 'expected multipart/form-data' }
    }
    const data = await request.file()
    if (!data) {
      reply.status(400)
      return { error: 'no file' }
    }
    const buffer = await data.toBuffer()
    const originalName = data.filename ?? 'upload.mp3'
    const ffmpegStatus = ffmpegManager.getStatus()
    const getDuration = async (fp: string): Promise<number | null> => {
      if (!ffmpegStatus.available || !ffmpegStatus.path) return null
      const { spawn } = await import('child_process')
      return new Promise((resolve) => {
        const proc = spawn(ffmpegStatus.path!, ['-i', fp])
        let errOutput = ''
        proc.stderr.on('data', (c) => (errOutput += c.toString()))
        proc.on('close', () => {
          const m = errOutput.match(/Duration: (\d+):(\d+):(\d+\.\d+)/)
          if (m) {
            resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
          } else {
            resolve(null)
          }
        })
        proc.on('error', () => resolve(null))
      })
    }
      const result = await uploadService.save({ buffer, originalName, getDuration })
    return result
  })

  // Health check kept for backwards compat
  app.get('/health', async () => ({ ok: true }))

  return { app, config }
}

export async function legacyBuildApp(): Promise<FastifyInstance> {
  const { app } = await buildApp()
  return app
}
