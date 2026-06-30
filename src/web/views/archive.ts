import { api } from '../api-client.js'
import { $, formatBytes, escapeHtml } from '../ui.js'
import type { ArchiveFile } from '../types.js'

export async function renderArchive(container: Element): Promise<void> {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">录制回放</div>
      <div id="archive-list">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `

  await loadArchive()
}

async function loadArchive(): Promise<void> {
  const container = $('#archive-list')
  if (!container) return

  try {
    const response = await api.listArchive()
    const archives = response?.files ?? []
    if (archives.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无录制回放</p>'
      return
    }

    // Group by date
    const grouped: Record<string, ArchiveFile[]> = {}
    for (const item of archives) {
      const date = new Date(item.mtime).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(item)
    }

    let html = ''
    for (const [date, items] of Object.entries(grouped)) {
      html += `
        <div class="archive-date-group">
          <h3 class="archive-date-title">${escapeHtml(date)}</h3>
          <div class="archive-list">
            ${items
              .map(
                (item: ArchiveFile) => `
              <div class="archive-item" data-name="${escapeHtml(item.filename)}">
                <div class="archive-info">
                  <span class="archive-name">${escapeHtml(item.filename)}</span>
                  <span class="archive-meta">${formatBytes(item.sizeBytes)}</span>
                  <span class="archive-meta">${new Date(item.mtime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="archive-actions">
                  <audio controls class="archive-audio">
                    <source src="/archive/${escapeHtml(item.filename)}" type="audio/mpeg">
                    您的浏览器不支持音频播放
                  </audio>
                  <a href="/archive/${escapeHtml(item.filename)}" download class="btn-small">下载</a>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
    }

    container.innerHTML = html
  } catch (err) {
    container.innerHTML = '<p class="text-muted">加载失败</p>'
    console.error('[archive] load error:', err)
  }
}
