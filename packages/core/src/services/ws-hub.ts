import { EventEmitter } from 'events'
import type { SourceSession } from './source-receiver.js'

export type DownloadState =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number; downloaded: number; total: number; speed: number }
  | { state: 'verifying'; message: string }
  | { state: 'extracting'; message: string }
  | { state: 'complete'; path: string; version: string }
  | { state: 'error'; message: string }

export interface EventMap {
  'source-start': SourceSession
  'source-end': { sessionId: string }
  'listener-count': number
  'archive-new': { filename: string; sizeBytes: number }
  'ffmpeg-download': DownloadState
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
