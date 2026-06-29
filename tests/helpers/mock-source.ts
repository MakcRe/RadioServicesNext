import { Readable } from 'stream'
import { setTimeout as waitFor } from 'timers/promises'

/**
 * Generate a tiny valid MP3 silent frame.
 * 0xff, 0xfb is MPEG Audio Layer 3 frame sync
 * followed by valid frame header bytes and padding
 */
function silentMp3Frame(): Buffer {
  const header = Buffer.from([0xff, 0xfb, 0x10, 0x64])
  const rest = Buffer.alloc(65, 0)
  return Buffer.concat([header, rest])
}

export interface MockSourceResult {
  stream: Readable
  stop: () => void
}

/**
 * Create a mock audio source stream that emits MP3 frames for the given duration.
 */
export function mockSourceStream(durationMs: number): MockSourceResult {
  const stream = new Readable({ read() {} })
  let stopped = false
  let interval: NodeJS.Timeout | null = null
  let timer: NodeJS.Timeout | null = null

  const start = Date.now()

  interval = setInterval(() => {
    if (stopped) return
    if (Date.now() - start >= durationMs) {
      if (interval) clearInterval(interval)
      if (timer) clearTimeout(timer)
      stream.push(null)
      return
    }
    stream.push(silentMp3Frame())
  }, 100)

  timer = setTimeout(() => {
    if (interval) clearInterval(interval)
    if (!stopped) {
      stream.push(null)
    }
  }, durationMs)

  return {
    stream,
    stop() {
      stopped = true
      if (interval) clearInterval(interval)
      if (timer) clearTimeout(timer)
      stream.destroy()
    },
  }
}

/**
 * Generate a single valid MP3 frame (exported for use in tests).
 */
export { silentMp3Frame }
