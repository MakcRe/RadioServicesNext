import { describe, it, expect, vi } from 'vitest'
import { buildDownloadUrl } from '@radio-services/plugins/ffmpeg'
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
      const { verifySha256 } = await import('@radio-services/plugins/ffmpeg')
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
      const { verifySha256 } = await import('@radio-services/plugins/ffmpeg')
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
      const { verifySha256 } = await import('@radio-services/plugins/ffmpeg')
      await expect(verifySha256(filePath, wrongHash)).rejects.toThrow()
    } finally {
      await rm(dirname(filePath), { recursive: true, force: true })
    }
  })

  it('throws when file does not exist', async () => {
    const { verifySha256 } = await import('@radio-services/plugins/ffmpeg')
    await expect(
      verifySha256('/nonexistent/path/archive.tar.xz', 'a'.repeat(64)),
    ).rejects.toThrow()
  })

  it('throws when expected hash is not 64 hex characters', async () => {
    const { verifySha256 } = await import('@radio-services/plugins/ffmpeg')
    await expect(verifySha256('/any/path', 'not-a-valid-sha256')).rejects.toThrow(/invalid SHA256 format/i)
  })
})

describe('buildDownloadUrl', () => {
  const sourceUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'

  it('builds macOS arm64 URL (osxexperts.net, BtbN dropped macOS in 2026)', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'arm64', '8.1')
    expect(url).toBe('https://www.osxexperts.net/ffmpeg81arm.zip')
  })

  it('builds macOS x86_64 URL (osxexperts.net)', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'x64', '8.0')
    expect(url).toBe('https://www.osxexperts.net/ffmpeg80intel.zip')
  })

  it('builds macOS URL with single-component version (e.g. 8)', () => {
    const url = buildDownloadUrl(sourceUrl, 'darwin', 'arm64', '8')
    expect(url).toBe('https://www.osxexperts.net/ffmpeg8arm.zip')
  })

  it('honours RADIO_FFMPEG_MAC_URL override for macOS', () => {
    const prev = process.env.RADIO_FFMPEG_MAC_URL
    process.env.RADIO_FFMPEG_MAC_URL = 'https://mirror.example/ffmpeg'
    try {
      expect(buildDownloadUrl(sourceUrl, 'darwin', 'arm64', '8.1')).toBe(
        'https://mirror.example/ffmpeg/ffmpeg81arm.zip',
      )
      expect(buildDownloadUrl(sourceUrl, 'darwin', 'x64', '8.0')).toBe(
        'https://mirror.example/ffmpeg/ffmpeg80intel.zip',
      )
    } finally {
      if (prev === undefined) delete process.env.RADIO_FFMPEG_MAC_URL
      else process.env.RADIO_FFMPEG_MAC_URL = prev
    }
  })

  it('builds Linux x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'linux', 'x64', '8.1.1')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-linux64-gpl.tar.xz`)
  })

  it('builds Linux arm64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'linux', 'arm64', '8.1.1')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`)
  })

  it('builds Windows x86_64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'win32', 'x64', '8.1.1')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-win64-gpl.zip`)
  })

  it('builds Windows arm64 URL', () => {
    const url = buildDownloadUrl(sourceUrl, 'win32', 'arm64', '8.1.1')
    expect(url).toBe(`${sourceUrl}/ffmpeg-master-latest-winarm64-gpl.zip`)
  })

  it('throws on unsupported platform', () => {
    expect(() => buildDownloadUrl(sourceUrl, 'freebsd', 'x64', '8.1.1')).toThrow(/unsupported/i)
  })
})

