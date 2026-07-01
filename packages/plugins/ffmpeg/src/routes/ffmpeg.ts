import type { PluginContext, RouteOptions, FastifyReply } from '@radio-services/shared'
import { FFmpegManager } from '../services/ffmpeg-manager.js'
import type { WsHub } from '@radio-services/core'
import type { FfmpegRuntimeState } from '../services/ffmpeg-state.js'
import { createReadStream } from 'fs'
import { join, basename } from 'path'

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
      handler: async () => {
        return { state: 'idle' }
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
