import pino from 'pino'
import { mkdirSync, existsSync, createWriteStream } from 'fs'
import { join } from 'path'

export function createLogger(logging: { directory: string; level: string }, date: Date = new Date()): pino.Logger {
  const dateStr = date.toISOString().slice(0, 10)
  const logDir = logging.directory
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, `${dateStr}.log`)

  return pino(
    { level: logging.level },
    pino.multistream([
      { stream: createWriteStream(logFile, { flags: 'a' }), level: logging.level },
      { stream: process.stdout, level: logging.level },
    ])
  )
}
