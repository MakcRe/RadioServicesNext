import Keyv from 'keyv'
import { KeyvFile } from 'keyv-file'
import { dirname, resolve as resolvePath } from 'path'
import { mkdirSync, existsSync, statSync } from 'fs'

const STATE_KEY = 'selected_version'

const TTL_NEVER = 0

export interface FfmpegRuntimeState {
  getSelectedVersion(): Promise<string | null>
  setSelectedVersion(version: string): Promise<void>
  clearSelectedVersion(): Promise<void>
  close(): Promise<void>
}

export function createFfmpegRuntimeState(stateFilePath: string): FfmpegRuntimeState {
  // Ensure the state directory exists, handling cases where binRoot might be a file
  let stateDir = dirname(stateFilePath)
  // If stateDir is the same as the file path, use the parent
  if (stateDir === stateFilePath || !stateDir || stateDir === '.') {
    stateDir = '.'
  }
  if (stateDir !== '.' && !existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true })
  }
  const file = new KeyvFile({ filename: stateFilePath })
  const kv = new Keyv({ store: file, namespace: 'ffmpeg' })

  return {
    async getSelectedVersion(): Promise<string | null> {
      const v = await kv.get(STATE_KEY)
      return typeof v === 'string' && v.length > 0 ? v : null
    },

    async setSelectedVersion(version: string): Promise<void> {
      await kv.set(STATE_KEY, version, TTL_NEVER)
    },

    async clearSelectedVersion(): Promise<void> {
      await kv.delete(STATE_KEY)
    },

    async close(): Promise<void> {
      await kv.disconnect()
    },
  }
}

export function defaultStatePath(binRoot: string): string {
  // If binRoot is a file path (e.g., /path/to/ffmpeg), use the parent directory
  // This handles cases where binRoot points to a specific ffmpeg binary file
  try {
    const st = statSync(binRoot)
    if (st.isFile()) {
      return resolvePath(dirname(binRoot), '.state.json')
    }
  } catch {
    // binRoot doesn't exist yet - assume it's a directory
  }
  return resolvePath(binRoot, '.state.json')
}
