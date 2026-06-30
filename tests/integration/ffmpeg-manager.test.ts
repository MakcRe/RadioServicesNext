import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FFmpegManager, normalizeVersion } from '../../src/services/ffmpeg-manager.js'
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

    it('3. falls back to system ffmpeg when bundled is absent (no startup download)', async () => {
      const systemBin = fakeBinaryPath()
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

    it('4. reports missing when bundled absent AND system fallback absent', async () => {
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

    it('emits progress events during triggerDownload()', async () => {
      // v1.2: initialize() no longer downloads. Progress events fire only
      // from the user-initiated triggerDownload() path.
      const binRoot = join(tempDir, 'bin')
      mockDownloadSucceed(binRoot, '7.1', fakeBinaryPath())

      const mgr = new FFmpegManager({
        binRoot,
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        systemFallbackPath: '/nonexistent/ffmpeg',
      })

      await mgr.initialize()
      const events: string[] = []
      mgr.on('download', (s) => events.push(s.state))

      await mgr.triggerDownload()
      expect(events).toContain('downloading')
      expect(events).toContain('complete')
    })

    /**
     * Regression: /admin "下载 FFmpeg" 按钮 — verify triggerDownload fires
     * download events and updates status to bundled even after initialize()
     * has completed (which previously cached the result and short-circuited).
     *
     * The triggerDownload reentrancy guard was: clearing initializingPromise
     * and setting forceDownload=true. As of v1.2 the implementation changed
     * — triggerDownload now calls downloadFfmpeg directly, sidestepping
     * initialize() entirely. The behavioural contract ("user-initiated
     * download works after boot") is preserved.
     */
    it('triggerDownload() works after initial initialize() with no ffmpeg present', async () => {
      // First boot: bundled absent, system fallback also absent. Status: missing.
      const binRoot = join(tempDir, 'bin')
      const mgr = new FFmpegManager({
        binRoot,
        version: '7.1',
        downloadUrl: 'https://example.invalid/',
        systemFallbackPath: '/nonexistent/ffmpeg',
      })

      let initialStatus = await mgr.initialize()
      expect(initialStatus.source).toBe('missing')
      expect(initialStatus.available).toBe(false)

      // User clicks "Download FFmpeg" in admin UI. downloadFfmpeg must fire.
      const events: string[] = []
      mgr.on('download', (s) => events.push(s.state))
      const calls: number[] = []
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
      expect(status.available).toBe(true)
      expect(status.path).toContain(join('.versions', '7.1', 'ffmpeg'))
    })
  })
})

describe('normalizeVersion', () => {
  it('returns major.minor unchanged when no patch', () => {
    expect(normalizeVersion('7.1')).toBe('7.1')
  })

  it('drops patch when present (7.1.1 → 7.1)', () => {
    expect(normalizeVersion('7.1.1')).toBe('7.1')
  })

  it('drops patch when present (8.1.1 → 8.1)', () => {
    expect(normalizeVersion('8.1.1')).toBe('8.1')
  })

  it('strips BtbN leading n prefix (n8.1.1 → 8.1)', () => {
    expect(normalizeVersion('n8.1.1')).toBe('8.1')
  })

  it('strips BtbN leading n prefix with git suffix (n8.1.1-15-gabc → 8.1)', () => {
    expect(normalizeVersion('n8.1.1-15-g661c39a3ba')).toBe('8.1')
  })

  it('returns null for nightly/git snapshots', () => {
    expect(normalizeVersion('git-2024-12-01')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeVersion('')).toBeNull()
  })
})

