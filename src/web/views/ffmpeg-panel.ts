import { api, startFfmpegDownloadStream } from '../api-client.js'
import { $ } from '../ui.js'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

interface FfmpegStatus {
  available: boolean
  version: string
  source: string
  path: string
}

interface DownloadState {
  status: 'idle' | 'downloading' | 'installing' | 'done' | 'error'
  progress?: number
  message?: string
  error?: string
}

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
  `

  await loadFfmpegStatus()
}

async function loadFfmpegStatus(): Promise<void> {
  const statusContainer = $('#ffmpeg-status-content')
  const downloadContainer = $('#ffmpeg-download-content')

  try {
    const status: FfmpegStatus = await api.ffmpegStatus()

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
            <td class="text-mono">${escapeHtml(status.version || '--')}</td>
          </tr>
          <tr>
            <td class="text-muted">路径</td>
            <td class="text-mono">${escapeHtml(status.path || '--')}</td>
          </tr>
        </table>
      `
    }

    if (downloadContainer) {
      if (status.available) {
        downloadContainer.innerHTML = `
          <p class="text-success">✓ FFmpeg 已安装并可用</p>
        `
      } else {
        downloadContainer.innerHTML = `
          <p class="text-muted">FFmpeg 未安装，需要下载后才能使用录制功能。</p>
          <button class="btn" id="download-ffmpeg-btn">下载 FFmpeg</button>
          <div id="download-progress" class="download-progress"></div>
          ${isMac() ? '<p class="text-muted" style="margin-top: 1rem"><strong>提示：</strong> macOS 可能需要允许"任何来源"应用以运行 FFmpeg。请在终端运行：<code>sudo spctl --master-disable</code></p>' : ''}
        `

        const downloadBtn = $('#download-ffmpeg-btn')
        downloadBtn?.addEventListener('click', handleDownload)
      }
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
  const closeSSE = startFfmpegDownloadStream((state: DownloadState) => {
    if (!progressContainer) return

    switch (state.status) {
      case 'downloading':
        progressContainer.innerHTML = `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${state.progress || 0}%"></div>
          </div>
          <p class="text-muted">${escapeHtml(state.message || '下载中...')} ${state.progress || 0}%</p>
        `
        break
      case 'installing':
        progressContainer.innerHTML = `
          <p class="text-muted">${escapeHtml(state.message || '安装中...')}</p>
        `
        break
      case 'done':
        progressContainer.innerHTML = '<p class="text-success">✓ FFmpeg 安装成功！</p>'
        setTimeout(() => loadFfmpegStatus(), 1500)
        break
      case 'error':
        progressContainer.innerHTML = `<p class="text-error">✗ 安装失败: ${escapeHtml(state.error || '未知错误')}</p>`
        if (downloadBtn) {
          downloadBtn.disabled = false
          downloadBtn.textContent = '重试'
        }
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
