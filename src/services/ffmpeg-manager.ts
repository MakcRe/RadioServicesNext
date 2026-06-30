import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import {
  downloadFfmpeg,
  resolveLatestFfmpegVersion,
  type DownloadState,
} from './ffmpeg-downloader.js'
import type { AppConfig } from '../config.js'
import type pino from 'pino'

export type FFmpegSource = 'bundled' | 'system' | 'override' | 'missing'

export interface FFmpegStatus {
  available: boolean
  source: FFmpegSource
  path: string | null
  version: string | null
}

export interface FFmpegManagerOptions {
  binRoot: string
  version: string
  downloadUrl: string
  /** When set, use this path instead of any detection (debug only). */
  ffmpegPathOverride?: string
  /** System fallback path; if not given, tries `which ffmpeg`. */
  systemFallbackPath?: string
  /** Logger for warnings (e.g. version resolution failure). */
  logger?: pino.Logger
}

/**
 * FFmpegManager 初始化顺序（v1.2 — 启动不再自动下载）：
 * 1. override (调试显式指定路径 — 一切其它逻辑短路)
 * 2. bundled (`.versions/{version}/ffmpeg` 已存在且可执行 → 复用项目内二进制)
 * 3. system (回退到 PATH 上的 ffmpeg — 启动必须快速，禁止阻塞网络)
 * 4. missing (都没有 → 控制台报警 + 管理面板提供"下载 FFmpeg"按钮)
 *
 * 启动流程**不**调用 downloadFfmpeg——网络慢的机器启动时不应该卡在 21 MB
 * 下载上。下载由用户主动通过 `/admin` → FFmpeg 面板触发（FFmpegManager.triggerDownload），
 * 失败/缺失情况下管理面板"下载安装"卡片显示。
 *
 * 第 3 步改为"active fallback"而非"download 失败的兜底"——把系统 ffmpeg
 * 当成合理来源（很多部署直接装在系统里），不是临时过渡。
 */
export class FFmpegManager extends EventEmitter {
  private status: FFmpegStatus = {
    available: false,
    source: 'missing',
    path: null,
    version: null,
  }
  private downloading = false
  private forceDownload = false
  private initializingPromise: Promise<FFmpegStatus> | null = null

  constructor(private opts: FFmpegManagerOptions) {
    super()
  }

  async initialize(): Promise<FFmpegStatus> {
    // 防止重入: 多个并发 initialize() 调用应该共享同一个 promise
    if (this.initializingPromise) return this.initializingPromise

    // Best-effort: pick a version that actually exists on the publisher.
    // macOS uses osxexperts.net (Helmut Tessarek) — BtbN dropped macOS in 2026.
    // Other platforms use BtbN. Failures are silent — the configured `version`
    // is the fallback.
    if (!this.opts.ffmpegPathOverride) {
      const isMac = process.platform === 'darwin'
      const resolveUrl = isMac
        ? (process.env.RADIO_FFMPEG_MAC_URL ?? 'https://www.osxexperts.net')
        : undefined
      const resolved = await resolveLatestFfmpegVersion(resolveUrl)
      if (resolved) {
        if (resolved !== this.opts.version) {
          this.opts.logger?.info(
            { configured: this.opts.version, resolved, platform: process.platform },
            '[ffmpeg] using latest published version',
          )
        }
        this.opts.version = resolved
      }
      // resolve failure is expected on networks where the publisher can't
      // be reached (air-gapped, blocked, slow); downgrade to debug so it
      // doesn't pollute logs on every boot. Fallback to config.ffmpeg.version
      // is the default behaviour.
    }

    this.initializingPromise = this.doInitialize()
    return this.initializingPromise
  }

  private async doInitialize(): Promise<FFmpegStatus> {
    // Pre-flight: warn when a "loose" ffmpeg binary sits at the top of
    // binRoot (e.g. someone dropped an executable there by hand) but isn't
    // in the `.versions/{version}/` slot the manager searches. Without
    // this, the binary goes unused and the manager silently re-downloads
    // on every boot.
    if (!this.opts.ffmpegPathOverride) {
      const loosePath = join(this.opts.binRoot, this.binaryName())
      if (existsSync(loosePath)) {
        this.opts.logger?.warn(
          { loosePath, expected: join(this.opts.binRoot, '.versions', this.opts.version, this.binaryName()) },
          '[ffmpeg] found a loose ffmpeg binary at the binRoot root; move it into the .versions/{version}/ subdirectory to be picked up',
        )
      }
    }

    // 1. Override (调试显式指定路径)
    if (this.opts.ffmpegPathOverride) {
      if (await this.canExecute(this.opts.ffmpegPathOverride)) {
        this.status = {
          available: true,
          source: 'override',
          path: this.opts.ffmpegPathOverride,
          version: await this.getVersion(this.opts.ffmpegPathOverride),
        }
        return this.status
      }
    }

    // 2. Bundled (项目内已下载的二进制)
    if (!this.forceDownload) {
      const bundled = join(this.opts.binRoot, '.versions', this.opts.version, this.binaryName())
      if (existsSync(bundled)) {
        if (await this.canExecute(bundled)) {
          this.status = {
            available: true,
            source: 'bundled',
            path: bundled,
            version: await this.getVersion(bundled),
          }
          return this.status
        }
      }
    }

    // 3. System fallback (PATH 上的 ffmpeg — 启动不再下载，避免慢网络阻塞)
    // 当 systemFallbackPath 显式给出时，只尝试该路径 — 不另外 `which ffmpeg` —
    // 否则测试若把不存在的显式路径传入，会被环境里的真实系统二进制默默替代并误报 "available"。
    const sysCandidates: string[] = []
    if (this.opts.systemFallbackPath) {
      sysCandidates.push(this.opts.systemFallbackPath)
    } else {
      const discovered = await this.which('ffmpeg')
      if (discovered) sysCandidates.push(discovered)
    }
    for (const p of sysCandidates) {
      if (await this.canExecute(p)) {
        this.status = {
          available: true,
          source: 'system',
          path: p,
          version: await this.getVersion(p),
        }
        return this.status
      }
    }

    // 4. Missing — 启动失败但服务不中断
    // 不再 throw；服务正常启动，FFmpeg 相关功能不可用。
    // 控制台打醒目横幅 + 提示用户在管理面板触发下载。
    this.status = { available: false, source: 'missing', path: null, version: null }
    this.printMissingBanner()
    return this.status
  }

