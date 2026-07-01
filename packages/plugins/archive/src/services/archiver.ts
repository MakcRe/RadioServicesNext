import { spawn, type ChildProcess } from 'child_process'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { Readable } from 'stream'
import type { Logger } from 'pino'

export interface ArchiverOptions {
  getFfmpegPath: () => string | null
  archiveDir: string
  segmentDurationSec: number
  retentionDays: number
  logger?: Logger
}

export class Archiver {
  private proc: ChildProcess | null = null
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(private opts: ArchiverOptions) {}

  async start(sourceStream: Readable): Promise<void> {
    if (this.proc) throw new Error('archiver already running')
    const ffmpegPath = this.opts.getFfmpegPath()
    if (!ffmpegPath) {
      throw new Error('ffmpeg not available — install a version or pick one from the admin UI')
    }
    await mkdir(this.opts.archiveDir, { recursive: true })

    const filenamePattern = '%Y-%m-%d-%H.mp3'
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(this.opts.segmentDurationSec),
      '-segment_atclocktime', '1',
      '-strftime', '1',
      '-reset_timestamps', '1',
      join(this.opts.archiveDir, filenamePattern),
    ]

    this.proc = spawn(ffmpegPath, args, { cwd: this.opts.archiveDir })

    sourceStream.pipe(this.proc.stdin!)
    this.proc.stdin!.on('error', () => {
      // ignore EPIPE
    })

    if (this.proc.stderr) {
      this.proc.stderr.on('data', () => {
        // consume stderr to prevent backpressure
      })
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) =>
        this.opts.logger?.error({ err: err instanceof Error ? err.message : String(err) }, 'archiver cleanup failed'),
      )
    }, 60 * 60 * 1000)

    await this.cleanup().catch(() => {})
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    const proc = this.proc
    proc.stdin?.end()
    await new Promise<void>((resolve) => {
      proc.on('exit', () => {
        if (this.proc === proc) this.proc = null
        resolve()
      })
    })
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  getArchiveDir(): string {
    return this.opts.archiveDir
  }

  async cleanup(): Promise<void> {
    try {
      const files = await readdir(this.opts.archiveDir)
      const cutoff = Date.now() - this.opts.retentionDays * 24 * 60 * 60 * 1000
      for (const file of files) {
        if (!file.endsWith('.mp3')) continue
        const fullPath = join(this.opts.archiveDir, file)
        const stats = await stat(fullPath)
        if (stats.mtimeMs < cutoff) {
          await rm(fullPath, { force: true })
        }
      }
    } catch {
      // dir might not exist yet
    }
  }

  async list(): Promise<{ filename: string; sizeBytes: number; mtime: Date }[]> {
    try {
      const files = await readdir(this.opts.archiveDir)
      const result = []
      for (const file of files) {
        if (!file.endsWith('.mp3')) continue
        const fullPath = join(this.opts.archiveDir, file)
        const stats = await stat(fullPath)
        result.push({ filename: file, sizeBytes: stats.size, mtime: stats.mtime })
      }
      return result.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    } catch {
      return []
    }
  }
}
