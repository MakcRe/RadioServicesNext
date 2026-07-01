export class RingBuffer {
  private buffer: Buffer
  private writePos = 0
  private bytesUsed = 0

  constructor(public readonly capacity: number) {
    this.buffer = Buffer.alloc(capacity)
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return

    if (chunk.length >= this.capacity) {
      const tail = chunk.subarray(chunk.length - this.capacity)
      tail.copy(this.buffer)
      this.writePos = 0
      this.bytesUsed = this.capacity
      return
    }

    const firstChunkSize = Math.min(chunk.length, this.capacity - this.writePos)
    chunk.copy(this.buffer, this.writePos, 0, firstChunkSize)
    if (chunk.length > firstChunkSize) {
      chunk.copy(this.buffer, 0, firstChunkSize, chunk.length)
    }
    this.writePos = (this.writePos + chunk.length) % this.capacity
    this.bytesUsed = Math.min(this.bytesUsed + chunk.length, this.capacity)
  }

  readSnapshot(): Buffer {
    if (this.bytesUsed === 0) return Buffer.alloc(0)
    if (this.bytesUsed < this.capacity) {
      return Buffer.from(this.buffer.subarray(0, this.bytesUsed))
    }
    const tail = Buffer.from(this.buffer.subarray(this.writePos))
    const head = Buffer.from(this.buffer.subarray(0, this.writePos))
    return Buffer.concat([tail, head])
  }

  size(): number {
    return this.bytesUsed
  }

  reset(): void {
    this.buffer = Buffer.alloc(this.capacity)
    this.writePos = 0
    this.bytesUsed = 0
  }
}
