import type { FastifyInstance } from 'fastify'
import type pino from 'pino'
import type { FFmpegManager } from '../services/ffmpeg-manager.js'
import type { WsHub } from '../services/ws-hub.js'
import type { DownloadState } from '../services/ffmpeg-downloader.js'
import type { FfmpegRuntimeState } from '../services/ffmpeg-state.js'
import type { AppConfig } from '../config.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = FastifyInstance<any, any, any, any, any>

/**
 * Convert an absolute ffmpeg path
 * (e.g. `/var/folders/.../bin/ffmpeg/.versions/8.1/ffmpeg`) into the
 * canonical UI form `bin/ffmpeg/.versions/8.1/ffmpeg`. We re-anchor on
 * the literal `ffmpeg/` segment because `binRoot` may sit under a
 * different project root in tests (e.g. tmpdir) and we don't want the
 * UI to surface those internals. Falls back to the absolute path when
 * the path is outside binRoot (system fallback, /usr/bin/ffmpeg, etc.).
 */
function relativizePath(absPath: string, binRoot: string): string {
  if (!absPath.startsWith(binRoot)) return absPath
  const idx = absPath.lastIndexOf('ffmpeg/')
  if (idx < 0) return absPath
  return `bin/${absPath.slice(idx)}`
}

export function registerFfmpegRoutes(app: AnyFastifyInstance, deps: {
  ffmpegManager: FFmpegManager
  wsHub: WsHub
  logger: pino.Logger
  config: AppConfig
  runtimeState: FfmpegRuntimeState
  binRoot: string
}): void {
  app.get('/api/ffmpeg/status', async () => {
    const status = deps.ffmpegManager.getStatus()
    return {
      ...status,
      path: status.path ? relativizePath(status.path, deps.binRoot) : null,
    }
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

  app.post('/api/ffmpeg/download', async (request) => {
    const body = (request.body as { version?: string }) ?? {}
    deps.ffmpegManager.triggerDownload(body.version).catch((err) =>
      deps.logger.error({ err }, '[ffmpeg trigger]'),
    )
    return { ok: true, version: body.version ?? null }
  })

  app.post('/api/ffmpeg/upgrade', async () => {
    deps.ffmpegManager.triggerDownload().catch((err) =>
      deps.logger.error({ err }, '[ffmpeg upgrade]'),
    )
    return { ok: true }
  })

  app.get('/api/ffmpeg/remote-versions', async () => {
    const remote = await deps.ffmpegManager.listLatestRemoteVersions(8)
    const installed = await deps.ffmpegManager.listVersions()
    // Annotate each remote version with whether we already have it on
    // disk — the admin UI uses this to swap "download" for "installed".
    // `listVersions()` returns `major.minor` strings, while remote list
    // may include a `.patch` suffix (e.g. `8.1.1`). We compare by
    // `major.minor` so `8.1` installed matches `8.1.1` available.
    const installedMM = new Set(installed.map((v) => v.split('.').slice(0, 2).join('.')))
    const annotated = remote.map((v) => ({
      version: v,
      installed: installedMM.has(v.split('.').slice(0, 2).join('.')),
    }))
    return { versions: annotated }
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
    // `current` follows the user-selected version (persisted in runtime
    // state, falling back to config.yaml). It is intentionally NOT taken
    // from `status.version` (which is the *probed* binary version) —
    // those can diverge when the binary at `.versions/{selected}/ffmpeg`
    // was placed manually or its real version differs from its directory
    // name. `currentPath` carries the actual on-disk path with the
    // relative display applied.
    const userSelected = await deps.runtimeState.getSelectedVersion()
    const current = (userSelected ?? deps.config.ffmpeg.version)?.replace(/\.0$/, '') ?? null
    return {
      versions,
      current,
      recommended: versions[0] ?? null,
      currentPath: status.path ? relativizePath(status.path, deps.binRoot) : null,
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
    // Persist user selection to the runtime state store so it survives a
    // service restart.
    await deps.runtimeState.setSelectedVersion(body.version)
    // Apply immediately — subsequent spawn calls (archiver, push source,
    // version probes) use the new binary on the very next request. No
    // restart required.
    const status = await deps.ffmpegManager.setVersion(body.version)
    deps.wsHub.emitEvent('config-changed', { key: 'ffmpeg.version' })
    if (!status.available) {
      // Persisted for next boot, but the bundled binary isn't on disk yet
      // (operator may be downloading it). Surface the situation in the
      // response so the UI can warn, but still report success because
      // the selection itself was accepted.
      return {
        success: true,
        available: false,
        message: `已选择版本 ${body.version}，但该版本尚未安装。请下载或安装。`,
      }
    }
    return {
      success: true,
      available: true,
      message: `已切换到版本 ${body.version}（实时生效）`,
    }
  })
}