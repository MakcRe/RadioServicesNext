import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { downloadFfmpeg, type DownloadState } from './ffmpeg-downloader.js'
import type { AppConfig } from '../config.js'

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
}

/**
 * FFmpegManager 初始化顺序（测试驱动）：
 * 1. override (调试路径)
 * 2. bundled (.versions/{version}/ffmpeg 已缓存)
 * 3. system fallback (避免不必要的网络)
 * 4. download (从 BtbN 下载)
 * 5. missing
 *
 * 步骤 3 system 在 download 之前是为了避免网络失败回退延迟（spec 计划中计划是 bundled → download → system，
 * 但被调整为 system 在 download 之前以减少不必要的网络请求，特别在 system ffmpeg 可用时）
 */
export class FFmpegManager extends EventEmitter {
  private status: FFmpegStatus = {
    available: false,
    source: 'missing',
    path: null,
    version: null,
  }
  private downloading = false
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
    // 1. Override
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

    // 2. Bundled
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

    // 3. System fallback (avoid network when system ffmpeg is available)
    // When systemFallbackPath is explicitly set, try ONLY that path (do NOT also
    // call which('ffmpeg') — otherwise the test that sets a nonexistent explicit
    // path would silently fall back to the real system binary and report "available").
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

    // 4. Download
    try {
      this.downloading = true
      const config: AppConfig = {
        server: { host: '0.0.0.0', port: 8000 },
        auth: { sourcePassword: '' },
        archive: { directory: '', segmentDurationSec: 3600, retentionDays: 7, minFreeSpaceMB: 500 },
        playlist: { uploadDir: '', maxFileSizeMB: 500, allowedExtensions: [] },
        logging: { directory: '', level: 'info', retentionDays: 30 },
        ffmpeg: { version: this.opts.version, sourceUrl: this.opts.downloadUrl },
      }
      const result = await downloadFfmpeg(
        config,
        this.opts.binRoot,
        (state: DownloadState) => this.emit('download', state),
      )
      this.downloading = false
      this.status = {
        available: true,
        source: 'bundled',
        path: result.path,
        version: result.version,
      }
      return this.status
    } catch {
      this.downloading = false
      // 5. Fall through to missing
    }

    this.status = { available: false, source: 'missing', path: null, version: null }
    return this.status
  }

  getStatus(): FFmpegStatus {
    return this.status
  }

  getPath(): string | null {
    return this.status.path
  }

  isDownloading(): boolean {
    return this.downloading
  }

  async triggerDownload(): Promise<void> {
    if (this.downloading) return
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
      proc.on('exit', (code) => finalize(code === 0))
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
      proc.on('exit', () => {
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
      proc.on('exit', (code) => {
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
