import { $, $$ } from './ui.js'
import { wsClient } from './ws-client.js'
import { api } from './api-client.js'
import { initDashboard } from './views/dashboard.js'
import { renderSource } from './views/source.js'
import { renderListeners } from './views/listeners.js'
import { renderArchive } from './views/archive.js'
import { renderFfmpegPanel } from './views/ffmpeg-panel.js'

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

      void initView(tabId)
    })
  })
}

function initSourceView(): void {
  const container = $('#source-view')
  if (!container) return
  void renderSource(container)
}

function initListenersView(): void {
  const container = $('#listeners-view')
  if (!container) return
  void renderListeners(container)
}

function initArchiveView(): void {
  const container = $('#archive-view')
  if (!container) return
  void renderArchive(container)
}

function initConfigView(): void {
  const container = $('#ffmpeg-view')
  if (!container) return
  void renderFfmpegPanel(container)
}

async function initView(tabId: TabId): Promise<void> {
  switch (tabId) {
    case 'dashboard':
      initDashboard()
      break
    case 'source':
      await initSourceView()
      break
    case 'listeners':
      await initListenersView()
      break
    case 'archive':
      await initArchiveView()
      break
    case 'ffmpeg':
      await initConfigView()
      break
  }
}

function main(): void {
  initTabs()

  const defaultTab = 'dashboard'
  void initView(defaultTab)

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
