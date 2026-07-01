import type Database from 'better-sqlite3'

export interface UploadedFileRow {
  id: number
  filename: string
  original_name: string
  size_bytes: number
  duration_sec: number | null
  uploaded_at: string
}

export interface InsertUploadedFileInput {
  filename: string
  original_name: string
  size_bytes: number
  duration_sec: number | null
}

export class UploadedFilesRepo {
  constructor(private db: Database.Database) {}

  insert(input: InsertUploadedFileInput): number {
    const info = this.db.prepare(`
      INSERT INTO uploaded_files (filename, original_name, size_bytes, duration_sec)
      VALUES (?, ?, ?, ?)
    `).run(input.filename, input.original_name, input.size_bytes, input.duration_sec)
    return Number(info.lastInsertRowid)
  }

  getById(id: number): UploadedFileRow | undefined {
    return this.db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(id) as UploadedFileRow | undefined
  }

  list(): UploadedFileRow[] {
    return this.db.prepare('SELECT * FROM uploaded_files ORDER BY uploaded_at DESC').all() as UploadedFileRow[]
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM uploaded_files WHERE id = ?').run(id)
  }

  getByFilename(filename: string): UploadedFileRow | undefined {
    return this.db.prepare('SELECT * FROM uploaded_files WHERE filename = ?').get(filename) as UploadedFileRow | undefined
  }
}