describe('resolveLatestFfmpegVersion', () => {
  // Stub global fetch so we don't depend on network in CI.
  function mockFetch(body: unknown, status = 200, contentType = 'application/json') {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response)
  }

  it('returns the highest nX.Y[.Z] tag from the BtbN tags API', async () => {
    const tags = [
      { name: 'n7.1' },
      { name: 'n7.1.2' },
      { name: 'n8.1' },
      { name: 'n8.1.1' },
      { name: 'latest' },          // ignored
      { name: 'autobuild-1234' },  // ignored
    ]
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch(tags) as unknown as typeof fetch
    try {
      const { resolveLatestFfmpegVersion } = await import('@radio-services/plugins/ffmpeg')
      const v = await resolveLatestFfmpegVersion('https://example.invalid/tags')
      expect(v).toBe('8.1.1')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('returns the highest version from osxexperts.net HTML (macOS)', async () => {
    const html = `
      <html><body>
        <a class="btn" href="https://www.osxexperts.net/ffmpeg80intel.zip">Download ffmpeg 8.0 (Intel)</a>
        <a class="btn" href="https://www.osxexperts.net/ffmpeg81arm.zip">Download ffmpeg 8.1 (Apple Silicon)</a>
        <a class="btn" href="https://www.osxexperts.net/ffmpeg79intel.zip">older 7.9</a>
      </body></html>
    `
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch(html, 200, 'text/html') as unknown as typeof fetch
    try {
      const { resolveLatestFfmpegVersion } = await import('@radio-services/plugins/ffmpeg')
      const v = await resolveLatestFfmpegVersion('https://www.osxexperts.net')
      expect(v).toBe('8.1')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('returns null on non-OK response', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch({}, 500) as unknown as typeof fetch
    try {
      const { resolveLatestFfmpegVersion } = await import('@radio-services/plugins/ffmpeg')
      expect(await resolveLatestFfmpegVersion('https://example.invalid/tags')).toBeNull()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('returns null on network error', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    try {
      const { resolveLatestFfmpegVersion } = await import('@radio-services/plugins/ffmpeg')
      expect(await resolveLatestFfmpegVersion('https://example.invalid/tags', 1000)).toBeNull()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('returns null when no nX.Y[.Z] tags are present', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch([{ name: 'latest' }]) as unknown as typeof fetch
    try {
      const { resolveLatestFfmpegVersion } = await import('@radio-services/plugins/ffmpeg')
      expect(await resolveLatestFfmpegVersion('https://example.invalid/tags')).toBeNull()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('returns null when osxexperts HTML has no ffmpegXX*.zip links', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch('<html><body>no ffmpeg here</body></html>', 200, 'text/html') as unknown as typeof fetch
    try {
      const { resolveLatestFfmpegVersion } = await import('@radio-services/plugins/ffmpeg')
      expect(await resolveLatestFfmpegVersion('https://www.osxexperts.net')).toBeNull()
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('listLatestRemoteVersions', () => {
  function mockFetch(body: unknown, status = 200, contentType = 'application/json') {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response)
  }

  it('returns up to `limit` versions, descending by semver, deduped by major.minor', async () => {
    const tags = [
      { name: 'n6.0' },
      { name: 'n7.1.2' },
      { name: 'n7.1.5' },   // patch wins, but major.minor stays 7.1
      { name: 'n8.1' },
      { name: 'n8.1.1' },
      { name: 'n9.0' },
      { name: 'latest' },     // ignored
    ]
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch(tags) as unknown as typeof fetch
    try {
      const { listLatestRemoteVersions } = await import('@radio-services/plugins/ffmpeg')
      const v = await listLatestRemoteVersions('https://example.invalid/tags', 3)
      // Top 3 distinct major.minor are 9.0, 8.1, 7.1 — each entry keeps
      // its highest patch so the UI can offer the freshest download.
      expect(v).toEqual(['9.0', '8.1.1', '7.1.5'])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('falls back to highest patch per major.minor pair', async () => {
    const tags = [
      { name: 'n7.1' },
      { name: 'n7.1.2' },
      { name: 'n7.1.5' },
      { name: 'n8.0' },
      { name: 'n8.0.3' },
    ]
    const realFetch = globalThis.fetch
    globalThis.fetch = mockFetch(tags) as unknown as typeof fetch
    try {
      const { listLatestRemoteVersions } = await import('@radio-services/plugins/ffmpeg')
      const v = await listLatestRemoteVersions('https://example.invalid/tags', 8)
      expect(v).toEqual(['8.0.3', '7.1.5'])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('returns an empty array when the remote is unreachable', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    try {
      const { listLatestRemoteVersions } = await import('@radio-services/plugins/ffmpeg')
      expect(await listLatestRemoteVersions('https://example.invalid/tags')).toEqual([])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
