import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import { Broadcaster } from '../../src/services/broadcaster.js'

describe('Broadcaster', () => {
  it('writes data to ring buffer and listeners', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })

    b.pipeFrom(source)
    const listener1 = b.subscribe()
    const listener2 = b.subscribe()

    source.push(Buffer.from('hello'))
    source.push(Buffer.from(' world'))

    await new Promise(resolve => setImmediate(resolve))

    expect(b.ringBufferSize()).toBe(11)
    expect(listener1.readSnapshot().toString()).toBe('hello world')
    expect(listener2.readSnapshot().toString()).toBe('hello world')
  })

  it('new listeners get ring buffer snapshot', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })
    b.pipeFrom(source)

    source.push(Buffer.from('pre-existing'))

    await new Promise(resolve => setImmediate(resolve))

    const listener = b.subscribe()
    const snapshot = listener.readSnapshot()
    expect(snapshot.toString()).toBe('pre-existing')

    source.push(Buffer.from(' new'))

    await new Promise(resolve => {
      listener.once('data', (chunk: Buffer) => {
        expect(snapshot.toString() + chunk.toString()).toBe('pre-existing new')
        resolve()
      })
    })
  })

  it('stops piping when source ends', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })
    b.pipeFrom(source)
    const listener = b.subscribe()

    source.push(Buffer.from('a'))
    source.push(null)

    await new Promise(resolve => setImmediate(resolve))

    expect(b.isLive()).toBe(false)
    expect(listener.readSnapshot().toString()).toBe('a')
  })
})
