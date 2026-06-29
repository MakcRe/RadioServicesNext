import type { PlaylistRepo, PlaylistRow } from '../db/repos/playlist.repo.js'
import type { UploadedFilesRepo } from '../db/repos/uploaded-files.repo.js'

export interface AddSongInput {
  filename: string
  display_name: string
  duration_sec: number | null
}

export class PlaylistService {
  constructor(
    private repo: PlaylistRepo,
    private fileRepo: UploadedFilesRepo,
  ) {}

  add(input: AddSongInput): number {
    const file = this.fileRepo.getByFilename(input.filename)
    if (!file) throw new Error(`uploaded file not found: ${input.filename}`)

    const existing = this.repo.list()
    const row = this.repo.insert({
      ...input,
      position: existing.length + 1,
    })
    return row.id
  }

  list(): PlaylistRow[] {
    return this.repo.list()
  }

  remove(id: number): void {
    this.repo.delete(id)
    const remaining = this.repo.list().map((r) => r.id)
    if (remaining.length > 0) this.repo.reorder(remaining)
  }

  reorder(ids: number[]): void {
    this.repo.reorder(ids)
  }

  updateDisplay(id: number, displayName: string): void {
    this.repo.update(id, { display_name: displayName })
  }

  nextSong(): PlaylistRow | null {
    const list = this.repo.list()
    return list[0] ?? null
  }

  popFirst(): PlaylistRow | null {
    const first = this.nextSong()
    if (first) this.remove(first.id)
    return first
  }
}
