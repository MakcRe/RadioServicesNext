import { mkdir, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import type { UploadedFilesRepo } from '../db/repos/uploaded-files.repo.js'

export interface UploadServiceOptions {
  uploadDir: string
  maxFileSizeMB: number
  allowedExtensions: string[]
  ffmpegPath: string
  fileRepo: UploadedFilesRepo
}

export interface SaveInput {
  buffer: Buffer
  originalName: string
  /** Function to extract duration; injected for testing */
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

    this.opts.fileRepo.insert({
      filename,
      original_name: input.originalName,
      size_bytes: input.buffer.length,
      duration_sec: durationSec,
    })

    return {
      filename,
      originalName: input.originalName,
      sizeBytes: input.buffer.length,
      durationSec,
    }
  }
}
