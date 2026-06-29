import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/db/sqlite.js'
import { ListenerLogsRepo } from '../../src/db/repos/listener-logs.repo.js'
import { ListenerManager } from '../../src/services/listener-manager.js'
import type Database from 'better-sqlite3'

let tempDir: string
let dbPath: string
let db: Database.Database

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-lm-'))
  dbPath = join(tempDir, 'test.db')
  db = await initDb(dbPath)
})

afterEach(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ListenerManager', () => {
  it('records a connection', () => {
    const repo = new ListenerLogsRepo(db)
    const mgr = new ListenerManager(repo)

    const id = mgr.connect({
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh)',
      referer: null,
    })
    expect(id).toBeGreaterThan(0)
    expect(mgr.countCurrent()).toBe(1)
  })

  it('marks disconnect with device info', () => {
    const repo = new ListenerLogsRepo(db)
    const mgr = new ListenerManager(repo)

    const id = mgr.connect({
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      referer: 'https://example.com',
    })
    mgr.disconnect(id)

    const log = repo.getById(id)
    expect(log?.disconnected_at).not.toBeNull()
    expect(log?.device_os).toContain('Mac')
    expect(log?.device_browser).toBeTruthy()
    expect(log?.referer).toBe('https://example.com')
  })

  it('lists current and historical', () => {
    const repo = new ListenerLogsRepo(db)
    const mgr = new ListenerManager(repo)

    mgr.connect({ ip: '1.1.1.1', userAgent: '', referer: null })
    mgr.connect({ ip: '2.2.2.2', userAgent: '', referer: null })
    expect(mgr.current().length).toBe(2)
    expect(mgr.history(1, 10).total).toBe(2)
  })
})
