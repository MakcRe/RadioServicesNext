import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, rename, chmod, readdir } from 'fs/promises'
import { isAbsolute, resolve as resolvePath, join } from 'path'
import { EventEmitter } from 'events'
import {
  downloadFfmpeg,
  listLatestRemoteVersions,
  type DownloadState,
} from './ffmpeg-downloader.js'
import type { FfmpegRuntimeState } from './ffmpeg-state.js'
import type pino from 'pino'

interface FfmpegConfig {
  version: string
  sourceUrl: string
}

interface AppConfig {
  ffmpeg: FfmpegConfig
}

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
  ffmpegPathOverride?: string
  systemFallbackPath?: string
  logger?: pino.Logger
  runtimeState?: FfmpegRuntimeState
}

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
    if (!isAbsolute(this.opts.binRoot)) {
      this.opts.binRoot = resolvePath(process.cwd(), this.opts.binRoot)
    }
  }

  async initialize(): Promise<FFmpegStatus> {
    if (this.initializingPromise) return this.initializingPromise

    if (!this.opts.ffmpegPathOverride && this.opts.runtimeState) {
      const userVersion = await this.opts.runtimeState.getSelectedVersion()
      if (userVersion) {
        if (userVersion !== this.opts.version) {
          this.opts.logger?.info(
            { previous: this.opts.version, selected: userVersion },
            '[ffmpeg] applying user-selected version from runtime state',
          )
        }
        this.opts.version = userVersion
      }
    }

    this.initializingPromise = this.doInitialize()
    return this.initializingPromise
  }

  private async doInitialize(): Promise<FFmpegStatus> {
    if (!this.opts.ffmpegPathOverride && !this.forceDownload) {
      await this.migrateLooseBinary()
    }

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

    if (!this.forceDownload) {
      const bundled = await this.tryBundledVersion(this.opts.version)
      if (bundled) {
        this.status = bundled
        return this.status
      }
    }

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

    this.status = { available: false, source: 'missing', path: null, version: null }
    this.printMissingBanner()
    return this.status
  }

  private printMissingBanner(): void {
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

  async tryBundledVersion(version: string): Promise<FFmpegStatus | null> {
    const preferredPath = join(this.opts.binRoot, '.versions', version, this.binaryName())
    if (await this.canExecute(preferredPath)) {
      return {
        available: true,
        source: 'bundled',
        path: preferredPath,
        version: await this.getVersion(preferredPath),
      }
    }
    const sorted = await this.listVersions()
    for (const v of sorted) {
      if (v === version) continue
      const p = join(this.opts.binRoot, '.versions', v, this.binaryName())
      if (!(await this.canExecute(p))) continue
      return {
        available: true,
        source: 'bundled',
        path: p,
        version: await this.getVersion(p),
      }
    }
    return null
  }

  async setVersion(version: string): Promise<FFmpegStatus> {
    this.opts.version = version
    const bundled = await this.tryBundledVersion(version)
    if (bundled) {
      this.status = bundled
      return bundled
    }
    if (this.status.source === 'bundled') {
      this.status = { available: false, source: 'missing', path: null, version: null }
    }
    return { ...this.status }
  }

  async triggerDownload(version?: string): Promise<void> {
    if (this.downloading) return
    const targetVersion = version ?? this.opts.version
    this.downloading = true
    try {
      const config: AppConfig = {
        ffmpeg: { version: targetVersion, sourceUrl: this.opts.downloadUrl },
      }
      const result = await downloadFfmpeg(
        config,
        this.opts.binRoot,
        (state: DownloadState) => this.emit('download', { ...state, version: targetVersion }),
        targetVersion,
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

  async listLatestRemoteVersions(limit = 8): Promise<string[]> {
    const isMac = process.platform === 'darwin'
    const apiUrl = isMac
      ? (process.env.RADIO_FFMPEG_MAC_URL ?? 'https://www.osxexperts.net')
      : 'https://api.github.com/repos/BtbN/FFmpeg-Builds/tags?per_page=100'
    return listLatestRemoteVersions(apiUrl, limit)
  }

  private binaryName(): string {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  }

  async listVersions(): Promise<string[]> {
    const versionsRoot = join(this.opts.binRoot, '.versions')
    const installed: string[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(versionsRoot, { withFileTypes: true })
    } catch {
      return []
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (!/^\d+\.\d+/.test(e.name)) continue
      const binPath = join(versionsRoot, e.name, this.binaryName())
      if (!(await this.canExecute(binPath))) continue
      installed.push(e.name)
    }
    return installed.sort((a, b) => {
      const partsA = a.split('.').map(Number)
      const partsB = b.split('.').map(Number)
      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const da = partsA[i] ?? 0
        const db = partsB[i] ?? 0
        if (db !== da) return db - da
      }
      return 0
    })
  }

  private async migrateLooseBinary(): Promise<void> {
    const loosePath = join(this.opts.binRoot, this.binaryName())
    if (!existsSync(loosePath)) return

    const probed = await this.getVersion(loosePath)
    if (!probed) return
    const targetVersion = normalizeVersion(probed)
    if (!targetVersion) return

    const targetDir = join(this.opts.binRoot, '.versions', targetVersion)
    const targetPath = join(targetDir, this.binaryName())

    if (existsSync(targetPath)) {
      await rename(loosePath, `${loosePath}.orphan`).catch(() => {})
      return
    }

    try {
      await mkdir(targetDir, { recursive: true })
      await rename(loosePath, targetPath)
      if (process.platform !== 'win32') {
        await chmod(targetPath, 0o755)
      }
      this.opts.logger?.info(
        { from: loosePath, to: targetPath, version: targetVersion },
        '[ffmpeg] auto-migrated loose binary into .versions/{version}/',
      )
    } catch (err) {
      this.opts.logger?.warn(
        { loosePath, targetPath, err: err instanceof Error ? err.message : String(err) },
        '[ffmpeg] failed to migrate loose binary; leaving in place',
      )
    }
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

export function normalizeVersion(raw: string): string | null {
  if (!raw) return null
  const s = raw.startsWith('n') && /^n\d/.test(raw) ? raw.slice(1) : raw
  const m = /^(\d+)\.(\d+)(?:\.\d+)?/.exec(s)
  if (!m) return null
  return `${m[1]}.${m[2]}`
}
