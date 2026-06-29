import { describe, it, expect } from 'vitest'
import { buildDownloadUrl } from '../../src/services/ffmpeg-downloader.js'
import { createHash } from 'crypto'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join, dirname } from 'path'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'

describe('verifySha256', () => {
  async function makeTempFile(contents: Buffer): Promise<string> {
    const tmp = await mkdtemp(join(tmpdir(), 'sha256-test-'))
    const filePath = join(tmp, 'archive.bin')
    await writeFile(filePath, contents)
    return filePath
  }

  function sha256Of(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex')
  }

  it('passes when hash matches', async () => {
    const data = Buffer.alloc(1024)
    data.write('hello world\n', 0, 'utf8')
    const expected = sha256Of(data)
    const filePath = await makeTempFile(data)
    try {
      const { verifySha256 } = await import('../../src/services/ffmpeg-downloader.js')
      await expect(verifySha256(filePath, expected)).resolves.toBeUndefined()
    } finally {
      await rm(dirname(filePath), { recursive: true, force: true })
    }
  })

  it('passes case-insensitively', async () => {
    const data = Buffer.alloc(1024)
    data.write('test data\n', 0, 'utf8')
    const lower = sha256Of(data)
    const upper = lower.toUpperCase()
    const filePath = await makeTempFile(data)
    try {
      const { verifySha256 } = await import('../../src/services/ffmpeg-downloader.js')
      await expect(verifySha256(filePath, upper)).resolves.toBeUndefined()
    } finally {
      await rm(dirname(filePath), { recursive: true, force: true })
    }
  })

  it('throws when hash does not match', async () => {
    const data = Buffer.alloc(1024)
    data.write('some content\n', 0, 'utf8')
    const wrongHash = sha256Of(Buffer.from('totally different content'))
    const filePath = await makeTempFile(data)
    try {
      const { verifySha256 } = await import('../../src/services/ffmpeg-downloader.js')
      await expect(verifySha256(filePath, wrongHash)).rejects.toThrow()
    } finally {
      await rm(dirname(filePath), { recursive: true, force: true })
    }
  })

  it('throws when file does not exist', async () => {
    const { verifySha256 } = await import('../../src/services/ffmpeg-downloader.js')
    await expect(
      verifySha256('/nonexistent/path/archive.tar.xz', 'a'.repeat(64)),
    ).rejects.toThrow()
  })

  it('throws when expected hash is not 64 hex characters', async () => {
    const { verifySha256 } = await import('../../src/services/ffmpeg-downloader.js')
    await expect(verifySha256('/any/path', 'not-a-valid-sha256')).rejects.toThrow(/invalid SHA256 format/i)
  })
})

describe('buildDownloadUrl', () => {
  const sourceUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'

  it('builds macOS arm64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'arm64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-macos64-gpl.tar.xz`)
  })

  it('builds macOS x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'x64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-macos64-gpl.tar.xz`)
  })

  it('builds Linux x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'linux', 'x64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-linux64-gpl.tar.xz`)
  })

  it('builds Linux arm64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'linux', 'arm64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`)
  })

  it('builds Windows x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'win32', 'x64')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-win64-gpl.zip`)
  })

  it('throws on unsupported platform', () => {
    expect(() => buildDownloadUrl(sourceUrl, 'freebsd', 'x64')).toThrow(/unsupported/i)
  })
})
