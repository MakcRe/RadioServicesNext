import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadConfig, type RadioConfig } from '@radio-services/shared'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-config-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads a valid YAML file', () => {
    const yaml = `
server:
  host: "127.0.0.1"
  port: 9000
auth:
  sourcePassword: "secret123"
archive:
  retentionDays: 14
`
    const cfgPath = join(tempDir, 'config.yaml')
    writeFileSync(cfgPath, yaml)

    const cfg: RadioConfig = loadConfig(cfgPath)
    expect(cfg.server.host).toBe('127.0.0.1')
    expect(cfg.server.port).toBe(9000)
    expect(cfg.auth.sourcePassword).toBe('secret123')
    expect(cfg.archive.retentionDays).toBe(14)
  })

  it('applies defaults when fields are missing', () => {
    const cfgPath = join(tempDir, 'config.yaml')
    writeFileSync(cfgPath, 'server:\n  port: 8000\n')

    const cfg = loadConfig(cfgPath)
    expect(cfg.server.host).toBe('0.0.0.0')
    expect(cfg.archive.retentionDays).toBe(7)
    expect(cfg.archive.segmentDurationSec).toBe(3600)
    expect(cfg.playlist.allowedExtensions).toContain('.mp3')
  })

  it('throws on missing file', () => {
    expect(() => loadConfig(join(tempDir, 'missing.yaml'))).toThrow()
  })

  it('env vars override file values', () => {
    const cfgPath = join(tempDir, 'config.yaml')
    writeFileSync(cfgPath, 'server:\n  port: 8000\n')

    process.env.RADIO_PORT = '9999'
    try {
      const cfg = loadConfig(cfgPath)
      expect(cfg.server.port).toBe(9999)
    } finally {
      delete process.env.RADIO_PORT
    }
  })
})
