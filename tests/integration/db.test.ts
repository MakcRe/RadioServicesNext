import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/db/sqlite.js'
import { PlaylistRepo } from '../../src/db/repos/playlist.repo.js'
import { UploadedFilesRepo } from '../../src/db/repos/uploaded-files.repo.js'
import { ListenerLogsRepo } from '../../src/db/repos/listener-logs.repo.js'

let dbPath: string
let db: Awaited<ReturnType<typeof initDb>>

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'radio-db-'))
  dbPath = join(dir, 'test.db')
  db = await initDb(dbPath)
})

describe('PlaylistRepo', () => {
  it('inserts and lists songs in order', () => {
    const filesRepo = new UploadedFilesRepo(db)
    const repo = new PlaylistRepo(db)
    filesRepo.insert({ filename: 'a.mp3', original_name: 'a.mp3', size_bytes: 1024, duration_sec: null })
    filesRepo.insert({ filename: 'b.mp3', original_name: 'b.mp3', size_bytes: 1024, duration_sec: null })
    repo.insert({ filename: 'a.mp3', display_name: 'Song A', duration_sec: 180, position: 2 })
    repo.insert({ filename: 'b.mp3', display_name: 'Song B', duration_sec: 200, position: 1 })

    const all = repo.list()
    expect(all).toHaveLength(2)
    expect(all[0].display_name).toBe('Song B')
    expect(all[1].display_name).toBe('Song A')
  })

  it('updates position when reordered', () => {
    const filesRepo = new UploadedFilesRepo(db)
    const repo = new PlaylistRepo(db)
    filesRepo.insert({ filename: 'a.mp3', original_name: 'a.mp3', size_bytes: 1024, duration_sec: null })
    filesRepo.insert({ filename: 'b.mp3', original_name: 'b.mp3', size_bytes: 1024, duration_sec: null })
    const a = repo.insert({ filename: 'a.mp3', display_name: 'A', duration_sec: 100, position: 1 })
    const b = repo.insert({ filename: 'b.mp3', display_name: 'B', duration_sec: 100, position: 2 })

    repo.reorder([b.id, a.id])

    const all = repo.list()
    expect(all[0].id).toBe(b.id)
    expect(all[1].id).toBe(a.id)
  })
})

describe('UploadedFilesRepo', () => {
  it('inserts and deletes by id', () => {
    const repo = new UploadedFilesRepo(db)
    const id = repo.insert({
      filename: 'abc.mp3',
      original_name: 'test.mp3',
      size_bytes: 1024,
      duration_sec: null,
    })
    expect(repo.getById(id)?.filename).toBe('abc.mp3')
    repo.delete(id)
    expect(repo.getById(id)).toBeUndefined()
  })
})

describe('ListenerLogsRepo', () => {
  it('records connection and disconnect', () => {
    const repo = new ListenerLogsRepo(db)
    const id = repo.connect({
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      referer: null,
    })
    expect(id).toBeGreaterThan(0)
    repo.disconnect(id)
    const log = repo.getById(id)
    expect(log?.disconnected_at).not.toBeNull()
  })

  it('counts current (non-disconnected) listeners', () => {
    const repo = new ListenerLogsRepo(db)
    repo.connect({ ip: '1.1.1.1', userAgent: '', referer: null })
    repo.connect({ ip: '2.2.2.2', userAgent: '', referer: null })
    expect(repo.countCurrent()).toBe(2)
  })
})

afterEach(() => {
  db.close()
  rmSync(join(dbPath, '..'), { recursive: true, force: true })
})
