import { UAParser } from 'ua-parser-js'
import type { ListenerLogsRepo, ListenerLogRow } from '../db/repos/listener-logs.repo.js'

export type DeviceType = 'desktop' | 'mobile' | 'bot' | 'other'

export interface ConnectInput {
  ip: string
  userAgent: string
  referer: string | null
}

export interface DeviceInfo {
  device_type: DeviceType | null
  device_os: string | null
  device_browser: string | null
}

function normalizeDeviceType(t: string | undefined): DeviceType {
  if (!t) return 'other'
  const lower = t.toLowerCase()
  if (lower === 'bot' || /bot|crawler|spider|headless/i.test(lower)) return 'bot'
  if (lower === 'mobile') return 'mobile'
  if (lower === 'desktop') return 'desktop'
  return 'other'
}

export class ListenerManager {
  constructor(private repo: ListenerLogsRepo) {}

  connect(input: ConnectInput): number {
    const device = this.parseDevice(input.userAgent)
    return this.repo.connect({
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
      device_type: device.device_type,
      device_os: device.device_os,
      device_browser: device.device_browser,
    })
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
      device_type: normalizeDeviceType(device.type),
      device_os: os.name ?? null,
      device_browser: browser.name ?? null,
    }
  }
}
