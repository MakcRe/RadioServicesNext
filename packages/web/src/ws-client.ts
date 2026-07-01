export type WsEvent =
  | { type: 'source-start'; data: { sessionId: string; clientIp: string; startedAt: number } }
  | { type: 'source-end'; data: { sessionId: string } }
  | { type: 'listener-count'; data: { count: number } }
  | { type: 'archive-new'; data: { filename: string; duration: number } }
  | { type: 'ffmpeg-download'; data: { id: string; status: string; progress?: number } }
  | { type: 'config-changed'; data: { key: string } }

export type WsEventType = WsEvent['type']

export type WsHandler = (data: WsEvent['data']) => void

class WsClient {
  private ws: WebSocket | null = null
  private handlers: Map<WsEventType, Set<WsHandler>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private url: string

  constructor() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.url = `${protocol}//${location.host}/ws`
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.ws = new WebSocket(this.url)

    this.ws.addEventListener('open', () => {
      this.reconnectAttempts = 0
      console.debug('[ws] connected')
    })

    this.ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as WsEvent
        this.dispatch(message.type, message.data)
      } catch (err) {
        console.error('[ws] failed to parse message:', err)
      }
    })

    this.ws.addEventListener('close', () => {
      console.debug('[ws] disconnected')
      this.scheduleReconnect()
    })

    this.ws.addEventListener('error', (err) => {
      console.error('[ws] error:', err)
    })
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0
    this.ws?.close()
    this.ws = null
  }

  on<T extends WsEventType>(event: T, handler: WsHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)

    return () => {
      this.handlers.get(event)?.delete(handler)
    }
  }

  off<T extends WsEventType>(event: T, handler: WsHandler): void {
    this.handlers.get(event)?.delete(handler)
  }

  private dispatch(type: WsEventType, data: WsEvent['data']): void {
    this.handlers.get(type)?.forEach((handler) => {
      try {
        handler(data)
      } catch (err) {
        console.error(`[ws] handler error for ${type}:`, err)
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[ws] max reconnect attempts reached')
      return
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts++

    console.debug(`[ws] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    setTimeout(() => this.connect(), delay)
  }
}

export const wsClient = new WsClient()
