export interface ServerConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  sourcePassword: string;
}

export interface FfmpegConfig {
  version: string;
  sourceUrl: string;
}

export interface ArchiveConfig {
  directory: string;
  segmentDurationSec: number;
  retentionDays: number;
  minFreeSpaceMB: number;
}

export interface PlaylistConfig {
  uploadDir: string;
  maxFileSizeMB: number;
  allowedExtensions: string[];
}

export interface LoggingConfig {
  directory: string;
  level: string;
  retentionDays: number;
}

export interface StreamConfig {
  pollIntervalMs: number;
  pollIntervalMaxMs: number;
}

export interface RadioConfig {
  server: ServerConfig;
  auth: AuthConfig;
  ffmpeg: FfmpegConfig;
  archive: ArchiveConfig;
  playlist: PlaylistConfig;
  logging: LoggingConfig;
  stream: StreamConfig;
}
