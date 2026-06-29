import { UAParser } from 'ua-parser-js'
import type { ListenerLogsRepo, ListenerLogRow } from '../db/repos/listener-logs.repo.js'

export interface ConnectInput {
  ip: string
  userAgent: string
  referer: string | null
}

export interface DeviceInfo {
  device_type: string | null
  device_os: string | null
  device_browser: string | null
}

export class ListenerManager {
  constructor(private repo: ListenerLogsRepo) {}

  connect(input: ConnectInput): number {
    const id = this.repo.connect({
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
    })

    const device = this.parseDevice(input.userAgent)
    this.repo.update(id, device)
    return id
  }

  disconnect(id: number): void {
    this.repo.disconnect(id)
  }

  countCurrent(): number {
    return this.repo.countCurrent()
  }

  current(): ListenerLogRow[] {
    return this.repo.current()
  }

  history(page: number, pageSize: number): { rows: ListenerLogRow[]; total: number } {
    return this.repo.history(page, pageSize)
  }

  private parseDevice(userAgent: string): DeviceInfo {
    const parser = new UAParser(userAgent)
    const device = parser.getDevice()
    const os = parser.getOS()
    const browser = parser.getBrowser()
    return {
      device_type: device.type ?? 'other',
      device_os: os.name ?? null,
      device_browser: browser.name ?? null,
    }
  }
}
