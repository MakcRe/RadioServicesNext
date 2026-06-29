import Fastify, { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { PassThrough } from 'stream'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { loadConfig, type AppConfig, warnIfDefaultPassword } from './config.js'
import { createLogger } from './logger.js'
import { initDb } from './db/sqlite.js'
import { PlaylistRepo } from './db/repos/playlist.repo.js'
import { UploadedFilesRepo } from './db/repos/uploaded-files.repo.js'
import { ListenerLogsRepo } from './db/repos/listener-logs.repo.js'
import { FFmpegManager } from './services/ffmpeg-manager.js'
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

  const ffmpegManager = new FFmpegManager({
    binRoot: 'bin/ffmpeg',
    version: config.ffmpeg.version,
    downloadUrl: config.ffmpeg.sourceUrl,
    ffmpegPathOverride: deps.ffmpegPathOverride,
  })
  await ffmpegManager.initialize()

  const broadcaster = new Broadcaster({ ringCapacity: 128 * 1024 })
  const sourceReceiver = new SourceReceiver({
    sourcePassword: config.auth.sourcePassword,
    onData: undefined,
  })
  const archiver = new Archiver({
    ffmpegPath: ffmpegManager.getStatus().path ?? '/usr/bin/ffmpeg',
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
    sourceStream = new PassThrough()
    archiver.start(sourceStream).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'archiver start failed'),
    )
    broadcaster.pipeFrom(sourceStream, session)
    wsHub.emitEvent('source-start', session)
  })

  sourceReceiver.on('data', (chunk: Buffer) => {
    if (sourceStream && !sourceStream.destroyed) {
      sourceStream.write(chunk)
    }
  })

  sourceReceiver.on('session-end', (session) => {
    if (sourceStream && !sourceStream.destroyed) {
      sourceStream.end()
    }
    sourceStream = null
    archiver.stop().catch(() => {})
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
  registerFfmpegRoutes(app, { ffmpegManager, wsHub, logger })
  registerConfigRoutes(app, { config, wsHub })
  registerWsRoute(app, { wsHub })

  app.get('/api/status', async () => ({
    ffmpeg: ffmpegManager.getStatus(),
    broadcaster: { isLive: broadcaster.isLive() },
    listeners: { count: listenerManager.countCurrent() },
  }))

  app.post('/api/source/start', async (request) => {
    const body = request.body as { type: 'file' | 'playlist'; id: number | string }
    if (!body.type || body.id === undefined) {
      throw new Error('type and id required')
    }
    let inputPath: string | null = null
    let displayName: string | null = null

    if (body.type === 'file') {
      const file = uploadedFilesRepo.getById(Number(body.id))
      if (!file) throw new Error('file not found')
      inputPath = join(config.playlist.uploadDir, file.filename)
      displayName = file.original_name
    } else if (body.type === 'playlist') {
      const song = playlistService.list().find((s) => s.id === Number(body.id))
      if (!song) throw new Error('song not found')
      const file = uploadedFilesRepo.list().find((f) => f.filename === song.filename)
      if (!file) throw new Error('uploaded file not found')
      inputPath = join(config.playlist.uploadDir, file.filename)
      displayName = song.display_name
    } else {
      throw new Error('invalid type')
    }

    if (!inputPath) throw new Error('no input')

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
