import Keyv from 'keyv'
import { KeyvFile } from 'keyv-file'
import { dirname, resolve as resolvePath } from 'path'
import { mkdirSync } from 'fs'

/**
 * Runtime state for ffmpeg — separate from `config.yaml`.
 *
 * Why a separate file?
 *  - `config.yaml` is operator-managed; the user-selected ffmpeg version is
 *    a runtime choice triggered from the admin UI, not a deployment setting.
 *  - Persisting into `config.yaml` would couple UI actions to operator
 *    semantics and risk stomping on YAML formatting / comments.
 *  - This file lives under `bin/ffmpeg/.state.json` next to the binaries it
 *    describes, so wiping the binaries can clean up state in one shot.
 *
 * The store is implemented with `keyv` + `keyv-file`:
 *  - 0 runtime dependencies (keyv-file only depends on `tslib`).
 *  - Pluggable: if we ever want Redis/SQLite for multi-node, swap the store.
 *  - TTL/expiry support out of the box (unused for now; reserved for future
 *    "auto-reset to default after N days" if requested).
 */

const STATE_KEY = 'selected_version'

/**
 * `0` is the conventional "never expire" TTL in keyv — passing any other
 * number would be a bug here (the user's version selection is meant to
 * persist until explicitly cleared, not silently vanish after N days).
 *
 * See keyv-file's `set(key, value, ttl)` implementation: a TTL of 0 is
 * normalized to `undefined`, which `isExpired()` treats as "no expiry".
 */
const TTL_NEVER = 0

export interface FfmpegRuntimeState {
  /** Read the user-selected ffmpeg version, or `null` if not set. */
  getSelectedVersion(): Promise<string | null>
  /** Persist the user-selected ffmpeg version. */
  setSelectedVersion(version: string): Promise<void>
  /** Clear the user selection — reverts to config/network resolution. */
  clearSelectedVersion(): Promise<void>
  /** Disconnect underlying store (call on shutdown). */
  close(): Promise<void>
}

export function createFfmpegRuntimeState(stateFilePath: string): FfmpegRuntimeState {
  mkdirSync(dirname(stateFilePath), { recursive: true })
  const file = new KeyvFile({ filename: stateFilePath })
  const kv = new Keyv({ store: file, namespace: 'ffmpeg' })

  return {
    async getSelectedVersion(): Promise<string | null> {
      const v = await kv.get(STATE_KEY)
      return typeof v === 'string' && v.length > 0 ? v : null
    },

    async setSelectedVersion(version: string): Promise<void> {
      // `TTL_NEVER` (0 → undefined in keyv) ensures the entry survives
      // restarts and never silently expires. See `TTL_NEVER` above.
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

/** Default location: `bin/ffmpeg/.state.json` (next to the bundled binaries). */
export function defaultStatePath(binRoot: string): string {
  return resolvePath(binRoot, '.state.json')
}