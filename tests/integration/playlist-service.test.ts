import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/db/sqlite.js'
import { PlaylistRepo } from '../../src/db/repos/playlist.repo.js'
import { UploadedFilesRepo } from '../../src/db/repos/uploaded-files.repo.js'
import { PlaylistService } from '../../src/services/playlist-service.js'
import { UploadService } from '../../src/services/upload-service.js'
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

    const buffer = Buffer.from('fake-mp3-content')
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
})