  private printMissingBanner(): void {
    // Print to stderr so it stands out from the regular pino log stream.
    // Avoid unicode box-drawing chars so it stays readable in any terminal.
    const lines = [
      '',
      '================================================================',
      '  [FFmpeg] NOT FOUND',
      '----------------------------------------------------------------',
      `  No ffmpeg in ${this.opts.binRoot}/.versions/${this.opts.version}/`,
      '  and no `ffmpeg` on PATH.',
      '',
      '  Service is still running but recording / source push features',
      '  will not work until ffmpeg is installed.',
      '',
      '  To install: open the admin UI (FFmpeg panel) and click',
      '  "Download FFmpeg". The download runs in the background and',
      '  does not block the server.',
      '',
      '  Or manually place a binary at the expected path, or set',
      '  FFMPEG_PATH_OVERRIDE in your env / config.',
      '================================================================',
      '',
    ]
    process.stderr.write(lines.join('\n'))
    // Also surface via pino so log aggregators pick it up.
    this.opts.logger?.error(
      {
        binRoot: this.opts.binRoot,
        expectedVersion: this.opts.version,
        adminHint: 'POST /api/ffmpeg/download (or use the admin UI)',
      },
      '[ffmpeg] not available — service continues but recording/source features are disabled until ffmpeg is installed',
    )
  }

  getStatus(): FFmpegStatus {
    return { ...this.status }
  }

  getPath(): string | null {
    return this.status.path
  }

  isDownloading(): boolean {
    return this.downloading
  }

  async triggerDownload(): Promise<void> {
    if (this.downloading) return
    // v1.2: download is no longer part of initialize() (which now only does
    // override → bundled → system → missing). triggerDownload() calls
    // downloadFfmpeg directly so the user-initiated download is independent
    // of the startup sequence.
    //
    // On success: update status to 'bundled' so subsequent calls to
    // getStatus() reflect the installed binary. On failure: leave status
    // alone (the user can see the error via the SSE stream).
    this.downloading = true
    try {
      const config: AppConfig = {
        db: { path: '' },
        server: { host: '0.0.0.0', port: 8000 },
        auth: { sourcePassword: '' },
        ffmpeg: { version: this.opts.version, sourceUrl: this.opts.downloadUrl },
        archive: { directory: '', segmentDurationSec: 0, retentionDays: 0, minFreeSpaceMB: 0 },
        playlist: { uploadDir: '', maxFileSizeMB: 0, allowedExtensions: [] },
        logging: { directory: '', level: '', retentionDays: 0 },
        stream: { pollIntervalMs: 5000, pollIntervalMaxMs: 30000 },
      }
      const result = await downloadFfmpeg(
        config,
        this.opts.binRoot,
        (state: DownloadState) => this.emit('download', state),
      )
      this.status = {
        available: true,
        source: 'bundled',
        path: result.path,
        version: result.version,
      }
    } finally {
      this.downloading = false
    }
  }

  private binaryName(): string {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  }

  private async canExecute(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(path, ['-version'], { stdio: 'ignore' })
      let resolved = false
      const finalize = (v: boolean) => {
        if (resolved) return
        resolved = true
        resolve(v)
      }
      proc.on('close', (code) => finalize(code === 0))
      proc.on('error', () => finalize(false))
      setTimeout(() => {
        try { proc.kill() } catch {}
        finalize(false)
      }, 5000)
    })
  }

  private async getVersion(path: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(path, ['-version'])
      let output = ''
      proc.stdout.on('data', (chunk) => (output += chunk.toString()))
      proc.on('close', () => {
        const match = output.match(/ffmpeg version (\S+)/)
        resolve(match ? match[1] : null)
      })
      proc.on('error', () => resolve(null))
    })
  }

  private async which(name: string): Promise<string | null> {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      const proc = spawn(cmd, [name])
      let output = ''
      proc.stdout.on('data', (chunk) => (output += chunk.toString()))
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output.split('\n')[0].trim())
        } else {
          resolve(null)
        }
      })
      proc.on('error', () => resolve(null))
    })
  }
}
