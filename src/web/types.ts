import type { AppConfig } from '../config.js'
import type { DownloadState } from '../services/ffmpeg-downloader.js'

// Re-export for convenience so web consumers don't reach into ../config.ts
export type { AppConfig, DownloadState }

// GET /api/status
export interface StatusResponse {
  broadcaster?: { isLive: boolean }
  listeners?: { count: number }
  ffmpeg?: FFmpegStatusSummary
}

export interface FFmpegStatusSummary {
  available: boolean
  source: 'bundled' | 'system' | 'override' | 'missing'
  path: string | null
  version: string | null
}

// GET /api/source/files
// POST /api/source/upload
export interface UploadedFile {
  id: number
  filename: string
  original_name: string
  size_bytes: number
  duration_sec: number | null
  uploaded_at: string
}

export interface UploadResponse {
  filename: string
  originalName: string
  sizeBytes: number
  durationSec: number | null
}

// GET /api/playlist
export interface PlaylistItem {
  id: number
  filename: string
  display_name: string
  duration_sec: number | null
  position: number
  added_at: string
}

// GET /api/listeners/current
export interface ListenerCurrentResponse {
  count: number
  listeners: ListenerLogRow[]
}

// GET /api/listeners/history?page&pageSize
export interface ListenerHistoryResponse {
  rows: ListenerLogRow[]
  total: number
  pageSize: number
}

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

// GET /api/archive/list
export interface ArchiveFile {
  filename: string
  sizeBytes: number
  mtime: string
}

// Generic { ok: true } response used by many PUT/DELETE/POST endpoints
export interface OkResponse {
  ok: true
}

// PUT /api/config  body: { key, value }
export type ConfigKey =
  | 'archive.directory'
  | 'archive.segmentDurationSec'
  | 'archive.retentionDays'
  | 'archive.minFreeSpaceMB'
  | 'playlist.uploadDir'
  | 'playlist.maxFileSizeMB'
  | 'playlist.allowedExtensions'
  | 'logging.directory'
  | 'logging.level'
  | 'logging.retentionDays'

export type ConfigValue = string | number | boolean | string[] | null

export interface ConfigResponse {
  server: { host: string; port: number }
  auth: { sourcePassword: string /* redacted */ }
  archive: {
    directory: string
    segmentDurationSec: number
    retentionDays: number
    minFreeSpaceMB: number
  }
  playlist: {
    uploadDir: string
    maxFileSizeMB: number
    allowedExtensions: string[]
  }
  logging: { directory: string; level: string; retentionDays: number }
  ffmpeg: { version: string; sourceUrl: string }
  stream: { pollIntervalMs: number; pollIntervalMaxMs: number }
}

// SSE event types from /api/ffmpeg/download/status
export type FfmpegDownloadEvent = DownloadState
