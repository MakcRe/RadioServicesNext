import { mkdir, writeFile, rm } from 'fs/promises'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import type { UploadedFilesRepo } from '../repos/uploaded-files.repo.js'

const MIN_MAGIC_BYTES = 12

function detectMagicBytes(buffer: Buffer, ext: string): { ok: boolean; detected?: string } {
  if (buffer.length < MIN_MAGIC_BYTES) {
    return { ok: false }
  }

  const extLower = ext.toLowerCase()
  const b0 = buffer[0]
  const b1 = buffer[1]

  switch (extLower) {
    case '.mp3':
      if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
        return { ok: true, detected: 'MP3' }
      }
      return { ok: false, detected: 'unknown' }

    case '.aac':
      if (b0 === 0xff && (b1 === 0xf1 || b1 === 0xf9)) {
        return { ok: true, detected: 'AAC' }
      }
      return { ok: false, detected: 'unknown' }

    case '.flac':
      if (
        buffer[0] === 0x66 &&
        buffer[1] === 0x4c &&
        buffer[2] === 0x61 &&
        buffer[3] === 0x43
      ) {
        return { ok: true, detected: 'FLAC' }
      }
      return { ok: false, detected: 'unknown' }

    case '.wav':
      if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x41 &&
        buffer[10] === 0x56 &&
        buffer[11] === 0x45
      ) {
        return { ok: true, detected: 'WAV' }
      }
      return { ok: false, detected: 'unknown' }

    case '.ogg':
      if (
        buffer[0] === 0x4f &&
        buffer[1] === 0x67 &&
        buffer[2] === 0x67 &&
        buffer[3] === 0x53
      ) {
        return { ok: true, detected: 'OGG' }
      }
      return { ok: false, detected: 'unknown' }

    case '.m4a':
      if (
        buffer[4] === 0x66 &&
        buffer[5] === 0x74 &&
        buffer[6] === 0x79 &&
        buffer[7] === 0x70
      ) {
        return { ok: true, detected: 'M4A' }
      }
      return { ok: false, detected: 'unknown' }

    default:
      throw new Error(`no magic bytes handler for extension: ${extLower}`)
  }
}

export interface UploadServiceOptions {
  uploadDir: string
  maxFileSizeMB: number
  allowedExtensions: string[]
  fileRepo: UploadedFilesRepo
}

export interface SaveInput {
  buffer: Buffer
  originalName: string
  getDuration: (filePath: string) => Promise<number | null>
}

export interface SaveResult {
  filename: string
  originalName: string
  sizeBytes: number
  durationSec: number | null
}

export class UploadService {
  constructor(private opts: UploadServiceOptions) {}

  async save(input: SaveInput): Promise<SaveResult> {
    const ext = extname(input.originalName).toLowerCase()
    if (!this.opts.allowedExtensions.includes(ext)) {
      throw new Error(`unsupported file extension: ${ext}`)
    }
    const maxBytes = this.opts.maxFileSizeMB * 1024 * 1024
    if (input.buffer.length > maxBytes) {
      throw new Error(`file too large: ${input.buffer.length} > ${maxBytes}`)
    }

    const magic = detectMagicBytes(input.buffer, ext)
    if (!magic.ok) {
      throw new Error(
        `file too small for magic bytes detection: ${input.buffer.length} bytes`,
      )
    }
    if (magic.detected && magic.detected !== 'unknown') {
      const expectedMap: Record<string, string> = {
        '.mp3': 'MP3',
        '.aac': 'AAC',
        '.flac': 'FLAC',
        '.wav': 'WAV',
        '.ogg': 'OGG',
        '.m4a': 'M4A',
      }
      const expected = expectedMap[ext]
      if (expected && magic.detected !== expected) {
        throw new Error(
          `magic bytes do not match extension: expected ${expected}, got ${magic.detected}`,
        )
      }
    }

    await mkdir(this.opts.uploadDir, { recursive: true })
    const filename = `${randomUUID()}${ext}`
    const filepath = join(this.opts.uploadDir, filename)
    await writeFile(filepath, input.buffer)

    let durationSec: number | null = null
    try {
      durationSec = await input.getDuration(filepath)
    } catch {
      durationSec = null
    }

    try {
      this.opts.fileRepo.insert({
        filename,
        original_name: input.originalName,
        size_bytes: input.buffer.length,
        duration_sec: durationSec,
      })
    } catch (err) {
      await rm(filepath, { force: true }).catch(() => {})
      throw err
    }

    return {
      filename,
      originalName: input.originalName,
      sizeBytes: input.buffer.length,
      durationSec,
    }
  }
}
