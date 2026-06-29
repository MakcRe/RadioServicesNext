import type Database from 'better-sqlite3'

export interface ListenerLogRow {
  id: number
  connected_at: string
  disconnected_at: string | null
  ip: string
  user_agent: string
  device_type: string | null
  device_os: string | null
  device_browser: string | null
  duration_sec: number | null
  referer: string | null
}

export interface ConnectInput {
  ip: string
  userAgent: string
  referer: string | null
  device_type?: string | null
  device_os?: string | null
  device_browser?: string | null
}

export class ListenerLogsRepo {
  constructor(private db: Database.Database) {}

  connect(input: ConnectInput): number {
    const info = this.db.prepare(`
      INSERT INTO listener_logs (ip, user_agent, referer, device_type, device_os, device_browser)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.ip,
      input.userAgent,
      input.referer,
      input.device_type ?? null,
      input.device_os ?? null,
      input.device_browser ?? null,
    )
    return Number(info.lastInsertRowid)
  }

  disconnect(id: number): void {
    this.db.prepare(`
      UPDATE listener_logs
      SET disconnected_at = CURRENT_TIMESTAMP,
          duration_sec = CAST((julianday('now') - julianday(connected_at)) * 86400 AS INTEGER)
      WHERE id = ? AND disconnected_at IS NULL
    `).run(id)
  }

  getById(id: number): ListenerLogRow | undefined {
    return this.db.prepare('SELECT * FROM listener_logs WHERE id = ?').get(id) as ListenerLogRow | undefined
  }

  countCurrent(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS c FROM listener_logs WHERE disconnected_at IS NULL
    `).get() as { c: number }
    return row.c
  }

  current(): ListenerLogRow[] {
    return this.db.prepare(`
      SELECT * FROM listener_logs WHERE disconnected_at IS NULL ORDER BY connected_at DESC
    `).all() as ListenerLogRow[]
  }

  history(page: number, pageSize: number): { rows: ListenerLogRow[]; total: number } {
    const offset = (page - 1) * pageSize
    const rows = this.db.prepare(`
      SELECT * FROM listener_logs ORDER BY connected_at DESC LIMIT ? OFFSET ?
    `).all(pageSize, offset) as ListenerLogRow[]
    const totalRow = this.db.prepare('SELECT COUNT(*) AS c FROM listener_logs').get() as { c: number }
    return { rows, total: totalRow.c }
  }

  update(id: number, fields: Partial<{
    device_type: string | null
    device_os: string | null
    device_browser: string | null
  }>): void {
    const keys = Object.keys(fields)
    if (keys.length === 0) return
    const sets = keys.map((k) => `${k} = ?`).join(', ')
    const values = keys.map((k) => (fields as Record<string, unknown>)[k])
    this.db.prepare(`UPDATE listener_logs SET ${sets} WHERE id = ?`).run(...values, id)
  }
}
