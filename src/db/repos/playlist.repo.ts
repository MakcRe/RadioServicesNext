import type Database from 'better-sqlite3'

export interface PlaylistRow {
  id: number
  filename: string
  display_name: string
  duration_sec: number | null
  position: number
  added_at: string
}

export interface InsertPlaylistInput {
  filename: string
  display_name: string
  duration_sec: number | null
  position: number
}

export class PlaylistRepo {
  constructor(private db: Database.Database) {}

  insert(input: InsertPlaylistInput): PlaylistRow {
    const stmt = this.db.prepare(`
      INSERT INTO playlist (filename, display_name, duration_sec, position)
      VALUES (?, ?, ?, ?)
    `)
    const info = stmt.run(input.filename, input.display_name, input.duration_sec, input.position)
    return this.getById(Number(info.lastInsertRowid))!
  }

  getById(id: number): PlaylistRow | undefined {
    return this.db.prepare('SELECT * FROM playlist WHERE id = ?').get(id) as PlaylistRow | undefined
  }

  list(): PlaylistRow[] {
    return this.db.prepare('SELECT * FROM playlist ORDER BY position ASC').all() as PlaylistRow[]
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM playlist WHERE id = ?').run(id)
  }

  update(id: number, fields: Partial<Pick<InsertPlaylistInput, 'display_name' | 'duration_sec' | 'position'>>): void {
    const allowed = ['display_name', 'duration_sec', 'position'] as const
    const sets = Object.entries(fields)
      .filter(([k]) => allowed.includes(k as typeof allowed[number]))
      .map(([k]) => `${k} = ?`)
      .join(', ')
    if (!sets) return
    const values = Object.values(fields)
    this.db.prepare(`UPDATE playlist SET ${sets} WHERE id = ?`).run(...values, id)
  }

  reorder(ids: number[]): void {
    const stmt = this.db.prepare('UPDATE playlist SET position = ? WHERE id = ?')
    const tx = this.db.transaction((idList: number[]) => {
      idList.forEach((id, idx) => stmt.run(idx + 1, id))
    })
    tx(ids)
  }

  maxPosition(): number {
    const row = this.db.prepare('SELECT MAX(position) AS max FROM playlist').get() as { max: number | null }
    return row.max ?? 0
  }
}
