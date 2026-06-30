import { mkdir, rm, chmod, rename } from 'fs/promises'
import { createWriteStream, createReadStream } from 'fs'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import type { AppConfig } from '../config.js'

export type DownloadState =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number; downloaded: number; total: number; speed: number }
  | { state: 'verifying'; message: string }
  | { state: 'extracting'; message: string }
  | { state: 'complete'; path: string; version: string }
  | { state: 'error'; message: string }

export type ProgressCallback = (state: DownloadState) => void

export async function verifySha256(archivePath: string, expectedSha256: string): Promise<void> {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    throw new Error('invalid SHA256 format from remote file')
  }
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(archivePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => {
      const actual = hash.digest('hex')
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        reject(new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actual}`))
      } else {
        resolve()
      }
    })
    stream.on('error', reject)
  })
}

export function buildDownloadUrl(
  sourceUrl: string,
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string {
  // macOS builds are NOT published by BtbN since 2026 — its README only ships
  // win64/winarm64 and linux64/linuxarm64. We use Helmut Tessarek's
  // osxexperts.net instead, which is the canonical macOS static build host
  // (also referenced by `ffmpeg-static`'s README).
  //
  // Filename convention on osxexperts.net:
  //   ffmpeg<majorMinor>{arm,intel}.zip
  // e.g. 8.1 → ffmpeg81arm.zip (Apple Silicon), 8.0 → ffmpeg80intel.zip (Intel)
  if (platform === 'darwin') {
    const macBase = process.env.RADIO_FFMPEG_MAC_URL ?? 'https://www.osxexperts.net'
    const [major, minor] = version.split('.')
    const majorMinor = `${major}${minor ?? ''}`
    const archTag = arch === 'arm64' ? 'arm' : 'intel'
    return `${macBase}/ffmpeg${majorMinor}${archTag}.zip`
  }
  if (platform === 'linux' && arch === 'x64') {
    return `${sourceUrl}/ffmpeg-master-latest-linux64-gpl.tar.xz`
  }
  if (platform === 'linux' && arch === 'arm64') {
    return `${sourceUrl}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`
  }
  if (platform === 'win32' && arch === 'x64') {
    return `${sourceUrl}/ffmpeg-master-latest-win64-gpl.zip`
  }
  if (platform === 'win32' && arch === 'arm64') {
    return `${sourceUrl}/ffmpeg-master-latest-winarm64-gpl.zip`
  }
  if (platform === 'linux' && arch === 'ia32') {
    return `${sourceUrl}/ffmpeg-master-latest-linux32-gpl.tar.xz`
  }
  throw new Error(`unsupported platform/arch: ${platform}/${arch}`)
}

/**
 * Resolve the latest published FFmpeg version.
 *
 * - macOS (osxexperts.net): the page lists `<a href="ffmpegXX<arm|intel>.zip">`
 *   links where `XX` is `<major><minor>` concatenated. Parse the highest.
 * - Other platforms (BtbN): tags look like `n7.1.2` or `n8.1.1` for stable
 *   releases (pre-release suffixes are skipped).
 *
 * Used at startup so macOS picks up a version that actually exists on the
 * publisher. Network failures are non-fatal — caller falls back to the
 * configured default.
 */
export async function resolveLatestFfmpegVersion(
  apiUrl = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/tags?per_page=100',
  timeoutMs = 3000,
): Promise<string | null> {
  const list = await listLatestRemoteVersions(apiUrl, 1, timeoutMs)
  return list[0] ?? null
}

/**
 * List the top-N most recent remote ffmpeg releases, descending by semver.
 *
 * `apiUrl` follows the same dual-protocol convention as
 * `resolveLatestFfmpegVersion`: BtbN's GitHub JSON tags list on
 * linux/windows, and osxexperts.net's HTML index on macOS (BtbN dropped
 * macOS support in 2026).
 *
 * Returns a deduplicated major.minor[.patch] list ordered highest-first.
 * The list never exceeds `limit` items and may be shorter if the remote
 * doesn't expose that many valid tags.
 */
export async function listLatestRemoteVersions(
  apiUrl = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/tags?per_page=100',
  limit = 8,
  timeoutMs = 3000,
): Promise<string[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(apiUrl, {
      signal: ac.signal,
      headers: { 'User-Agent': 'radio-services', Accept: 'application/json' },
    })
    if (!res.ok) return []

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const tags = (await res.json()) as Array<{ name: string }>
      type V = { major: number; minor: number; patch: number }
      const seen = new Map<string, V>()
      for (const t of tags) {
        const m = /^n(\d+)\.(\d+)(?:\.(\d+))?$/.exec(t.name)
        if (!m) continue
        const v: V = { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0 }
        const key = `${v.major}.${v.minor}`
        const cur = seen.get(key)
        if (!cur || cmp(v, cur) > 0) seen.set(key, v)
      }
      return [...seen.values()]
        .sort((a, b) => -cmp(a, b))
        .slice(0, limit)
        .map((v) => `${v.major}.${v.minor}${v.patch ? `.${v.patch}` : ''}`)
    }

    // osxexperts.net HTML page path. Deduplicate by major.minor since the
    // page lists both arm and intel zip files.
    const html = await res.text()
    const matches = html.matchAll(/ffmpeg(\d+)(\d+)(?:arm|intel)\.zip/gi)
    type P = { major: number; minor: number }
    const seenPair = new Map<string, P>()
    for (const m of matches) {
      const v: P = { major: +m[1], minor: +m[2] }
      const key = `${v.major}.${v.minor}`
      seenPair.set(key, v)
    }
    return [...seenPair.values()]
      .sort((a, b) => -cmpPair(a, b))
      .slice(0, limit)
      .map((v) => `${v.major}.${v.minor}`)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function cmp(a: { major: number; minor: number; patch: number }, b: { major: number; minor: number; patch: number }): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function cmpPair(a: { major: number; minor: number }, b: { major: number; minor: number }): number {
  if (a.major !== b.major) return a.major - b.major
  return a.minor - b.minor
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

async function downloadToFile(url: string, dest: string, onProgress: ProgressCallback): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`)
  }

  const total = Number(res.headers.get('content-length') ?? 0)
  let downloaded = 0
  let lastTickAt = Date.now()
  const startTime = Date.now()

  await mkdir(dirname(dest), { recursive: true })
  const fileStream = createWriteStream(dest)

  const reader = res.body.getReader()
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read()
      if (done) {
        this.push(null)
        return
      }
      downloaded += value.byteLength
      const now = Date.now()
      if (now - lastTickAt > 200 || downloaded === total) {
        const elapsedSec = (now - startTime) / 1000
        const speed = elapsedSec > 0 ? downloaded / elapsedSec : 0
        const percent = total > 0 ? (downloaded / total) * 100 : 0
        onProgress({
          state: 'downloading',
          percent,
          downloaded,
          total,
          speed,
        })
        lastTickAt = now
      }
      this.push(Buffer.from(value))
    },
  })

  await pipeline(nodeStream, fileStream)
}

