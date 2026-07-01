export const DEFAULT_SOURCE_PASSWORD = 'hackme'

import type {
  RadioConfig,
  ServerConfig,
  AuthConfig,
  FfmpegConfig,
  ArchiveConfig,
  PlaylistConfig,
  LoggingConfig,
  StreamConfig,
} from './types/config.js'

export type {
  RadioConfig,
  ServerConfig,
  AuthConfig,
  FfmpegConfig,
  ArchiveConfig,
  PlaylistConfig,
  LoggingConfig,
  StreamConfig,
}

const DEFAULTS: RadioConfig = {
  server: { host: '0.0.0.0', port: 8000 },
  auth: { sourcePassword: 'hackme' },
  ffmpeg: {
    version: process.platform === 'darwin' ? '8.1' : '7.1',
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

function applyEnvOverrides(cfg: RadioConfig): RadioConfig {
  if (process.env.RADIO_PORT) cfg.server.port = Number(process.env.RADIO_PORT)
  if (process.env.RADIO_HOST) cfg.server.host = process.env.RADIO_HOST
  if (process.env.RADIO_SOURCE_PASSWORD) cfg.auth.sourcePassword = process.env.RADIO_SOURCE_PASSWORD
  return cfg
}

export function loadConfig(path: string): RadioConfig {
  const { readFileSync, existsSync } = require('fs')
  if (!existsSync(path)) {
    throw new Error(`config file not found: ${path}`)
  }
  const yaml = require('js-yaml')
  const raw = readFileSync(path, 'utf8')
  const parsed = (yaml.load(raw) as any) ?? {}
  const merged = deepMerge(DEFAULTS, parsed) as RadioConfig
  return applyEnvOverrides(merged)
}

export interface Logger {
  warn(obj: object, msg: string): void
}

export function warnIfDefaultPassword(cfg: RadioConfig, logger: Logger): void {
  if (cfg.auth.sourcePassword === DEFAULT_SOURCE_PASSWORD) {
    logger.warn(
      { defaultPassword: DEFAULT_SOURCE_PASSWORD },
      'SECURITY WARNING: auth.sourcePassword is set to the default value. ' +
        'Change it before deploying to production!',
    )
  }
}
