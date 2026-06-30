import { api } from '../api-client.js'
import { $, $$, formatBytes, formatDuration, showToast, escapeHtml } from '../ui.js'

export async function renderSource(container: Element): Promise<void> {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">上传音频文件</div>
      <div class="upload-zone" id="upload-zone">
        <p>拖拽文件到此处或点击选择</p>
        <p class="text-muted">支持格式：MP3, M4A, AAC, OGG, WAV, FLAC</p>
        <input type="file" id="file-input" accept=".mp3,.m4a,.aac,.ogg,.wav,.flac" multiple style="display: none">
      </div>
      <div class="upload-progress" id="upload-progress"></div>
    </div>

    <div class="card">
      <div class="card-title">已上传文件</div>
      <div id="files-list">
        <p class="text-muted">加载中...</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">播放列表</div>
      <div id="playlist">
        <p class="text-muted">加载中...</p>
      </div>
    </div>
  `

  setupUploadZone()
  await loadFiles()
  await loadPlaylist()
}

function setupUploadZone(): void {
  const zone = $('#upload-zone')
  const input = $('#file-input') as HTMLInputElement | null

  if (!zone || !input) return

  zone.addEventListener('click', () => input.click())

  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('drag-over')
  })

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over')
  })

  zone.addEventListener('drop', (e: Event) => {
    e.preventDefault()
    zone.classList.remove('drag-over')
    const event = e as DragEvent
    const files = event.dataTransfer?.files
    if (files) {
      handleFiles(Array.from(files))
    }
  })

  input.addEventListener('change', () => {
    if (input.files) {
      handleFiles(Array.from(input.files))
      input.value = ''
    }
  })
}

async function handleFiles(files: File[]): Promise<void> {
  const progress = $('#upload-progress')
  if (!progress) return

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    progress.innerHTML = `<p>正在上传: ${escapeHtml(file.name)} (${i + 1}/${files.length})</p>`

    try {
      const result = await api.upload(file)
      showToast(`上传成功: ${file.name}`, 'success')

      // Auto add to playlist after successful upload
      if (result && result.filename) {
        await api.addToPlaylist(result.filename, file.name.replace(/\.[^.]+$/, ''), result.durationSec)
        await loadPlaylist()
      }
    } catch (err) {
      showToast(`上传失败: ${file.name}`, 'error')
      console.error('[source] upload error:', err)
    }
  }

  progress.innerHTML = ''
  await loadFiles()
}

async function loadFiles(): Promise<void> {
  const container = $('#files-list')
  if (!container) return

  try {
    const response = await api.listFiles()
    const files = response?.files ?? []
    if (files.length === 0) {
      container.innerHTML = '<p class="text-muted">暂无已上传文件</p>'
      return
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>文件名</th>
            <th>大小</th>
            <th>时长</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${files
            .map(
              (f: any) => `
            <tr data-id="${f.id}">
              <td>${escapeHtml(f.original_name || f.filename)}</td>
              <td>${formatBytes(f.size_bytes)}</td>
              <td>${f.duration_sec ? formatDuration(f.duration_sec) : '--'}</td>
              <td>
                <button class="btn-small play-btn" data-type="file" data-id="${f.id}">推流</button>
                <button class="btn-small add-playlist-btn" data-id="${f.id}" data-filename="${escapeHtml(f.filename)}">加到歌单</button>
                <button class="btn-small btn-danger delete-btn" data-id="${f.id}">删除</button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `

    // Event listeners
    $$('.play-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-id'))
        const name = btn.closest('tr')?.querySelector('td')?.textContent || '未知'
        try {
          await api.sourceStart('file', id)
          showToast(`开始推流: ${escapeHtml(name)}`, 'success')
        } catch (err) {
          showToast('推流启动失败', 'error')
        }
      })
    })

    $$('.add-playlist-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filename = btn.getAttribute('data-filename') || ''
        const row = btn.closest('tr')
        const name = row?.querySelector('td')?.textContent || '未知'
        try {
          await api.addToPlaylist(filename, name)
          showToast(`已添加到歌单: ${escapeHtml(name)}`, 'success')
          await loadPlaylist()
        } catch (err) {
          showToast('添加失败', 'error')
        }
      })
    })

    $$('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-id'))
        if (!confirm('确定要删除这个文件吗？')) return
        try {
          await api.deleteFile(id)
          showToast('文件已删除', 'success')
          await loadFiles()
        } catch (err) {
          showToast('删除失败', 'error')
        }
      })
    })
  } catch (err) {
    container.innerHTML = '<p class="text-muted">加载失败</p>'
    console.error('[source] load files error:', err)
  }
}

async function loadPlaylist(): Promise<void> {
  const container = $('#playlist')
  if (!container) return

  try {
    const response = await api.listPlaylist()
    const items = response?.items ?? []
    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">歌单为空</p>'
      return
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>歌曲</th>
            <th>时长</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item: any, index: number) => `
            <tr data-id="${item.id}">
              <td>${index + 1}</td>
              <td>${escapeHtml(item.display_name || item.filename)}</td>
              <td>${item.duration_sec ? formatDuration(item.duration_sec) : '--'}</td>
              <td>
                <button class="btn-small play-btn" data-type="playlist" data-id="${item.id}">推流</button>
                <button class="btn-small btn-danger delete-btn" data-id="${item.id}">移除</button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `

    $$('.play-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-id'))
        const type = btn.getAttribute('data-type') as 'file' | 'playlist'
        const name = btn.closest('tr')?.querySelectorAll('td')[1]?.textContent || '未知'
        try {
          await api.sourceStart(type, id)
          showToast(`开始推流: ${escapeHtml(name)}`, 'success')
        } catch (err) {
          showToast('推流启动失败', 'error')
        }
      })
    })

    $$('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-id'))
        if (!confirm('确定要从歌单移除吗？')) return
        try {
          await api.deleteFromPlaylist(id)
          showToast('已从歌单移除', 'success')
          await loadPlaylist()
        } catch (err) {
          showToast('移除失败', 'error')
        }
      })
    })

    // Stop stream button
    const stopBtn = document.createElement('button')
    stopBtn.className = 'btn btn-danger'
    stopBtn.textContent = '停止推流'
    stopBtn.style.marginTop = '1rem'
    stopBtn.addEventListener('click', async () => {
      try {
        await api.sourceStop()
        showToast('已停止推流', 'success')
      } catch (err) {
        showToast('停止失败', 'error')
      }
    })
    container.appendChild(stopBtn)
  } catch (err) {
    container.innerHTML = '<p class="text-muted">加载失败</p>'
    console.error('[source] load playlist error:', err)
  }
}
