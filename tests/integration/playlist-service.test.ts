import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '@radio-services/core'
import { PlaylistRepo } from '@radio-services/core'
import { UploadedFilesRepo } from '@radio-services/core'
import { PlaylistService } from '@radio-services/plugins/playlist'
import { UploadService } from '@radio-services/plugins/playlist'
import { silentMp3Frame } from '../helpers/mock-source.js'
import type Database from 'better-sqlite3'

let tempDir: string
let dbPath: string
let db: Database.Database

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-pl-'))
  dbPath = join(tempDir, 'test.db')
  db = await initDb(dbPath)
})

afterEach(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('PlaylistService', () => {
  it('adds, lists, and removes songs', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const plRepo = new PlaylistRepo(db)
    const pl = new PlaylistService(plRepo, fileRepo)

    fileRepo.insert({
      filename: 'song.mp3',
      original_name: 'song.mp3',
      size_bytes: 1024,
      duration_sec: 200,
    })

    const songId = pl.add({
      filename: 'song.mp3',
      display_name: 'My Song',
      duration_sec: 200,
    })
    expect(songId).toBeGreaterThan(0)

    const list = pl.list()
    expect(list).toHaveLength(1)
    expect(list[0].display_name).toBe('My Song')

    pl.remove(songId)
    expect(pl.list()).toHaveLength(0)
  })

  it('throws when adding a song whose uploaded file does not exist', () => {
    const fileRepo = new UploadedFilesRepo(db)
    const plRepo = new PlaylistRepo(db)
    const pl = new PlaylistService(plRepo, fileRepo)

    expect(() => pl.add({
      filename: 'nonexistent.mp3',
      display_name: 'Ghost',
      duration_sec: null,
    })).toThrow(/uploaded file not found/)
  })

  it('reorders songs by id list', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const plRepo = new PlaylistRepo(db)
    const pl = new PlaylistService(plRepo, fileRepo)

    fileRepo.insert({ filename: 'a.mp3', original_name: 'a.mp3', size_bytes: 1, duration_sec: 100 })
    fileRepo.insert({ filename: 'b.mp3', original_name: 'b.mp3', size_bytes: 1, duration_sec: 100 })
    fileRepo.insert({ filename: 'c.mp3', original_name: 'c.mp3', size_bytes: 1, duration_sec: 100 })

    const idA = pl.add({ filename: 'a.mp3', display_name: 'A', duration_sec: 100 })
    const idB = pl.add({ filename: 'b.mp3', display_name: 'B', duration_sec: 100 })
    const idC = pl.add({ filename: 'c.mp3', display_name: 'C', duration_sec: 100 })

    pl.reorder([idC, idA, idB])
    const list = pl.list()
    expect(list[0].id).toBe(idC)
    expect(list[1].id).toBe(idA)
    expect(list[2].id).toBe(idB)
  })
})

describe('UploadService', () => {
  it('saves an uploaded file and returns its metadata', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
fileRepo,
    })

    const buffer = silentMp3Frame()
    const result = await upload.save({
      buffer,
      originalName: 'test.mp3',
      getDuration: async () => 180,
    })

    expect(result.filename).toMatch(/\.mp3$/)
    expect(result.sizeBytes).toBe(buffer.length)
    expect(result.durationSec).toBe(180)
  })

  it('rejects files over max size', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 1,
      allowedExtensions: ['.mp3'],
fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.alloc(2 * 1024 * 1024), // 2MB
        originalName: 'big.mp3',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/too large/i)
  })

  it('rejects unsupported extensions', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.from('x'),
        originalName: 'test.exe',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/extension/)
  })

  it('rejects .mp3 file with text content', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
      fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.from('this is plain text content'),
        originalName: 'fake.mp3',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/magic bytes/)
  })

  it('rejects .flac file with text content', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.flac'],
      fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.from('not a flac file at all'),
        originalName: 'fake.flac',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/magic bytes/)
  })

  it('accepts .mp3 file with valid MP3 magic bytes', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
      fileRepo,
    })

    const buffer = Buffer.from([0xff, 0xfb, 0x10, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    const result = await upload.save({
      buffer,
      originalName: 'real.mp3',
      getDuration: async () => null,
    })
    expect(result.filename).toMatch(/\.mp3$/)
  })

  it('accepts .flac file with valid FLAC magic bytes', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.flac'],
      fileRepo,
    })

    const buffer = Buffer.from('fLaC' + 'x'.repeat(20))
    const result = await upload.save({
      buffer,
      originalName: 'real.flac',
      getDuration: async () => null,
    })
    expect(result.filename).toMatch(/\.flac$/)
  })

  it('accepts .wav file with valid WAV magic bytes', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.wav'],
      fileRepo,
    })

    const buffer = Buffer.from('RIFF' + '\x00\x00\x00\x00' + 'WAVE')
    const result = await upload.save({
      buffer,
      originalName: 'real.wav',
      getDuration: async () => null,
    })
    expect(result.filename).toMatch(/\.wav$/)
  })

  it('accepts .ogg file with valid OGG magic bytes', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.ogg'],
      fileRepo,
    })

    const buffer = Buffer.from('OggS' + '\x00'.repeat(20))
    const result = await upload.save({
      buffer,
      originalName: 'real.ogg',
      getDuration: async () => null,
    })
    expect(result.filename).toMatch(/\.ogg$/)
  })

  it('accepts .m4a file with valid M4A magic bytes', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.m4a'],
      fileRepo,
    })

    const buffer = Buffer.from('\x00\x00\x00\x00ftypM4A ')
    const result = await upload.save({
      buffer,
      originalName: 'real.m4a',
      getDuration: async () => null,
    })
    expect(result.filename).toMatch(/\.m4a$/)
  })

  it('accepts .aac file with valid AAC magic bytes', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.aac'],
      fileRepo,
    })

    const buffer = Buffer.from([0xff, 0xf1, 0x10, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    const result = await upload.save({
      buffer,
      originalName: 'real.aac',
      getDuration: async () => null,
    })
    expect(result.filename).toMatch(/\.aac$/)
  })

  it('rejects file that is too small for magic bytes detection', async () => {
    const fileRepo = new UploadedFilesRepo(db)
    const upload = new UploadService({
      uploadDir: join(tempDir, 'uploads'),
      maxFileSizeMB: 10,
      allowedExtensions: ['.mp3'],
      fileRepo,
    })

    await expect(
      upload.save({
        buffer: Buffer.from([0xff, 0xfb]),
        originalName: 'tiny.mp3',
        getDuration: async () => null,
      }),
    ).rejects.toThrow(/too small/)
  })
})
