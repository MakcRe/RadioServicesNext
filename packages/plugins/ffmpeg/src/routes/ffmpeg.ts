import type { PluginContext, RouteOptions, FastifyReply } from '@radio-services/shared'
import { FFmpegManager } from '../services/ffmpeg-manager.js'
import type { WsHub } from '@radio-services/core'
import type { FfmpegRuntimeState } from '../services/ffmpeg-state.js'
import { createReadStream } from 'fs'
import { join, basename } from 'path'

/** Minimal surface needed by the SSE download-status handler. */
export interface SseStream {
  writeHead: (status: number, headers?: Record<string, string | number>) => void
  write: (chunk: string) => boolean
  on: (event: 'close' | 'error', listener: () => void) => void
  off: (event: 'close' | 'error', listener: () => void) => void
}

export interface SseDeps {
  ffmpegManager: Pick<FFmpegManager, 'on' | 'off'>
  rawRequest: SseStream
  rawReply: SseStream
  hijack: () => void
}

/**
 * Attach an SSE stream of FFmpeg download progress to the response.
 *
 * The single source of truth is the FFmpegManager's 'download' event;
 * we forward each emission to the client and unhook the subscription
 * when the client disconnects (via either the request or the response
 * close event, since the Fastify hijack leaves the lifecycle ambiguous).
 */
export function attachDownloadStatusSse(deps: SseDeps): void {
  const { ffmpegManager, rawRequest, rawReply, hijack } = deps
  hijack()
  rawReply.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  })
  rawReply.write('retry: 5000\n\n')
  // Initial frame so the client doesn't sit on a half-open stream.
  // If a download is already in flight we still start with `idle`; the
  // next 'download' event will arrive on the manager's bus as usual.
  rawReply.write(`data: ${JSON.stringify({ state: 'idle' })}\n\n`)

  const forward = (payload: unknown): void => {
    try {
      rawReply.write(`data: ${JSON.stringify(payload)}\n\n`)
    } catch {
      cleanup()
    }
  }
  const onDownload = (state: unknown): void => forward(state)
  const cleanup = (): void => {
    ffmpegManager.off('download', onDownload)
    rawRequest.off('close', cleanup)
    rawReply.off('close', cleanup)
  }
  ffmpegManager.on('download', onDownload)
  // Listen on BOTH the request and the response: depending on the
  // direction of the disconnect and whether the handler has been
  // hijacked, only one of these may fire. Belt-and-braces keeps the
  // EventEmitter clean.
  rawRequest.on('close', cleanup)
  rawReply.on('close', cleanup)
}

function relativizePath(absPath: string, binRoot: string): string {
  if (!absPath.startsWith(binRoot)) return absPath
  const idx = absPath.lastIndexOf('ffmpeg/')
  if (idx < 0) return absPath
  return `bin/${absPath.slice(idx)}`
}