async function extractTarXz(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xJf', archive, '-C', destDir, '--strip-components=1'], { stdio: 'inherit' })
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
    proc.on('error', reject)
  })
}

async function extractZip(archive: string, destDir: string): Promise<void> {
  const isWindows = process.platform === 'win32'

  if (isWindows) {
    await mkdir(destDir, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${archive}" -DestinationPath "${destDir}" -Force`,
      ], { stdio: 'inherit' })
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exited ${code}`))))
      proc.on('error', reject)
    })
    return
  }

  await mkdir(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('unzip', ['-q', archive, '-d', destDir], { stdio: 'inherit' })
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))))
    proc.on('error', reject)
  })
}

async function findBinary(startDir: string, binary: string): Promise<string> {
  const { readdir } = await import('fs/promises')
  async function search(dir: string, depth: number): Promise<string | null> {
    if (depth > 4) return null
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name === binary) return full
      if (entry.isDirectory()) {
        const found = await search(full, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  const found = await search(startDir, 0)
  if (!found) throw new Error(`binary not found in ${startDir}`)
  return found
}

export async function downloadFfmpeg(
  config: AppConfig,
  binRoot: string = 'bin/ffmpeg',
  onProgress: ProgressCallback = () => {},
  /** Override the version to download. When omitted, uses `config.ffmpeg.version`. */
  requestedVersion?: string,
): Promise<{ path: string; version: string }> {
  const version = requestedVersion ?? config.ffmpeg.version
  const versionDir = join(binRoot, '.versions', version)
  const binary = binaryName(process.platform)
  const targetPath = join(versionDir, binary)

  if (existsSync(targetPath)) {
    onProgress({ state: 'complete', path: targetPath, version })
    return { path: targetPath, version }
  }

  const url = buildDownloadUrl(config.ffmpeg.sourceUrl, process.platform, process.arch, version)
  const downloadsDir = join(binRoot, '.downloads')
  await mkdir(downloadsDir, { recursive: true })

  const isMac = process.platform === 'darwin'
  const archiveFile = join(
    downloadsDir,
    `ffmpeg-${version}${process.platform === 'win32' || isMac ? '.zip' : '.tar.xz'}`,
  )
  const tempFile = archiveFile + '.part'
  let extractDir = ''

  try {
    onProgress({ state: 'downloading', percent: 0, downloaded: 0, total: 0, speed: 0 })
    await downloadToFile(url, tempFile, onProgress)

    // macOS builds (osxexperts.net) don't ship a SHA256 sidecar — skip
    // verification on that path. The download URL is pinned to HTTPS and the
    // publisher (Helmut Tessarek) signs the release page.
    if (!isMac) {
      onProgress({ state: 'verifying', message: 'verifying archive SHA256' })
      const sha256Url = url + '.sha256'
      const sha256Res = await fetch(sha256Url)
      if (!sha256Res.ok) {
        throw new Error(`failed to fetch SHA256 file: HTTP ${sha256Res.status}`)
      }
      const sha256Text = await sha256Res.text()
      const expectedSha256 = sha256Text.trim().split(/\s+/)[0]
      await verifySha256(tempFile, expectedSha256)
    }

    onProgress({ state: 'extracting', message: 'extracting archive' })
    extractDir = join(downloadsDir, `extract-${version}`)
    await mkdir(extractDir, { recursive: true })

    if (process.platform === 'win32' || isMac) {
      await extractZip(tempFile, extractDir)
    } else {
      await extractTarXz(tempFile, extractDir)
    }

    const innerBinary = await findBinary(extractDir, binary)

    await mkdir(versionDir, { recursive: true })
    await rename(innerBinary, targetPath)

    if (process.platform === 'win32') {
      const binDir = dirname(innerBinary)
      const dlls = await (await import('fs/promises')).readdir(binDir)
      for (const f of dlls) {
        if (f.endsWith('.dll')) {
          await rename(join(binDir, f), join(versionDir, f)).catch(() => {})
        }
      }
    }

    if (process.platform !== 'win32') {
      await chmod(targetPath, 0o755)
    }

    await rm(tempFile, { force: true })
    await rm(extractDir, { recursive: true, force: true })

    onProgress({ state: 'complete', path: targetPath, version })
    return { path: targetPath, version }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('SHA256 mismatch')) {
      onProgress({ state: 'error', message: 'sha256 mismatch' })
    } else {
      onProgress({ state: 'error', message: msg })
    }
    await rm(tempFile, { force: true })
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

export async function ffmpegSymlinkPath(binRoot: string, version: string, platform: NodeJS.Platform): Promise<string> {
  const binary = binaryName(platform)
  const target = join(binRoot, '.versions', version, binary)
  if (!existsSync(target)) throw new Error(`binary not installed: ${target}`)
  return target
}
