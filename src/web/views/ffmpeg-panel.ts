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

  await Promise.all([loadFfmpegStatus(), loadVersionSelector()])
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
      downloadContainer.innerHTML = renderDownloadSection(status)
      wireDownload(downloadContainer)
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
 * "下载安装"卡片按 FFmpegStatus.source 拆分渲染：
 * - bundled / override：✓ 已在项目内，正常使用
 * - system：临时用系统 ffmpeg（启动时下载失败回退到这里）。显示提示 + 仍可点击"重新下载"
 * - missing：完全没装，强制要求下载
 */
function renderDownloadSection(status: FFmpegStatusSummary): string {
  if (status.source === 'bundled' || status.source === 'override') {
    return `<p class="text-success">✓ FFmpeg 已安装并可用</p>`
  }

  if (status.source === 'system') {
    return `
      <p class="text-warning">⚠ 启动时下载失败，目前使用系统 FFmpeg。建议重新下载项目内版本以保证版本一致。</p>
      <button class="btn" id="download-ffmpeg-btn">下载项目内 FFmpeg</button>
      <div id="download-progress" class="download-progress"></div>
      ${isMac() ? '<p class="text-muted" style="margin-top: 1rem"><strong>提示：</strong> macOS 可能需要允许"任何来源"应用以运行 FFmpeg。请在终端运行：<code>sudo spctl --master-disable</code></p>' : ''}
    `
  }

  // missing
  return `
    <p class="text-muted">FFmpeg 未安装，需要下载后才能使用录制功能。</p>
    <button class="btn" id="download-ffmpeg-btn">下载 FFmpeg</button>
    <div id="download-progress" class="download-progress"></div>
    ${isMac() ? '<p class="text-muted" style="margin-top: 1rem"><strong>提示：</strong> macOS 可能需要允许"任何来源"应用以运行 FFmpeg。请在终端运行：<code>sudo spctl --master-disable</code></p>' : ''}
  `
}

function wireDownload(container: Element): void {
  const downloadBtn = container.querySelector<HTMLButtonElement>('#download-ffmpeg-btn')
  downloadBtn?.addEventListener('click', handleDownload)
}

async function handleDownload(): Promise<void> {
  const progressContainer = $('#download-progress')
  const downloadBtn = $('#download-ffmpeg-btn') as HTMLButtonElement | null

  if (!progressContainer) return

  if (downloadBtn) {
    downloadBtn.disabled = true
    downloadBtn.textContent = '下载中...'
  }

  // Trigger download on server
  try {
    await api.triggerFfmpegDownload()
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
          <p class="text-muted">下载中 ${(state.percent ?? 0).toFixed(1)}% · ${formatBytes(state.speed)}/s</p>
        `
        break
      case 'verifying':
      case 'extracting':
        progressContainer.innerHTML = `
          <p class="text-muted">${escapeHtml(state.message)}</p>
        `
        break
      case 'complete':
        progressContainer.innerHTML = '<p class="text-success">✓ FFmpeg 安装成功！</p>'
        setTimeout(() => loadFfmpegStatus(), 1500)
        break
      case 'error':
        progressContainer.innerHTML = `<p class="text-error">✗ 安装失败: ${escapeHtml(state.message)}</p>`
        if (downloadBtn) {
          downloadBtn.disabled = false
          downloadBtn.textContent = '重试'
        }
        break
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

function isMac(): boolean {
  return navigator.platform.toLowerCase().includes('mac')
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
        return `<option value="${escapeHtml(v)}">${escapeHtml(v)}${suffix}</option>`
      })
      .join('')

    container.innerHTML = `
      <p class="text-muted">已安装版本（按语义版本排序）：</p>
      <select id="ffmpeg-version-select" class="select">${options}</select>
      <button class="btn" id="switch-version-btn" style="margin-left: 0.5rem">切换版本</button>
      <p id="switch-hint" class="text-muted" style="margin-top: 0.5rem; display: none">
        ⚠ 版本切换将在下次服务启动后生效
      </p>
    `

    $('#switch-version-btn')?.addEventListener('click', handleVersionSwitch)
  } catch (err) {
    console.error('[ffmpeg-panel] versions error:', err)
    container.innerHTML = '<p class="text-muted">无法加载版本列表</p>'
  }
}

async function handleVersionSwitch(): Promise<void> {
  const select = $('#ffmpeg-version-select') as HTMLSelectElement | null
  const hint = $('#switch-hint') as HTMLElement | null
  const btn = $('#switch-version-btn') as HTMLButtonElement | null
  if (!select) return

  const version = select.value
  if (btn) {
    btn.disabled = true
    btn.textContent = '切换中...'
  }

  try {
    const result = await api.selectFfmpegVersion(version)
    if (result.success) {
      if (hint) hint.style.display = 'block'
      await loadFfmpegStatus()
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
