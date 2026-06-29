const BASE = ''

function json(res: Response) {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

export const api = {
  status: () => fetch(`${BASE}/api/status`).then(json),

  ffmpegStatus: () => fetch(`${BASE}/api/ffmpeg/status`).then(json),

  triggerFfmpegDownload: () =>
    fetch(`${BASE}/api/ffmpeg/download`, { method: 'POST' }).then(json),

  sourceStart: (type: 'file' | 'playlist', id: number) =>
    fetch(`${BASE}/api/source/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
    }).then(json),

  sourceStop: () => fetch(`${BASE}/api/source/stop`, { method: 'POST' }).then(json),

  upload: async (file: File): Promise<any> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/api/source/upload`, {
      method: 'POST',
      body: formData,
    })
    return json(res)
  },

  listFiles: () => fetch(`${BASE}/api/source/files`).then(json),

  deleteFile: (id: number) =>
    fetch(`${BASE}/api/source/files/${id}`, { method: 'DELETE' }).then(json),

  listPlaylist: () => fetch(`${BASE}/api/playlist`).then(json),

  addToPlaylist: (filename: string, displayName: string, durationSec?: number) =>
    fetch(`${BASE}/api/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, displayName, durationSec }),
    }).then(json),

  deleteFromPlaylist: (id: number) =>
    fetch(`${BASE}/api/playlist/${id}`, { method: 'DELETE' }).then(json),

  reorderPlaylist: (ids: number[]) =>
    fetch(`${BASE}/api/playlist/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(json),

  listArchive: () => fetch(`${BASE}/api/archive/list`).then(json),

  currentListeners: () => fetch(`${BASE}/api/listeners/current`).then(json),

  historyListeners: (page = 1) =>
    fetch(`${BASE}/api/listeners/history?page=${page}`).then(json),

  config: () => fetch(`${BASE}/api/config`).then(json),

  updateConfig: (key: string, value: any) =>
    fetch(`${BASE}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).then(json),
}

export function startFfmpegDownloadStream(onState: (s: any) => void): () => void {
  const es = new EventSource(`${BASE}/api/ffmpeg/download/status`)
  es.onmessage = (e) => {
    try {
      onState(JSON.parse(e.data))
    } catch {}
  }
  return () => es.close()
}
