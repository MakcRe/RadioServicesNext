import { api } from '../api-client.js'
import { $, formatTimeAgo, formatDuration } from '../ui.js'

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

export async function renderListeners(container: Element): Promise<void> {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">当前在线</div>
      <div id="current-listeners">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">历史记录</div>
      <div id="history-listeners">
        <p class="text-muted">加载中...</p>
      </div>
      <div class="pagination" id="pagination">
        <button class="btn-small" id="prev-page" disabled>上一页</button>
        <span id="page-info">第 1 页</span>
        <button class="btn-small" id="next-page">下一页</button>
      </div>
    </div>
  `

  let currentPage = 1

  $('#prev-page')?.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage--
      await loadHistory(currentPage)
    }
  })

  $('#next-page')?.addEventListener('click', async () => {
    currentPage++
    await loadHistory(currentPage)
  })

  await Promise.all([loadCurrentListeners(), loadHistory(currentPage)])
}

async function loadCurrentListeners(): Promise<void> {
  const container = $('#current-listeners')
  if (!container) return

  try {
    const response = await api.currentListeners()
    const listeners = response?.listeners ?? []
    if (listeners.length === 0) {
      container.innerHTML = '<p class="text-muted">当前无听众在线</p>'
      return
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>IP地址</th>
            <th>连接时间</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          ${listeners
            .map(
              (l: any) => `
            <tr>
              <td class="text-mono">${escapeHtml(l.ip || '未知')}</td>
              <td>${l.connected_at ? formatTimeAgo(l.connected_at) : '--'}</td>
              <td class="text-muted">${escapeHtml(l.user_agent || '--')}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
      <p class="text-muted" style="margin-top: 0.5rem">共计 ${listeners.length} 位在线</p>
    `
  } catch (err) {
    container.innerHTML = '<p class="text-muted">加载失败</p>'
    console.error('[listeners] current load error:', err)
  }
}

async function loadHistory(page: number): Promise<void> {
  const container = $('#history-listeners')
  const pageInfo = $('#page-info')
  const prevBtn = $('#prev-page') as HTMLButtonElement | null
  const nextBtn = $('#next-page') as HTMLButtonElement | null

  if (!container) return

  try {
    const result = await api.historyListeners(page)
    const history = result?.rows ?? []
    const total = result?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / (result?.pageSize ?? 50)))

    if (!history || history.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无历史记录</p>'
      return
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>IP地址</th>
            <th>进入时间</th>
            <th>离开时间</th>
            <th>持续时长</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          ${history
            .map(
              (l: any) => `
            <tr>
              <td class="text-mono">${escapeHtml(l.ip || '未知')}</td>
              <td>${l.connected_at ? new Date(l.connected_at).toLocaleString('zh-CN') : '--'}</td>
              <td>${l.disconnected_at ? new Date(l.disconnected_at).toLocaleString('zh-CN') : '在线'}</td>
              <td>${l.duration_sec ? formatDuration(l.duration_sec) : '--'}</td>
              <td class="text-muted">${escapeHtml(l.user_agent || '--')}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `

    if (pageInfo) {
      pageInfo.textContent = `第 ${page} / ${totalPages} 页`
    }
    if (prevBtn) {
      prevBtn.disabled = page <= 1
    }
    if (nextBtn) {
      nextBtn.disabled = page >= totalPages
    }
  } catch (err) {
    container.innerHTML = '<p class="text-muted">加载失败</p>'
    console.error('[listeners] history load error:', err)
  }
}
