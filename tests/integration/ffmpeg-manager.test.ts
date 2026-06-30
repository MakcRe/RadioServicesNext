import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FFmpegManager } from '../../src/services/ffmpeg-manager.js'
import * as downloader from '../../src/services/ffmpeg-downloader.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'radio-ffmpeg-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function fakeBinaryPath(): string {
  const path = join(tempDir, 'fake-ffmpeg.sh')
  writeFileSync(path, '#!/bin/sh\necho "ffmpeg version 7.1 fake"\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

/**
 * 把 manager 的"第 3 步：下载"替换为：把 fake binary 拷到
 * binRoot/.versions/{version}/ffmpeg 后返回 success。对应的失败版本
 * 直接 reject。
 */
function mockDownloadSucceed(binRoot: string, version: string, fakeBin: string): void {
  vi.spyOn(downloader, 'downloadFfmpeg').mockImplementation(async (_config, root, onProgress) => {
    const versionDir = join(root, '.versions', version)
    mkdirSync(versionDir, { recursive: true })
    const target = join(versionDir, 'ffmpeg')
    copyFileSync(fakeBin, target)
    chmodSync(target, 0o755)
    onProgress({
      state: 'downloading',
      percent: 100,
      downloaded: 1,
      total: 1,
      speed: 0,
    })
    onProgress({ state: 'complete', path: target, version })
    return { path: target, version }
  })
}

function mockDownloadFail(message = 'simulated download failure'): void {
  vi.spyOn(downloader, 'downloadFfmpeg').mockImplementation(async (_config, _root, onProgress) => {
    onProgress({ state: 'error', message })
    throw new Error(message)
  })
}

describe('FFmpegManager (per spec 2026-06-29 §3.1)', () => {
  describe('initialization priority', () => {
    it('1. uses override when ffmpegPathOverride is provided', async () => {
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

    it('2. uses bundled when .versions/{version}/ffmpeg already exists', async () => {
      const versionDir = join(tempDir, 'bin', '.versions', '7.1')
      const binFile = join(versionDir, 'ffmpeg')
      mkdirSync(versionDir, { recursive: true })
      const sourceBin = fakeBinaryPath()
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

    it('3. downloads from BtbN when bundled is absent and system binary exists (spec: project-bundled wins)', async () => {
      const systemBin = fakeBinaryPath()
      const binRoot = join(tempDir, 'bin')
      mockDownloadSucceed(binRoot, '7.1', fakeBinaryPath())

      const mgr = new FFmpegManager({
        binRoot,
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        systemFallbackPath: systemBin,
      })

      const status = await mgr.initialize()
      expect(status.source).toBe('bundled')
      expect(status.path).not.toBe(systemBin)
      expect(status.available).toBe(true)
    })

    it('4. falls back to system ffmpeg ONLY when download fails', async () => {
      const systemBin = fakeBinaryPath()
      mockDownloadFail()

      const mgr = new FFmpegManager({
        binRoot: join(tempDir, 'bin'),
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        systemFallbackPath: systemBin,
      })

      const status = await mgr.initialize()
      expect(status.source).toBe('system')
      expect(status.path).toBe(systemBin)
      expect(status.available).toBe(true)
    })

    it('5. reports missing when bundled absent, download fails, and no system binary', async () => {
      mockDownloadFail()

      const mgr = new FFmpegManager({
        binRoot: join(tempDir, 'bin'),
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        systemFallbackPath: '/nonexistent/ffmpeg',
      })

      const status = await mgr.initialize()
      expect(status.available).toBe(false)
      expect(status.source).toBe('missing')
      expect(status.path).toBe(null)
    })
  })

  describe('other behavior', () => {
    it('getStatus returns a snapshot not the internal reference', async () => {
      const bin = fakeBinaryPath()
      const mgr = new FFmpegManager({
        binRoot: join(tempDir, 'bin'),
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        ffmpegPathOverride: bin,
      })
      await mgr.initialize()
      const s1 = mgr.getStatus()
      s1.available = false
      expect(mgr.getStatus().available).toBe(true)
    })

    it('emits progress events during download', async () => {
      const binRoot = join(tempDir, 'bin')
      mockDownloadSucceed(binRoot, '7.1', fakeBinaryPath())

      const mgr = new FFmpegManager({
        binRoot,
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
      })

      const events: string[] = []
      mgr.on('download', (s) => events.push(s.state))

      await mgr.initialize()
      expect(events).toContain('downloading')
      expect(events).toContain('complete')
    })

    /**
     * Regression: /admin "下载 FFmpeg" 按钮失败问题
     *
     * 启动时 initialize() 完成后会缓存到 `initializingPromise`。
     * 之后任何 initialize() 调用都直接返回这个缓存的 promise — 即便
     * `forceDownload=true`。后果：POST /api/ffmpeg/download 触发后，doInitialize
     * 从未跑到 download 分支，downloadFfmpeg 永远不被调，SSE 上只看到初始的
     * { state: 'idle' }，前端面板无任何更新。
     *
     * triggerDownload() 必须能强制重跑，绕过缓存。
     */
    it('triggerDownload() forces a fresh download after initial initialize() (fixes SSE silent failure)', async () => {
      // 第一次启动：仅 system ffmpeg 可用；初始化走 bundled-miss → download-fail → system 分支
      const systemBin = fakeBinaryPath()
      mockDownloadFail('first-time download failed')

      const binRoot = join(tempDir, 'bin')
      const mgr = new FFmpegManager({
        binRoot,
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        systemFallbackPath: systemBin,
      })

      let initialStatus = await mgr.initialize()
      expect(initialStatus.source).toBe('system')

      // 第二次手动触发：网络恢复了。downloadFfmpeg 应当被调一次。
      const events: string[] = []
      mgr.on('download', (s) => events.push(s.state))
      const calls: number[] = []
      // 重新 spy — 之前的 mock 在 cross-test 状态可能丢
      vi.spyOn(downloader, 'downloadFfmpeg').mockImplementation(async (_c, root, onProgress) => {
        calls.push(Date.now())
        onProgress({
          state: 'downloading',
          percent: 100,
          downloaded: 1,
          total: 1,
          speed: 0,
        })
        const versionDir = join(root, '.versions', '7.1')
        mkdirSync(versionDir, { recursive: true })
        const target = join(versionDir, 'ffmpeg')
        copyFileSync(fakeBinaryPath(), target)
        chmodSync(target, 0o755)
        onProgress({ state: 'complete', path: target, version: '7.1' })
        return { path: target, version: '7.1' }
      })

      await mgr.triggerDownload()

      expect(calls.length).toBe(1)
      expect(events).toContain('downloading')
      expect(events).toContain('complete')
      const status = mgr.getStatus()
      expect(status.source).toBe('bundled')
      expect(status.path).not.toBe(systemBin)
    })
  })
})