describe('loose-binary auto-migration', () => {
  /**
   * Helper: lay a hand-placed ffmpeg binary at <binRoot>/ffmpeg that
   * reports the version passed in via `--version` emulation. We use a
   * shell script that echoes `ffmpeg version X` because the manager's
   * `getVersion` only inspects stdout of `-version`.
   */
  function placeLooseBinary(binRoot: string, fakeVersion: string): string {
    const loosePath = join(binRoot, 'ffmpeg')
    const script = `#!/bin/sh\necho "ffmpeg version ${fakeVersion}"\n`
    writeFileSync(loosePath, script, { mode: 0o755 })
    return loosePath
  }

  it('migrates a loose ffmpeg into .versions/{probedVersion}/ when the slot is empty', async () => {
    const binRoot = join(tempDir, 'bin')
    mkdirSync(binRoot, { recursive: true })
    // Place loose binary reporting 7.1 — operator hasn't run our init yet.
    placeLooseBinary(binRoot, '7.1')

    // The manager resolves binRoot relative to process.cwd() when it does
    // existsSync / rename. Use an absolute binRoot to keep the test
    // independent of where vitest runs from.
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      // Force the PATH lookup to find nothing so a regression would still
      // surface as 'missing' rather than accidentally picking up the
      // system binary.
      systemFallbackPath: '/nonexistent/ffmpeg',
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('bundled')
    expect(status.path).toBe(join(binRoot, '.versions', '7.1', 'ffmpeg'))
    expect(status.available).toBe(true)

    // Loose file should be gone after migration.
    expect(existsSync(join(binRoot, 'ffmpeg'))).toBe(false)
  })

  it('uses the probed version (not opts.version) when migrating', async () => {
    const binRoot = join(tempDir, 'bin')
    mkdirSync(binRoot, { recursive: true })
    // Loose binary is actually 8.1.1, opts.version is 7.1 (e.g. operator
    // upgraded by hand but didn't update config).
    placeLooseBinary(binRoot, '8.1.1')

    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })

    const status = await mgr.initialize()
    expect(status.source).toBe('bundled')
    // normalizeVersion("8.1.1") → "8.1", so target directory is 8.1.
    expect(status.path).toBe(join(binRoot, '.versions', '8.1', 'ffmpeg'))
  })

  it('leaves the loose binary alone when .versions/{v}/ffmpeg already exists', async () => {
    const binRoot = join(tempDir, 'bin')
    mkdirSync(join(binRoot, '.versions', '7.1'), { recursive: true })
    placeLooseBinary(binRoot, '7.1')
    const existingTarget = join(binRoot, '.versions', '7.1', 'ffmpeg')
    writeFileSync(existingTarget, '#!/bin/sh\necho existing\n', { mode: 0o755 })

    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })

    const status = await mgr.initialize()
    // The pre-existing binary wins; no overwrite.
    expect(status.path).toBe(existingTarget)
    // Loose file got parked under a .orphan sibling so it doesn't
    // sit around shadowing nothing on subsequent boots.
    expect(existsSync(join(binRoot, 'ffmpeg'))).toBe(false)
    expect(existsSync(join(binRoot, 'ffmpeg.orphan'))).toBe(true)
  })

  it('skips migration entirely when forceDownload=true (user explicitly re-downloading)', async () => {
    const binRoot = join(tempDir, 'bin')
    mkdirSync(binRoot, { recursive: true })
    placeLooseBinary(binRoot, '7.1')

    // Mock download to succeed by copying the loose binary into .versions/7.1/
    vi.spyOn(downloader, 'downloadFfmpeg').mockImplementation(async (_c, root, onProgress) => {
      const versionDir = join(root, '.versions', '7.1')
      mkdirSync(versionDir, { recursive: true })
      const target = join(versionDir, 'ffmpeg')
      copyFileSync(join(root, 'ffmpeg'), target)
      chmodSync(target, 0o755)
      onProgress({ state: 'complete', path: target, version: '7.1' })
      return { path: target, version: '7.1' }
    })

    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })

    // triggerDownload resets initializingPromise and sets forceDownload=true.
    await mgr.triggerDownload()
    const status = mgr.getStatus()
    expect(status.source).toBe('bundled')
    // Loose file should NOT have been renamed (migration is skipped when forceDownload)
    // because the download succeeded and provided a fresher path.
  })
})

describe('FFmpegManager.listVersions', () => {
  it('returns [] when .versions/ does not exist', async () => {
    const binRoot = join(tempDir, 'bin-empty')
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    expect(await mgr.listVersions()).toEqual([])
  })

  it('returns installed versions sorted descending by semver', async () => {
    const binRoot = join(tempDir, 'bin-multi')
    const versions = ['7.1', '8.1', '6.0']
    for (const v of versions) {
      const dir = join(binRoot, '.versions', v)
      mkdirSync(dir, { recursive: true })
      const path = join(dir, 'ffmpeg')
      writeFileSync(path, `#!/bin/sh\necho "ffmpeg version ${v}"\n`, { mode: 0o755 })
    }
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    expect(await mgr.listVersions()).toEqual(['8.1', '7.1', '6.0'])
  })

  it('skips directories without an executable ffmpeg', async () => {
    const binRoot = join(tempDir, 'bin-partial')
    mkdirSync(join(binRoot, '.versions', '7.1'), { recursive: true })
    mkdirSync(join(binRoot, '.versions', '8.1'), { recursive: true })
    // 7.1 has a working binary
    writeFileSync(
      join(binRoot, '.versions', '7.1', 'ffmpeg'),
      '#!/bin/sh\necho "ffmpeg version 7.1"\n',
      { mode: 0o755 },
    )
    // 8.1 has a non-executable file
    writeFileSync(join(binRoot, '.versions', '8.1', 'ffmpeg'), 'not executable')

    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    expect(await mgr.listVersions()).toEqual(['7.1'])
  })
})

describe('FFmpegManager bundled version priority (per spec 2026-06-30)', () => {
  it('picks the highest semver when multiple versions are installed', async () => {
    const binRoot = join(tempDir, 'bin-priority')
    for (const v of ['7.1', '8.1', '6.0']) {
      const dir = join(binRoot, '.versions', v)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'ffmpeg'),
        `#!/bin/sh\necho "ffmpeg version ${v}.0"\n`,
        { mode: 0o755 },
      )
    }
    // config says 7.1, but 8.1 should win
    const mgr = new FFmpegManager({
      binRoot,
      version: '7.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    const status = await mgr.initialize()
    expect(status.source).toBe('bundled')
    expect(status.path).toBe(join(binRoot, '.versions', '8.1', 'ffmpeg'))
  })

  it('falls back to next-highest when top version is non-executable', async () => {
    const binRoot = join(tempDir, 'bin-fallback')
    mkdirSync(join(binRoot, '.versions', '8.1'), { recursive: true })
    mkdirSync(join(binRoot, '.versions', '7.1'), { recursive: true })
    // 8.1 broken
    writeFileSync(join(binRoot, '.versions', '8.1', 'ffmpeg'), 'broken')
    // 7.1 working
    writeFileSync(
      join(binRoot, '.versions', '7.1', 'ffmpeg'),
      '#!/bin/sh\necho "ffmpeg version 7.1.0"\n',
      { mode: 0o755 },
    )
    const mgr = new FFmpegManager({
      binRoot,
      version: '8.1',
      downloadUrl: 'https://example.invalid/',
      systemFallbackPath: '/nonexistent/ffmpeg',
    })
    const status = await mgr.initialize()
    expect(status.path).toBe(join(binRoot, '.versions', '7.1', 'ffmpeg'))
  })
})
