import type {
  ArchiveFile,
  ConfigResponse,
  FFmpegStatusSummary,
  FfmpegDownloadEvent,
  ListenerCurrentResponse,
  ListenerHistoryResponse,
  OkResponse,
  PlaylistItem,
  StatusResponse,
  UploadedFile,
  UploadResponse,
} from './types.js'

const BASE = ''

function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    return Promise.reject(new Error(`HTTP ${res.status}: ${res.statusText}`))
  }
  return res.json() as Promise<T>
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  return json<T>(res)
}

interface UploadedFilesResponse {
  files: UploadedFile[]
}

interface PlaylistResponse {
  items: PlaylistItem[]
}

interface ArchiveListResponse {
  files: ArchiveFile[]
}

interface SourceStartResponse {
  ok: true
}

export const api = {
  status: () => fetchJson<StatusResponse>(`${BASE}/api/status`),

  ffmpegStatus: () =>
    fetchJson<FFmpegStatusSummary>(`${BASE}/api/ffmpeg/status`),

  triggerFfmpegDownload: () =>
    fetchJson<OkResponse>(`${BASE}/api/ffmpeg/download`, { method: 'POST' }),

  sourceStart: (type: 'file' | 'playlist', id: number) =>
    fetchJson<SourceStartResponse>(`${BASE}/api/source/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
    }),

  sourceStop: () =>
    fetchJson<OkResponse>(`${BASE}/api/source/stop`, { method: 'POST' }),

  upload: async (file: File): Promise<UploadResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/api/source/upload`, {
      method: 'POST',
      body: formData,
    })
    return json<UploadResponse>(res)
  },

  listFiles: () =>
    fetchJson<UploadedFilesResponse>(`${BASE}/api/source/files`),

  deleteFile: (id: number) =>
    fetchJson<OkResponse>(
      `${BASE}/api/source/files/${id}`,
      { method: 'DELETE' },
    ),

  listPlaylist: () =>
    fetchJson<PlaylistResponse>(`${BASE}/api/playlist`),

  addToPlaylist: (
    filename: string,
    displayName: string,
    durationSec?: number | null,
  ) =>
    fetchJson<{ id: number }>(`${BASE}/api/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, displayName, durationSec }),
    }),

  deleteFromPlaylist: (id: number) =>
    fetchJson<OkResponse>(
      `${BASE}/api/playlist/${id}`,
      { method: 'DELETE' },
    ),

  reorderPlaylist: (ids: number[]) =>
    fetchJson<OkResponse>(`${BASE}/api/playlist/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),

  listArchive: () =>
    fetchJson<ArchiveListResponse>(`${BASE}/api/archive/list`),

  currentListeners: () =>
    fetchJson<ListenerCurrentResponse>(`${BASE}/api/listeners/current`),

  historyListeners: (page = 1) =>
    fetchJson<ListenerHistoryResponse>(
      `${BASE}/api/listeners/history?page=${page}`,
    ),

  config: () => fetchJson<ConfigResponse>(`${BASE}/api/config`),

  updateConfig: (
    key: string,
    // Config value can be primitive or array (allowedExtensions)
    value: string | number | boolean | string[] | null,
  ) =>
    fetchJson<OkResponse>(`${BASE}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }),
}

export function startFfmpegDownloadStream(
  onState: (s: FfmpegDownloadEvent) => void,
): () => void {
  const es = new EventSource(`${BASE}/api/ffmpeg/download/status`)
  es.onmessage = (e) => {
    try {
      onState(JSON.parse(e.data) as FfmpegDownloadEvent)
    } catch {}
  }
  return () => es.close()
}
