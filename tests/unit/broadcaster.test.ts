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
    b.pipeFrom(source, { id: 'test-session', startAt: new Date(), sourceType: 'other', userAgent: 'test', mountpoint: '/live' })

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

  it('keeps listeners alive when pipeFrom is called a second time', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source1 = new Readable({ read() {} })
    const source2 = new Readable({ read() {} })
    b.pipeFrom(source1)
    const listener = b.subscribe()
    let ended = false
    listener.on('end', () => { ended = true })

    source1.push(Buffer.from('first'))
    await new Promise(resolve => setImmediate(resolve))

    b.pipeFrom(source2, { id: 's2', startAt: new Date(), sourceType: 'other', userAgent: 'test', mountpoint: '/live' })

    // listener should NOT have been closed by the source switch
    expect(ended).toBe(false)
    expect(listener.readSnapshot().toString()).toBe('first')

    source2.push(Buffer.from(' second'))
    await new Promise(resolve => setImmediate(resolve))

    // listener must continue receiving new chunks without re-subscribing
    expect(listener.readSnapshot().toString()).toBe('first second')
  })

  it('resets ring buffer on second pipeFrom (clear-on-switch policy)', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source1 = new Readable({ read() {} })
    const source2 = new Readable({ read() {} })
    b.pipeFrom(source1)
    source1.push(Buffer.from('pre-fill'))
    await new Promise(resolve => setImmediate(resolve))
    expect(b.ringBufferSize()).toBe(8)

    b.pipeFrom(source2, { id: 's2', startAt: new Date(), sourceType: 'other', userAgent: 'test', mountpoint: '/live' })

    // ring buffer was reset; new content from source2 not pushed yet
    expect(b.ringBufferSize()).toBe(0)

    source2.push(Buffer.from('new'))
    await new Promise(resolve => setImmediate(resolve))
    expect(b.ringBufferSize()).toBe(3)
  })

  it('endAll closes every listener and clears the map', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })
    b.pipeFrom(source)
    const listener1 = b.subscribe()
    const listener2 = b.subscribe()
    // Drain consumers so PassThrough will actually emit 'close' / 'end'
    listener1.on('data', () => {})
    listener2.on('data', () => {})
    let ended1 = 0
    let ended2 = 0
    listener1.on('close', () => { ended1 += 1 })
    listener2.on('close', () => { ended2 += 1 })

    b.endAll()
    await new Promise(resolve => setImmediate(resolve))

    expect(ended1).toBe(1)
    expect(ended2).toBe(1)
    expect(b.isLive()).toBe(false)
    // Internal state must be fully reset for next session
    expect(b.ringBufferSize()).toBe(0)
  })

  it('endAll only acts on explicit call — does not fire on source end', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const source = new Readable({ read() {} })
    b.pipeFrom(source)
    const listener = b.subscribe()
    let ended = 0
    listener.on('end', () => { ended += 1 })

    source.push(Buffer.from('a'))
    source.push(null)
    await new Promise(resolve => setImmediate(resolve))

    expect(b.isLive()).toBe(false)
    // listener survives source-end (kept for next pipeFrom)
    expect(ended).toBe(0)
  })

  it('isLive is true during first pipeFrom, false after source end, true again on second pipeFrom', async () => {
    const b = new Broadcaster({ ringCapacity: 1024 })
    const s1 = new Readable({ read() {} })
    const s2 = new Readable({ read() {} })
    const session1 = { id: 's1', startAt: new Date(), sourceType: 'other', userAgent: 'test', mountpoint: '/live' }
    const session2 = { id: 's2', startAt: new Date(), sourceType: 'other', userAgent: 'test', mountpoint: '/live' }

    b.pipeFrom(s1, session1)
    expect(b.isLive()).toBe(true)

    s1.push(null)
    await new Promise(resolve => setImmediate(resolve))
    expect(b.isLive()).toBe(false)

    b.pipeFrom(s2, session2)
    expect(b.isLive()).toBe(true)
  })
})
