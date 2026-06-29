import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../../src/services/ring-buffer.js'

describe('RingBuffer', () => {
  it('initially empty', () => {
    const rb = new RingBuffer(1024)
    expect(rb.size()).toBe(0)
    expect(rb.readSnapshot().length).toBe(0)
  })

  it('pushes and reads back data', () => {
    const rb = new RingBuffer(1024)
    rb.push(Buffer.from('hello'))
    rb.push(Buffer.from(' world'))
    expect(rb.readSnapshot().toString()).toBe('hello world')
    expect(rb.size()).toBe(11)
  })

  it('overwrites oldest data when full', () => {
    const rb = new RingBuffer(8)
    rb.push(Buffer.from('AAAAAAAA'))    // 8 bytes, full
    rb.push(Buffer.from('BBBBBBBB'))    // overwrites all
    expect(rb.readSnapshot().toString()).toBe('BBBBBBBB')
    expect(rb.size()).toBe(8)
  })

  it('handles partial overwrites', () => {
    const rb = new RingBuffer(8)
    rb.push(Buffer.from('12345678'))   // full
    rb.push(Buffer.from('AB'))          // overwrites '12', now '345678AB'
    expect(rb.readSnapshot().toString()).toBe('345678AB')
  })

  it('handles push larger than capacity', () => {
    const rb = new RingBuffer(4)
    rb.push(Buffer.from('ABCDEFGH'))    // 8 bytes, only last 4 kept
    expect(rb.readSnapshot().toString()).toBe('EFGH')
    expect(rb.size()).toBe(4)
  })

  it('reset clears buffer', () => {
    const rb = new RingBuffer(16)
    rb.push(Buffer.from('test'))
    rb.reset()
    expect(rb.size()).toBe(0)
    expect(rb.readSnapshot().length).toBe(0)
  })

  it('handles many small pushes correctly', () => {
    const rb = new RingBuffer(16)
    for (let i = 0; i < 100; i++) rb.push(Buffer.from('a'))
    expect(rb.size()).toBe(16)
    expect(rb.readSnapshot().toString()).toBe('aaaaaaaaaaaaaaaa')
  })
})