export function registerFfmpegRoutes(
  ctx: PluginContext,
  deps: {
    ffmpegManager: FFmpegManager
    wsHub: WsHub
    runtimeState: FfmpegRuntimeState
    binRoot: string
    sourceReceiver?: {
      attachInternalStream: (stream: import('stream').Readable, metadata?: { name?: string }) => void
      getActiveSession: () => { id: string } | null
    }
  }
): void {
  const routes: RouteOptions[] = [
    {
      method: 'GET',
      url: '/api/ffmpeg/status',
      handler: async () => {
        const status = deps.ffmpegManager.getStatus()
        return {
          ...status,
          path: status.path ? relativizePath(status.path, deps.binRoot) : null,
        }
      }
    },
    {
      method: 'GET',
      url: '/api/ffmpeg/download/status',
      handler: async (request, reply) => {
        // Server-Sent Events stream of FFmpeg download progress. Frontend
        // subscribes via `new EventSource('/api/ffmpeg/download/status')` —
        // the admin UI's "下载 FFmpeg" button relies on this to show
        // progress (BACKLOG P0-2). All the work lives in
        // attachDownloadStatusSse (kept separate for unit-testability).
        const rawReply = (reply as unknown as { raw: SseStream }).raw
        const rawRequest = (request as unknown as { raw: SseStream }).raw
        // NB: must bind `reply` so the Fastify Reply prototype method keeps
        // its `this`. Stashing the unbound reference and calling it later
        // makes `this` undefined inside hijack(), which then blows up trying
        // to set Symbol(fastify.reply.hijacked).
        const hijack = (reply as unknown as { hijack: () => void }).hijack.bind(reply)
        attachDownloadStatusSse({
          ffmpegManager: deps.ffmpegManager,
          rawRequest,
          rawReply,
          hijack,
        })
      }
    },
    {
      method: 'POST',
      url: '/api/ffmpeg/download',
      handler: async (request) => {
        const body = (request.body as { version?: string }) ?? {}
        deps.ffmpegManager.triggerDownload(body.version).catch((err) =>
          ctx.logger.error('[ffmpeg trigger] ' + String(err))
        )
        return { ok: true, version: body.version ?? null }
      }
    },
    {
      method: 'POST',
      url: '/api/ffmpeg/upgrade',
      handler: async () => {
        deps.ffmpegManager.triggerDownload().catch((err) =>
          ctx.logger.error('[ffmpeg upgrade] ' + String(err))
        )
        return { ok: true }
      }
    },
    {
      method: 'GET',
      url: '/api/ffmpeg/remote-versions',
      handler: async () => {
        const remote = await deps.ffmpegManager.listLatestRemoteVersions(8)
        const installed = await deps.ffmpegManager.listVersions()
        const installedMM = new Set(installed.map((v) => v.split('.').slice(0, 2).join('.')))
        const annotated = remote.map((v) => ({
          version: v,
          installed: installedMM.has(v.split('.').slice(0, 2).join('.')),
        }))
        return { versions: annotated }
      }
    },
    {
      method: 'POST',
      url: '/api/ffmpeg/test',
      handler: async () => {
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
      }
    },
    {
      method: 'GET',
      url: '/api/ffmpeg/versions',
      handler: async () => {
        const versions = await deps.ffmpegManager.listVersions()
        const status = deps.ffmpegManager.getStatus()
        const userSelected = await deps.runtimeState.getSelectedVersion()
        const current = (userSelected ?? ctx.config.ffmpeg.version)?.replace(/\.0$/, '') ?? null
        return {
          versions,
          current,
          recommended: versions[0] ?? null,
          currentPath: status.path ? relativizePath(status.path, deps.binRoot) : null,
        }
      }
    },
    {
      method: 'POST',
      url: '/api/ffmpeg/select',
      handler: async (request, reply: FastifyReply) => {
        const body = request.body as { version?: string }
        if (!body.version) {
          return reply.status(400).send({ success: false, message: 'version 必填' })
        }
        const version = body.version
        const versions = await deps.ffmpegManager.listVersions()
        if (!versions.includes(version)) {
          return reply.status(400).send({ success: false, message: `版本 ${version} 不存在` })
        }
        await deps.runtimeState.setSelectedVersion(version)
        const status = await deps.ffmpegManager.setVersion(version)
        deps.wsHub.emitEvent('config-changed', { key: 'ffmpeg.version' })
        if (!status.available) {
          return {
            success: true,
            available: false,
            message: `已选择版本 ${version}，但该版本尚未安装。请下载或安装。`,
          }
        }
        return {
          success: true,
          available: true,
          message: `已切换到版本 ${version}（实时生效）`,
        }
      }
    },
    {
      method: 'POST',
      url: '/api/source/start',
      handler: async (request: unknown) => {
        const body = (request as { body?: { type?: string; id?: number } }).body ?? {}
        const { type = 'file', id } = body

        const ffmpegStatus = deps.ffmpegManager.getStatus()
        if (!ffmpegStatus.available || !ffmpegStatus.path) {
          return { success: false, error: 'ffmpeg not available' }
        }

        if (type === 'file' && id) {
          // Get the uploaded file path from the playlist service
          const playlistService = ctx.getService<{ getById?: (id: number) => { filename: string } | null }>('playlistService')
          if (!playlistService) {
            return { success: false, error: 'playlist service not available' }
          }

          const playlistItem = playlistService.getById?.(id)
          if (!playlistItem) {
            return { success: false, error: `playlist item ${id} not found` }
          }

          const uploadDir = ctx.config.playlist.uploadDir
          const inputFile = join(uploadDir, playlistItem.filename)

          // Use the sourceReceiver if available to push audio to broadcaster
          const stream = createReadStream(inputFile)
          const receiver = deps.sourceReceiver
          if (receiver) {
            receiver.attachInternalStream(stream, { name: basename(inputFile) })
            return { success: true, message: 'started streaming file' }
          }

          return { success: false, error: 'source receiver not available' }
        }

        // Generic start without file
        return { success: false, error: 'unsupported source type' }
      }
    },
    {
      method: 'POST',
      url: '/api/source/stop',
      handler: async () => {
        // Stop the current source session
        const sourceReceiver = ctx.getService<{ detachInternalStream?: () => void }>('sourceReceiver')
        if (sourceReceiver) {
          sourceReceiver.detachInternalStream?.()
        }
        return { success: true }
      }
    }
  ]

  routes.forEach(route => ctx.registerRoute(route))
}
