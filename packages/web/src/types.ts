// Re-export shared types
export type { RadioConfig as AppConfig } from '@radio-services/shared'
// Download state type (mirrors server-side DownloadState)
export type DownloadState =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number; speed: number; downloaded: number; total: number }
  | { state: 'verifying'; message: string }
  | { state: 'extracting'; message: string }
  | { state: 'complete'; version: string; path: string }
  | { state: 'error'; message: string }

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

// GET /api/ffmpeg/versions
export interface FFmpegVersionsResponse {
  versions: string[]
  current: string | null
  recommended: string | null
  /** Project-relative path of the currently-active binary, when bundled. */
  currentPath: string | null
}

// POST /api/ffmpeg/select
export interface SelectVersionResponse {
  success: boolean
  message: string
  /** Whether the selected version is actually available right now. When
   *  `false`, the request still succeeded (selection persisted) but the
   *  bundled binary is missing on disk. */
  available: boolean
}

// GET /api/ffmpeg/remote-versions
export interface RemoteVersion {
  version: string
  installed: boolean
}
export interface RemoteVersionsResponse {
  versions: RemoteVersion[]
}
