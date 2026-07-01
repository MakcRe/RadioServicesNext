// Re-export all public APIs from the web package
export * from './types.js'
export { api, startFfmpegDownloadStream } from './api-client.js'
export { wsClient } from './ws-client.js'
export type { WsEvent, WsEventType, WsHandler } from './ws-client.js'
export {
  $,
  $$,
  escapeHtml,
  parseId,
  showToast,
  formatBytes,
  formatTimeAgo,
  formatDuration,
  getStatusClass,
  copyToClipboard,
  createElement,
} from './ui.js'
export { initDashboard } from './views/dashboard.js'
export { renderSource } from './views/source.js'
export { renderListeners } from './views/listeners.js'
export { renderArchive } from './views/archive.js'
export { renderFfmpegPanel } from './views/ffmpeg-panel.js'
