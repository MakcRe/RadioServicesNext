import { api, startFfmpegDownloadStream } from '../api-client.js'
import { $, escapeHtml, formatBytes } from '../ui.js'
import type { FFmpegStatusSummary, FfmpegDownloadEvent } from '../types.js'

export async function renderFfmpegPanel(container: Element): Promise<void> {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">FFmpeg 状态</div>
      <div id="ffmpeg-status-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">下载安装</div>
      <div id="ffmpeg-download-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">版本管理</div>
      <div id="ffmpeg-versions-content">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `

  await Promise.all([loadFfmpegStatus(), loadDownloadList(), loadVersionSelector()])
}

async function loadFfmpegStatus(): Promise<void> {
  const statusContainer = $('#ffmpeg-status-content')
  const downloadContainer = $('#ffmpeg-download-content')

  try {
    const status: FFmpegStatusSummary = await api.ffmpegStatus()

    if (statusContainer) {
      statusContainer.innerHTML = `
        <table>
          <tr>
            <td class="text-muted">可用状态</td>
            <td>
              <span class="status-indicator ${status.available ? 'active' : 'inactive'}"></span>
              ${status.available ? '已安装' : '未安装'}
            </td>
          </tr>
          <tr>
            <td class="text-muted">数据源</td>
            <td>${escapeHtml(status.source || '未知')}</td>
          </tr>
          <tr>
            <td class="text-muted">版本</td>
            <td class="text-mono">${escapeHtml(status.version ?? '--')}</td>
          </tr>
          <tr>
            <td class="text-muted">路径</td>
            <td class="text-mono">${escapeHtml(status.path ?? '--')}</td>
          </tr>
        </table>
      `
    }

    if (downloadContainer) {
      downloadContainer.innerHTML = ''
      await loadDownloadList()
    }
  } catch (err) {
    console.error('[ffmpeg-panel] status error:', err)
    if (statusContainer) {
      statusContainer.innerHTML = '<p class="text-muted">无法获取 FFmpeg 状态</p>'
    }
    if (downloadContainer) {
      downloadContainer.innerHTML = '<p class="text-muted">加载失败</p>'
    }
  }
}

/**
 * "可下载版本"列表 — 远程最新 5–10 个 release。本地已装的隐藏"下载"按钮。
 * 当 `installed: true` 时显示 "已安装" 灰色文字；否则显示 "下载" 按钮，触发
 * 走 SSE 进度条。下载成功后回调 `loadFfmpegStatus()` + `loadVersionSelector()`。
 *
 * macOS 提示块继续保留（与之前一致），仅在点击下载按钮时显示。
 */
async function loadDownloadList(): Promise<void> {
  const container = $('#ffmpeg-download-content')
  if (!container) return

  try {
    const { versions } = await api.listRemoteFfmpegVersions()
    if (versions.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无可下载的远程版本（网络不可达？）</p>'
      return
    }

    const items = versions
      .map((rv) => {
        const action = rv.installed
          ? `<span class="text-muted">已安装</span>`
          : `<button class="btn-small download-btn" data-version="${escapeHtml(rv.version)}">下载</button>`
        return `
          <li class="remote-version-item">
            <span class="text-mono">${escapeHtml(rv.version)}</span>
            ${action}
          </li>
        `
      })
      .join('')

    container.innerHTML = `
      <p class="text-muted">远程可下载版本（按版本号排序）：</p>
      <ul class="remote-version-list">${items}</ul>
      <div id="download-progress" class="download-progress"></div>
    `

    container.querySelectorAll<HTMLButtonElement>('.download-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const version = btn.dataset.version
        if (version) void handleDownload(version, btn)
      })
    })
  } catch (err) {
    console.error('[ffmpeg-panel] remote versions error:', err)
    container.innerHTML = '<p class="text-muted">无法加载远程版本列表</p>'
  }
}

async function handleDownload(version: string, btn: HTMLButtonElement): Promise<void> {
  const progressContainer = $('#download-progress')

  if (!progressContainer) return

  btn.disabled = true
  const originalText = btn.textContent
  btn.textContent = '下载中...'

  // Trigger download on server (specific version)
  try {
    await api.downloadFfmpegVersion(version)
  } catch (err) {
    console.error('[ffmpeg-panel] trigger error:', err)
  }

  // Listen for progress updates
  const closeSSE = startFfmpegDownloadStream((state: FfmpegDownloadEvent) => {
    if (!progressContainer) return

    switch (state.state) {
      case 'downloading':
        progressContainer.innerHTML = `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${state.percent || 0}%"></div>
          </div>
          <p class="text-muted">下载 ${escapeHtml(version)} 中 ${(state.percent ?? 0).toFixed(1)}% · ${formatBytes(state.speed)}/s</p>
        `
        break
      case 'verifying':
      case 'extracting':
        progressContainer.innerHTML = `
          <p class="text-muted">${escapeHtml(state.message)}</p>
        `
        break
      case 'complete':
        progressContainer.innerHTML = `<p class="text-success">✓ ${escapeHtml(version)} 安装成功</p>`
        // Re-fetch both panels so the new binary shows up in:
        // - "已安装版本" select list (with "current" badge)
        // - "远程可下载版本" list (installed=true → "已安装")
        setTimeout(() => {
          void Promise.all([loadFfmpegStatus(), loadDownloadList(), loadVersionSelector()])
        }, 800)
        closeSSE()
        return
      case 'error':
        progressContainer.innerHTML = `<p class="text-error">✗ 安装失败: ${escapeHtml(state.message)}</p>`
        btn.disabled = false
        btn.textContent = originalText
        closeSSE()
        return
      case 'idle':
        progressContainer.innerHTML = '<p class="text-muted">空闲</p>'
        break
    }
  })

  // Cleanup after some time if still idle
  setTimeout(() => {
    if (progressContainer.innerHTML.includes('下载中')) {
      closeSSE()
    }
  }, 300000)
}

async function loadVersionSelector(): Promise<void> {
  const container = $('#ffmpeg-versions-content')
  if (!container) return

  try {
    const data = await api.listFfmpegVersions()

    if (data.versions.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无已安装版本</p>'
      return
    }

    const options = data.versions
      .map((v) => {
        const suffix = [
          v === data.current ? '（当前）' : '',
          v === data.recommended ? ' ★' : '',
        ]
          .filter(Boolean)
          .join('')
        // Mark the active version so the browser displays it on first
        // render. `current` is whatever the manager actually picked up
        // (runtime state > config) — never a stale bundled default.
        return `<option value="${escapeHtml(v)}"${v === data.current ? ' selected' : ''}>${escapeHtml(v)}${suffix}</option>`
      })
      .join('')

    container.innerHTML = `
      <p class="text-muted">已安装版本（按语义版本排序）：</p>
      <div class="version-row">
        <select id="ffmpeg-version-select" class="select">${options}</select>
        <button class="btn" id="switch-version-btn">切换版本</button>
      </div>
      <p id="switch-feedback" class="text-muted" style="margin-top: 0.5rem; min-height: 1.2em"></p>
    `

    $('#switch-version-btn')?.addEventListener('click', handleVersionSwitch)
  } catch (err) {
    console.error('[ffmpeg-panel] versions error:', err)
    container.innerHTML = '<p class="text-muted">无法加载版本列表</p>'
  }
}

async function handleVersionSwitch(): Promise<void> {
  const select = $('#ffmpeg-version-select') as HTMLSelectElement | null
  const feedback = $('#switch-feedback')
  const btn = $('#switch-version-btn') as HTMLButtonElement | null
  if (!select) return

  const version = select.value
  if (feedback) feedback.textContent = ''
  if (btn) {
    btn.disabled = true
    btn.textContent = '切换中...'
  }

  try {
    const result = await api.selectFfmpegVersion(version)
    if (result.success) {
      if (feedback) {
        feedback.textContent = result.available
          ? `✓ 已切换到 ${version}（实时生效）`
          : `⚠ 已选择 ${version}，但该版本尚未安装`
        feedback.className = result.available ? 'text-success' : 'text-warning'
      }
      // Refresh both panels so the status table's path/version column and
      // the selector's "current" badge update consistently.
      await Promise.all([loadFfmpegStatus(), loadVersionSelector()])
    } else {
      alert(`切换失败: ${result.message}`)
    }
  } catch (err) {
    console.error('[ffmpeg-panel] switch error:', err)
    alert('切换失败，请重试')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = '切换版本'
    }
  }
}
