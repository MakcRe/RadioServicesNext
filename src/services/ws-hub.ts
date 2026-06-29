import { EventEmitter } from 'events'
import type { SourceSession } from './source-receiver.js'

export interface EventMap {
  'source-start': SourceSession
  'source-end': { sessionId: string }
  'listener-count': number
  'archive-new': { filename: string; sizeBytes: number }
  'ffmpeg-download': import('./ffmpeg-downloader.js').DownloadState
  'config-changed': { key: string }
}

export class WsHub extends EventEmitter {
  emitEvent<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emit(event, data)
  }

  off<K extends keyof EventMap>(event: K, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener)
  }
}
