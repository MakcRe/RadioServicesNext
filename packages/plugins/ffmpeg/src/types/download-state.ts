export type DownloadState =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number; downloaded: number; total: number; speed: number }
  | { state: 'verifying'; message: string }
  | { state: 'extracting'; message: string }
  | { state: 'complete'; path: string; version: string }
  | { state: 'error'; message: string }

export type ProgressCallback = (state: DownloadState) => void
