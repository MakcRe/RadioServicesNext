import { $, $$, showToast } from '../ui.js'
import { api } from '../api-client.js'
import { wsClient } from '../ws-client.js'
import type { FFmpegStatusSummary, StatusResponse } from '../types.js'

export function initDashboard(): void {
  const container = $('#dashboard-view')
  if (container) {
    renderDashboard(container)
    loadDashboardData()
    setupWsListeners()
  }
}

function renderDashboard(container: Element): void {
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value" id="stat-live">
          <span class="status-indicator"></span>
          <span id="stat-live-text">--</span>
        </div>
        <div class="stat-label">直播状态</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-listeners">--</div>
        <div class="stat-label">当前听众</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-bitrate">--</div>
        <div class="stat-label">码率</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">FFmpeg 状态</div>
      <div id="ffmpeg-status">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">收听地址</div>
      <div class="stream-url">
        <code>/stream</code>
        <button class="copy-btn" data-copy="/stream">复制</button>
      </div>
      <div class="stream-url">
        <code>/live.mp3</code>
        <button class="copy-btn" data-copy="/live.mp3">复制</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">最近 10 个切片</div>
      <div class="segment-list" id="segment-list">
        <p class="text-muted">暂无切片</p>
      </div>
    </div>
  `

  // Copy button handlers
  $$('.copy-btn').forEach((btn: Element) => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy')
      if (text) {
        navigator.clipboard.writeText(location.origin + text)
        showToast('已复制到剪贴板', 'success')
      }
    })
  })
}

async function loadDashboardData(): Promise<void> {
  try {
    const [status, ffmpegStatus] = await Promise.all([
      api.status(),
      api.ffmpegStatus().catch(() => null),
    ])
    renderStatus(status)
    renderFfmpegStatus(ffmpegStatus)
  } catch (err) {
    console.error('[dashboard] failed to load:', err)
  }
}

function renderStatus(status: StatusResponse): void {
  const liveText = $('#stat-live-text')
  const liveContainer = $('#stat-live')
  const listenersEl = $('#stat-listeners')
  const bitrateEl = $('#stat-bitrate')
  const segmentList = $('#segment-list')

  if (liveText && liveContainer) {
    const isLive = Boolean(status.broadcaster?.isLive)
    liveText.textContent = isLive ? 'LIVE' : 'OFFLINE'
    liveContainer.className = `stat-value ${isLive ? 'text-success' : 'text-muted'}`
  }

  if (listenersEl) {
    listenersEl.textContent = String(status.listeners?.count ?? 0)
  }

  if (bitrateEl) {
    bitrateEl.textContent = '--'
  }

  if (segmentList) {
    segmentList.innerHTML = '<p class="text-muted">暂无切片</p>'
  }
}

function renderFfmpegStatus(status: FFmpegStatusSummary | null): void {
  const container = $('#ffmpeg-status')
  if (!container) return

  if (!status || !status.available) {
    container.innerHTML = '<p class="text-muted">FFmpeg 未安装或无法获取状态</p>'
    return
  }

  container.innerHTML = `
    <table>
      <tr>
        <td class="text-muted">数据源</td>
        <td class="text-mono">${status.source}</td>
      </tr>
      <tr>
        <td class="text-muted">版本</td>
        <td class="text-mono">${status.version ?? '未知'}</td>
      </tr>
      <tr>
        <td class="text-muted">路径</td>
        <td class="text-mono">${status.path ?? '未知'}</td>
      </tr>
    </table>
  `
}

function setupWsListeners(): void {
  wsClient.on('source-start', () => {
    loadDashboardData()
  })

  wsClient.on('source-end', () => {
    loadDashboardData()
  })

  wsClient.on('listener-count', () => {
    loadDashboardData()
  })

  wsClient.on('archive-new', () => {
    loadDashboardData()
  })
}
