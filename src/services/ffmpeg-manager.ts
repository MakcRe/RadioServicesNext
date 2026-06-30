import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, rename, chmod, readdir } from 'fs/promises'
import { isAbsolute, resolve as resolvePath, join } from 'path'
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
    // Normalize binRoot to an absolute path so all downstream spawn calls
    // (archiver, push-source, version probe) work regardless of the cwd of
    // whoever invokes .initialize(). Without this, a relative "bin/ffmpeg"
    // would resolve against the listener's cwd, which may not be the
    // project root (e.g. when the process is started from a different
    // directory or behind a wrapper script).
    if (!isAbsolute(this.opts.binRoot)) {
      this.opts.binRoot = resolvePath(process.cwd(), this.opts.binRoot)
    }
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
    // Pre-flight: if a "loose" ffmpeg binary sits at the top of binRoot
    // (e.g. an operator dropped ffmpeg/ffmpeg.exe there by hand instead
    // of into the .versions/{version}/ slot), probe its version and
    // auto-migrate it into .versions/{probedVersion}/.
    //
    // The destination is the loose binary's OWN version, not opts.version:
    // the operator clearly intended this specific version by placing the
    // file there by hand. It may differ from config.ffmpeg.version
    // (e.g. after an upgrade) — that's fine. doInitialize step 2
    // (bundled) accepts ANY .versions/{v}/ffmpeg that exists.
    if (!this.opts.ffmpegPathOverride && !this.forceDownload) {
      await this.migrateLooseBinary()
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
    // Try the configured .versions/{this.opts.version}/ slot first,
    // then fall through to ANY .versions/{v}/ffmpeg — this lets a
    // hand-placed binary (auto-migrated by migrateLooseBinary above
    // into .versions/{probedVersion}/) be picked up even when its
    // version doesn't match config.ffmpeg.version.
    if (!this.forceDownload) {
      const candidates: string[] = []
      const preferred = join(this.opts.binRoot, '.versions', this.opts.version, this.binaryName())
      if (existsSync(preferred)) candidates.push(preferred)
      // Glob for other .versions/*/ffmpeg entries (depth-bounded to
      // avoid scanning arbitrarily deep trees).
      const versionsRoot = join(this.opts.binRoot, '.versions')
      try {
        const entries = await readdir(versionsRoot, { withFileTypes: true })
        for (const e of entries) {
          if (!e.isDirectory()) continue
          const p = join(versionsRoot, e.name, this.binaryName())
          if (p !== preferred && existsSync(p)) candidates.push(p)
        }
      } catch {
        // .versions/ doesn't exist yet — that's fine, only `preferred` is checked.
      }

      for (const bundled of candidates) {
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

  /**
   * Scan `<binRoot>/.versions/*` for executables, return major.minor
   * strings sorted descending by semver. Used by the bundled-slot picker
   * and by the admin "版本管理" UI.
   *
   * - Reads directory entries only (no recursion beyond depth 2).
   * - Filters out non-executable files via `canExecute()`.
   * - Stable across directory iteration order on different filesystems.
   */
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

  /**
   * If a loose ffmpeg binary exists at `<binRoot>/ffmpeg` (or
   * `<binRoot>/ffmpeg.exe` on Windows), probe its actual version and
   * migrate it into `<binRoot>/.versions/{version}/ffmpeg` so step 2
   * (bundled) picks it up.
   *
   * Returns when either there's nothing to migrate, the migration
   * succeeds (so step 2 will hit), or the migration is skipped because
   * the target .versions/{v}/ffmpeg already exists. Skipped/leave-in-
   * place cases emit a structured logger.warn so the operator can see
   * what happened.
   */
  /**
   * If a loose ffmpeg binary exists at `<binRoot>/ffmpeg` (or
   * `<binRoot>/ffmpeg.exe` on Windows), probe its version and migrate it
   * into `<binRoot>/.versions/{probedVersion}/`. The destination is
   * the loose binary's OWN version, not opts.version, because the
   * operator clearly intended that version by placing the file there.
   *
   * doInitialize step 2 (bundled) accepts ANY .versions/{v}/ffmpeg that
   * exists, so this migration is enough to make the loose binary get
   * picked up regardless of what config.ffmpeg.version says.
   *
   * Refuses to overwrite an existing target binary.
   */
  private async migrateLooseBinary(): Promise<void> {
    const loosePath = join(this.opts.binRoot, this.binaryName())
    if (!existsSync(loosePath)) return

    // Probe version from the loose binary; if it can't be parsed,
    // abandon — there's nothing safer to assume than literal copy.
    const probed = await this.getVersion(loosePath)
    if (!probed) return
    const targetVersion = normalizeVersion(probed)
    if (!targetVersion) return

    const targetDir = join(this.opts.binRoot, '.versions', targetVersion)
    const targetPath = join(targetDir, this.binaryName())

    // If the target slot already has a binary, the loose copy is a
    // throwaway — operator probably ran triggerDownload() earlier and
    // then copied a fresh ffmpeg to the wrong place. Silently remove
    // the loose copy so it doesn't shadow everything else and don't
    // touch the bundled one.
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

/**
 * Reduce the noisy version string that ffmpeg emits into the canonical
 * major.minor used for the .versions/ directory slot.
 *
 * Examples (input → output):
 *   "7.1"            → "7.1"        (simple homebrew static build)
 *   "8.1.1"          → "8.1"        (homebrew 8.1.1 → bin dir 8.1, matches config)
 *   "n8.1.1"         → "8.1"        (BtbN `n` prefix stripped, patch dropped)
 *   "n8.1.1-15-..."  → "8.1"        (BtbN `n`-prefixed tag with git suffix)
 *   "git-2024-..."   → null          (nightly / dev snapshot — don't migrate)
 *   ""               → null
 */
export function normalizeVersion(raw: string): string | null {
  if (!raw) return null
  // Strip BtbN's leading "n" used for stable tag prefixes.
  const s = raw.startsWith('n') && /^n\d/.test(raw) ? raw.slice(1) : raw
  // Match "X.Y" or "X.Y.Z", optionally followed by a -git suffix or other garbage.
  const m = /^(\d+)\.(\d+)(?:\.\d+)?/.exec(s)
  if (!m) return null
  return `${m[1]}.${m[2]}`
}
