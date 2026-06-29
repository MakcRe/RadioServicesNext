import { Readable, PassThrough } from 'stream'
import { EventEmitter } from 'events'
import { RingBuffer } from './ring-buffer.js'

export interface ListenerConnection extends EventEmitter {
  write(chunk: Buffer): void
  readSnapshot(): Buffer
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
  private currentSession: { id: string } | null = null
  private onSourceEndHandler: (() => void) | null = null

  constructor(opts: BroadcasterOptions) {
    this.ringBuffer = new RingBuffer(opts.ringCapacity)
  }

  pipeFrom(stream: Readable, session?: { id: string }): void {
    this.detachSource()
    this.sourceStream = stream
    if (session) this.currentSession = session

    const processChunk = (chunk: Buffer) => {
      this.ringBuffer.push(chunk)
      for (const listener of this.listeners.values()) {
        listener.write(chunk)
      }
    }

    stream.on('data', processChunk)

    this.onSourceEndHandler = () => {
      this.sourceStream = null
      this.currentSession = null
      this.onSourceEndHandler = null
    }
    stream.on('end', this.onSourceEndHandler)
    stream.on('error', this.onSourceEndHandler)
  }

  private detachSource(): void {
    if (this.sourceStream && this.onSourceEndHandler) {
      this.sourceStream.off('end', this.onSourceEndHandler)
      this.sourceStream.off('error', this.onSourceEndHandler)
    }
    this.sourceStream = null
    this.currentSession = null
    this.onSourceEndHandler = null

    for (const listener of this.listeners.values()) {
      listener.end()
    }
    this.listeners.clear()
    this.ringBuffer.reset()
  }

  subscribe(): ListenerConnection {
    const snapshot = this.ringBuffer.readSnapshot()
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
}
