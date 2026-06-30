export function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

export function $(selector: string, parent: Element | Document = document): Element | null {
  return parent.querySelector(selector);
}

export function $$(selector: string, parent: Element | Document = document): Element[] {
  return Array.from(parent.querySelectorAll(selector));
}

export function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  const container = $('#toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatTimeAgo(date: Date | string | number): string {
  const now = Date.now();
  const timestamp = typeof date === 'object' ? date.getTime() : new Date(date).getTime();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (minutes > 0) return `${minutes} 分钟前`;
  return '刚刚';
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getStatusClass(status: string): string {
  switch (status) {
    case 'active':
    case 'running':
    case 'connected':
      return 'active';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'inactive';
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
    return true;
  } catch {
    showToast('复制失败', 'error');
    return false;
  }
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    textContent?: string;
    innerHTML?: string;
    onclick?: (e: Event) => void;
    children?: HTMLElement[];
    [key: string]: unknown;
  }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (options) {
    for (const [key, value] of Object.entries(options)) {
      if (key === 'className') {
        el.className = value as string;
      } else if (key === 'textContent') {
        el.textContent = value as string;
      } else if (key === 'innerHTML') {
        el.innerHTML = value as string;
      } else if (key === 'onclick') {
        el.addEventListener('click', value as EventListener);
      } else if (key === 'children') {
        (value as HTMLElement[]).forEach(child => el.appendChild(child));
      } else if (key.startsWith('data-')) {
        el.setAttribute(key, String(value));
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else {
        (el as Record<string, unknown>)[key] = value;
      }
    }
  }

  return el;
}
