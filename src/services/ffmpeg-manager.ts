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
 * FFmpegManager 初始化顺序（按 spec `2026-06-29-radio-services-design.md` 第 156 行）：
 * 1. override (调试显式指定路径 — 一切其它逻辑短路)
 * 2. bundled (`.versions/{version}/ffmpeg` 已存在且可执行 → 复用项目内二进制)
 * 3. download (bundled 缺失 → 主动从 BtbN 下载；失败才进入下一步)
 * 4. system fallback (仅当下载失败时回退；正常情况下不会触碰 PATH 上的 ffmpeg)
 * 5. missing (都没有 → 启动失败)
 *
 * 第 3 步的下载优先于第 4 步系统兜底：spec 明确"优先使用项目内下载的版本；
 * 下载失败时回退到系统 ffmpeg；都没有则启动失败"。
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

    this.initializingPromise = this.doInitialize()
    return this.initializingPromise
  }

  private async doInitialize(): Promise<FFmpegStatus> {
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

    // 3. Download (BtbN/FFmpeg-Builds → bin/ffmpeg/.versions/{version}/)
    try {
      this.downloading = true
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
      this.downloading = false
      this.forceDownload = false
      this.status = {
        available: true,
        source: 'bundled',
        path: result.path,
        version: result.version,
      }
      return this.status
    } catch {
      this.downloading = false
      this.forceDownload = false
      // 走下一步：system 兜底
    }

    // 4. System fallback (仅当下载失败时回退)
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

    // 5. Missing — 启动失败
    this.status = { available: false, source: 'missing', path: null, version: null }
    return this.status
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
    // Force a fresh initialize(): the cached initializingPromise would otherwise
    // short-circuit before the bundled-skip check fires (see doInitialize step 2),
    // so a re-trigger after a previous boot would silently re-resolve the cached
    // status without ever calling downloadFfmpeg — and the SSE event stream would
    // only ever see the initial { state: 'idle' }.
    this.initializingPromise = null
    this.forceDownload = true
    await this.initialize()
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
