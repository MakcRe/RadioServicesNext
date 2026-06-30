import { Readable, PassThrough } from 'stream'
import { EventEmitter } from 'events'
import { RingBuffer } from './ring-buffer.js'
import type { SourceSession } from './source-receiver.js'

export interface ListenerConnection extends EventEmitter {
  write(chunk: Buffer): void
  readSnapshot(): Buffer
  end(): void
}

class Listener extends PassThrough implements ListenerConnection {
  private snapshot: Buffer

  constructor(snapshot: Buffer) {
    super()
    this.snapshot = snapshot
  }

  override write(chunk: Buffer): boolean {
    this.snapshot = Buffer.concat([this.snapshot, chunk])
    return super.write(chunk)
  }

  override end(): this {
    super.end()
    return this
  }

  readSnapshot(): Buffer {
    return this.snapshot
  }
}

export interface BroadcasterOptions {
  ringCapacity: number
}

export class Broadcaster {
  private listeners = new Map<number, Listener>()
  private nextId = 1
  private ringBuffer: RingBuffer
  private sourceStream: Readable | null = null
  private currentSession: SourceSession | null = null
  private onSourceEndHandler: (() => void) | null = null

  constructor(opts: BroadcasterOptions) {
    this.ringBuffer = new RingBuffer(opts.ringCapacity)
  }

  pipeFrom(stream: Readable, session?: SourceSession): void {
    this.unbindSource()

    this.sourceStream = stream
    if (session) this.currentSession = session

    const processChunk = (chunk: Buffer) => {
      this.ringBuffer.push(chunk)
      for (const listener of this.listeners.values()) {
        listener.write(chunk)
      }
    }

    stream.on('data', processChunk)

    this.onSourceEndHandler = () => this.unbindSource()
    stream.on('end', this.onSourceEndHandler)
    stream.on('error', this.onSourceEndHandler)

    this.ringBuffer.reset()
  }

  /** Detach from current source WITHOUT closing listeners. Use on auto song-switch. */
  private unbindSource(): void {
    if (this.sourceStream && this.onSourceEndHandler) {
      this.sourceStream.off('end', this.onSourceEndHandler)
      this.sourceStream.off('error', this.onSourceEndHandler)
    }
    this.sourceStream = null
    this.currentSession = null
    this.onSourceEndHandler = null
    // listeners deliberately NOT closed — they survive across source switches
  }

  /** Close every listener and reset state. Use on explicit /api/source/stop. */
  endAll(): void {
    this.unbindSource()
    for (const listener of this.listeners.values()) {
      listener.end()
    }
    this.listeners.clear()
    this.ringBuffer.reset()
  }

  subscribe(): ListenerConnection {
    const snapshot = this.currentSession
      ? this.ringBuffer.readSnapshot()
      : Buffer.alloc(0)
    const listener = new Listener(snapshot)
    const id = this.nextId++
    this.listeners.set(id, listener)
    return listener
  }

  unsubscribe(listener: ListenerConnection): void {
    for (const [id, l] of this.listeners.entries()) {
      if (l === listener) {
        this.listeners.delete(id)
        return
      }
    }
  }

  ringBufferSize(): number {
    return this.ringBuffer.size()
  }

  isLive(): boolean {
    return this.currentSession !== null
  }

  getCurrentSession(): SourceSession | null {
    return this.currentSession
  }
}
