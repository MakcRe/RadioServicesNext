import { api } from '../api-client.js'
import { $, formatBytes } from '../ui.js'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

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
    const archives = await api.listArchive()
    if (!archives || archives.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无录制回放</p>'
      return
    }

    // Group by date
    const grouped: Record<string, typeof archives> = {}
    for (const item of archives) {
      const date = new Date(item.createdAt * 1000).toLocaleDateString('zh-CN', {
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
                (item: any) => `
              <div class="archive-item" data-name="${escapeHtml(item.name)}">
                <div class="archive-info">
                  <span class="archive-name">${escapeHtml(item.name)}</span>
                  <span class="archive-meta">${formatBytes(item.size)}</span>
                  <span class="archive-meta">${new Date(item.createdAt * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="archive-actions">
                  <audio controls class="archive-audio">
                    <source src="/archive/${escapeHtml(item.name)}" type="audio/mpeg">
                    您的浏览器不支持音频播放
                  </audio>
                  <a href="/archive/${escapeHtml(item.name)}" download class="btn-small">下载</a>
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
