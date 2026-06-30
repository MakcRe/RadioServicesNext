import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'
import type pino from 'pino'

export const DEFAULT_SOURCE_PASSWORD = 'hackme'

export interface ServerConfig {
  host: string
  port: number
}

export interface AuthConfig {
  sourcePassword: string
}

export interface FfmpegConfig {
  version: string
  sourceUrl: string
}

export interface ArchiveConfig {
  directory: string
  segmentDurationSec: number
  retentionDays: number
  minFreeSpaceMB: number
}

export interface PlaylistConfig {
  uploadDir: string
  maxFileSizeMB: number
  allowedExtensions: string[]
}

export interface LoggingConfig {
  directory: string
  level: string
  retentionDays: number
}

export interface DbConfig {
  path: string
}

export interface StreamConfig {
  /** Front-end (landing page) poll interval for /api/status, in milliseconds. */
  pollIntervalMs: number
  /** Hard upper bound the front-end should never exceed, in milliseconds. */
  pollIntervalMaxMs: number
}

export interface AppConfig {
  db: DbConfig
  server: ServerConfig
  auth: AuthConfig
  ffmpeg: FfmpegConfig
  archive: ArchiveConfig
  playlist: PlaylistConfig
  logging: LoggingConfig
  stream: StreamConfig
}

const DEFAULTS: AppConfig = {
  db: { path: 'data/radio.db' },
  server: { host: '0.0.0.0', port: 8000 },
  auth: { sourcePassword: 'hackme' },
  ffmpeg: {
    version: '7.1',
    sourceUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest',
  },
  archive: {
    directory: 'bin/archive',
    segmentDurationSec: 3600,
    retentionDays: 7,
    minFreeSpaceMB: 500,
  },
  playlist: {
    uploadDir: 'bin/uploads',
    maxFileSizeMB: 500,
    allowedExtensions: ['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac'],
  },
  logging: {
    directory: 'logs',
    level: 'info',
    retentionDays: 30,
  },
  stream: {
    pollIntervalMs: 5000,
    pollIntervalMaxMs: 30000,
  },
}

function deepMerge<T extends Record<string, any>>(base: T, override: any): T {
  const result: any = { ...base }
  for (const key of Object.keys(override ?? {})) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

function applyEnvOverrides(cfg: AppConfig): AppConfig {
  if (process.env.RADIO_PORT) cfg.server.port = Number(process.env.RADIO_PORT)
  if (process.env.RADIO_HOST) cfg.server.host = process.env.RADIO_HOST
  if (process.env.RADIO_SOURCE_PASSWORD) cfg.auth.sourcePassword = process.env.RADIO_SOURCE_PASSWORD
  if (process.env.RADIO_DB_PATH) cfg.db.path = process.env.RADIO_DB_PATH
  return cfg
}

export function loadConfig(path: string): AppConfig {
  if (!existsSync(path)) {
    throw new Error(`config file not found: ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  const parsed = (yaml.load(raw) as any) ?? {}
  const merged = deepMerge(DEFAULTS, parsed) as AppConfig
  return applyEnvOverrides(merged)
}

export function warnIfDefaultPassword(cfg: AppConfig, logger: pino.Logger): void {
  if (cfg.auth.sourcePassword === DEFAULT_SOURCE_PASSWORD) {
    logger.warn(
      { defaultPassword: DEFAULT_SOURCE_PASSWORD },
      'SECURITY WARNING: auth.sourcePassword is set to the default value. ' +
        'Change it before deploying to production!',
    )
  }
}
