import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

let schemaCache: string | null = null

function loadSchema(): string {
  if (!schemaCache) {
    schemaCache = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  }
  return schemaCache
}

export async function initDb(path: string): Promise<Database.Database> {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec(loadSchema())
  return db
}
