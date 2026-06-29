import { describe, it, expect, vi } from 'vitest'
import { warnIfDefaultPassword, DEFAULT_SOURCE_PASSWORD } from '../../src/config.js'
import type { AppConfig } from '../../src/config.js'

function makeCfg(password: string): AppConfig {
  return {
    db: { path: 'x' },
    server: { host: '127.0.0.1', port: 8000 },
    auth: { sourcePassword: password },
    ffmpeg: { version: '7.1', sourceUrl: 'x' },
    archive: { directory: 'x', segmentDurationSec: 3600, retentionDays: 7, minFreeSpaceMB: 500 },
    playlist: { uploadDir: 'x', maxFileSizeMB: 500, allowedExtensions: ['.mp3'] },
    logging: { directory: 'x', level: 'info', retentionDays: 30 },
  }
}

describe('warnIfDefaultPassword', () => {
  it('warns when password equals default', () => {
    const logger = { warn: vi.fn() }
    warnIfDefaultPassword(makeCfg(DEFAULT_SOURCE_PASSWORD), logger as any)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][1]).toContain('SECURITY WARNING')
  })

  it('does not warn when password is changed', () => {
    const logger = { warn: vi.fn() }
    warnIfDefaultPassword(makeCfg('my-safe-password'), logger as any)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
