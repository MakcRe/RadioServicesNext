import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FFmpegManager } from '../../src/services/ffmpeg-manager.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-ffmpeg-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function fakeBinaryPath(): string {
  const path = join(tempDir, 'fake-ffmpeg.sh')
  writeFileSync(path, '#!/bin/sh\necho "ffmpeg version 7.1 fake"\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

describe('FFmpegManager', () => {
  it('uses a pre-installed binary when path is provided', async () => {
    const bin = fakeBinaryPath()
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      ffmpegPathOverride: bin,
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('override')
    expect(status.path).toBe(bin)
    expect(status.available).toBe(true)
  })

  it('falls back to system ffmpeg when version dir is empty and system binary exists', async () => {
    const bin = fakeBinaryPath()
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: bin,
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('system')
    expect(status.available).toBe(true)
  })

  it('reports missing when no binary is available', async () => {
    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })

    const status = await mgr.initialize()
    expect(status.available).toBe(false)
    expect(status.source).toBe('missing')
  })

  it('uses an already-downloaded bundled binary', async () => {
    const versionDir = join(tempDir, 'bin', '.versions', '7.1')
    const binFile = join(versionDir, 'ffmpeg')
    require('fs').mkdirSync(versionDir, { recursive: true })
    const sourceBin = fakeBinaryPath()
    const { copyFileSync } = require('fs')
    copyFileSync(sourceBin, binFile)
    chmodSync(binFile, 0o755)

    const mgr = new FFmpegManager({
      binRoot: join(tempDir, 'bin'),
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('bundled')
    expect(status.path).toBe(binFile)
    expect(status.available).toBe(true)
  })
})
