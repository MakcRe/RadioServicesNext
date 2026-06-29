import { $, $$ } from './ui.js'
import { wsClient } from './ws-client.js'
import { api } from './api-client.js'
import { initDashboard } from './views/dashboard.js'

type TabId = 'dashboard' | 'source' | 'listeners' | 'archive' | 'ffmpeg'

function initTabs(): void {
  const tabButtons = $$('.tab-button') as HTMLButtonElement[]

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab') as TabId

      tabButtons.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')

      const panels = $$('.tab-panel') as HTMLElement[]
      panels.forEach((panel) => panel.classList.remove('active'))

      const targetPanel = $(`#${tabId}-view`)
      if (targetPanel) {
        targetPanel.classList.add('active')
      }
    })
  })
}

function initView(tabId: TabId): void {
  switch (tabId) {
    case 'dashboard':
      initDashboard()
      break
    case 'source':
      initSourceView()
      break
    case 'listeners':
      initListenersView()
      break
    case 'archive':
      initArchiveView()
      break
    case 'ffmpeg':
      initConfigView()
      break
  }
}

function initSourceView(): void {
  const container = $('#source-view')
  if (!container) return

  container.innerHTML = `
    <div class="card">
      <div class="card-title">推流设置</div>
      <p class="text-muted">推流地址：<code class="text-mono">${location.protocol}//${location.host}/stream</code></p>
      <p class="text-muted mt-2">当前状态：<span id="source-status-badge">--</span></p>
    </div>
  `

  wsClient.on('source-start', () => {
    const badge = $('#source-status-badge')
    if (badge) {
      badge.innerHTML = '<span class="status-badge active">已连接</span>'
    }
  })

  wsClient.on('source-end', () => {
    const badge = $('#source-status-badge')
    if (badge) {
      badge.innerHTML = '<span class="status-badge inactive">未连接</span>'
    }
  })
}

function initListenersView(): void {
  const container = $('#listeners-view')
  if (!container) return

  container.innerHTML = `
    <div class="card">
      <div class="card-title">当前听众</div>
      <div id="current-listeners">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `
}

function initArchiveView(): void {
  const container = $('#archive-view')
  if (!container) return

  container.innerHTML = `
    <div class="card">
      <div class="card-title">录制文件</div>
      <div id="archive-list">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `
}

function initConfigView(): void {
  const container = $('#config-view')
  if (!container) return

  container.innerHTML = `
    <div class="card">
      <div class="card-title">系统配置</div>
      <p class="text-muted">配置界面开发中...</p>
    </div>
  `
}

function main(): void {
  initTabs()

  const defaultTab = 'dashboard'
  initView(defaultTab)

  wsClient.connect()

  // 5-second polling for status indicator
  setInterval(async () => {
    try {
      const status = await api.status()
      updateStatusIndicator(status)
    } catch (err) {
      console.debug('[polling] failed:', err)
    }
  }, 5000)
}

function updateStatusIndicator(status: any): void {
  const badge = $('#disconnect-warning') as HTMLElement | null
  if (badge) {
    if (!status.source?.connected && status.stream?.live) {
      badge.style.display = 'inline-block'
    } else {
      badge.style.display = 'none'
    }
  }
}

document.addEventListener('DOMContentLoaded', main)
