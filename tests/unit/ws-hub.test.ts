import { describe, it, expect, vi } from 'vitest'
import { WsHub, type EventMap } from '../../src/services/ws-hub.js'

describe('WsHub', () => {
  it('delivers events to subscribers', () => {
    const hub = new WsHub()
    const cb = vi.fn()

    hub.on('source-start', cb)
    hub.emit('source-start', { id: 's1' } as any)

    expect(cb).toHaveBeenCalledOnce()
    expect(cb.mock.calls[0][0]).toEqual({ id: 's1' })
  })

  it('supports multiple subscribers for one event', () => {
    const hub = new WsHub()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    hub.on('listener-count', cb1)
    hub.on('listener-count', cb2)
    hub.emit('listener-count', 42)

    expect(cb1).toHaveBeenCalledWith(42)
    expect(cb2).toHaveBeenCalledWith(42)
  })

  it('off() removes subscription', () => {
    const hub = new WsHub()
    const cb = vi.fn()

    hub.on('archive-new', cb)
    hub.off('archive-new', cb)
    hub.emit('archive-new', { filename: 'a.mp3' } as any)

    expect(cb).not.toHaveBeenCalled()
  })
})
