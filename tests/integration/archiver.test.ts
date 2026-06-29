import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, utimesSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { Archiver } from '../../src/services/archiver.js'

let tempDir: string
let archiveDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-arch-'))
  archiveDir = join(tempDir, 'archive')
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function fakeFfmpeg(): string {
  const dir = join(tempDir, 'ff')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'ffmpeg')
  // Fake ffmpeg: since spawn is called with cwd: archiveDir,
  // we just create a marker file in the current working directory.
  writeFileSync(
    path,
    `#!/bin/sh
# Fake ffmpeg: write a placeholder marker file to cwd, then exit.
printf 'ID3' > "./.tmp_marker_$$"
exit 0
`,
  )
  chmodSync(path, 0o755)
  return path
}

describe('Archiver', () => {
  it('starts a ffmpeg subprocess when given a source stream', async () => {
    const ffmpegPath = fakeFfmpeg()
    const archiver = new Archiver({
      ffmpegPath,
      archiveDir,
      segmentDurationSec: 3600,
      retentionDays: 7,
    })

    const source = new PassThrough()
    await archiver.start(source)

    source.write(Buffer.from([0xff, 0xfb]))
    await new Promise((r) => setTimeout(r, 200))

    expect(existsSync(archiveDir)).toBe(true)

    await archiver.stop()
  })

  it('cleans up files older than retention', async () => {
    const archiver = new Archiver({
      ffmpegPath: '/bin/true',
      archiveDir,
      segmentDurationSec: 3600,
      retentionDays: 7,
    })

    mkdirSync(archiveDir, { recursive: true })

    const now = Date.now()
    const oldFile = join(archiveDir, '2025-01-01-12.mp3')
    const newFile = join(archiveDir, '2026-06-29-12.mp3')
    writeFileSync(oldFile, 'old')
    writeFileSync(newFile, 'new')

    const oldTime = new Date(now - 30 * 24 * 60 * 60 * 1000)
    utimesSync(oldFile, oldTime, oldTime)

    await archiver.cleanup()

    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(newFile)).toBe(true)
  })
})
