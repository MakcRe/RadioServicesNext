import { describe, it, expect } from 'vitest'
import { buildDownloadUrl } from '../../src/services/ffmpeg-downloader.js'

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
