import type { FastifyInstance } from 'fastify'
import type pino from 'pino'
import type { FFmpegManager } from '../services/ffmpeg-manager.js'
import type { WsHub } from '../services/ws-hub.js'
import type { DownloadState } from '../services/ffmpeg-downloader.js'
import { updateFfmpegVersionInMemory, type AppConfig } from '../config.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

export function registerFfmpegRoutes(app: AnyFastifyInstance, deps: {
  ffmpegManager: FFmpegManager
  wsHub: WsHub
  logger: pino.Logger
  config: AppConfig
}): void {
  app.get('/api/ffmpeg/status', async () => {
    return deps.ffmpegManager.getStatus()
  })

  app.get('/api/ffmpeg/download/status', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('Access-Control-Allow-Origin', '*')
    reply.raw.flushHeaders()

    const send = (state: DownloadState) => {
      reply.raw.write(`data: ${JSON.stringify(state)}\n\n`)
    }

    const onDownload = (state: DownloadState) => send(state)
    deps.ffmpegManager.on('download', onDownload)
    send({ state: 'idle' })

    request.raw.on('close', () => {
      deps.ffmpegManager.off('download', onDownload)
    })
    return reply
  })

  app.post('/api/ffmpeg/download', async () => {
    deps.ffmpegManager.triggerDownload().catch((err) =>
      deps.logger.error({ err }, '[ffmpeg trigger]'),
    )
    return { ok: true }
  })

  app.post('/api/ffmpeg/upgrade', async () => {
    deps.ffmpegManager.triggerDownload().catch((err) =>
      deps.logger.error({ err }, '[ffmpeg upgrade]'),
    )
    return { ok: true }
  })

  app.post('/api/ffmpeg/test', async () => {
    const status = deps.ffmpegManager.getStatus()
    if (!status.available || !status.path) {
      return { ok: false, error: 'ffmpeg not available' }
    }
    const { spawn } = await import('child_process')
    return new Promise((resolve) => {
      const path = status.path as string
      const proc = spawn(path, ['-version'])
      let output = ''
      proc.stdout!.on('data', (c: Buffer) => (output += c.toString()))
      proc.on('close', (code: number | null) => resolve({ ok: code === 0, output: output.slice(0, 500), path }))
      proc.on('error', (err: Error) => resolve({ ok: false, error: err.message }))
    })
  })

  app.get('/api/ffmpeg/versions', async () => {
    const versions = await deps.ffmpegManager.listVersions()
    const status = deps.ffmpegManager.getStatus()
    const current = (status.version ?? deps.config.ffmpeg.version)?.replace(/\.0$/, '') ?? null
    return {
      versions,
      current,
      recommended: versions[0] ?? null,
    }
  })

  app.post('/api/ffmpeg/select', async (request, reply) => {
    const body = request.body as { version?: string }
    if (!body.version) {
      return reply.status(400).send({ success: false, message: 'version 必填' })
    }
    const versions = await deps.ffmpegManager.listVersions()
    if (!versions.includes(body.version)) {
      return reply.status(400).send({ success: false, message: `版本 ${body.version} 不存在` })
    }
    updateFfmpegVersionInMemory(deps.config, body.version)
    deps.wsHub.emitEvent('config-changed', { key: 'ffmpeg.version' })
    return {
      success: true,
      message: `已切换到版本 ${body.version}，下次服务启动生效`,
    }
  })
}
