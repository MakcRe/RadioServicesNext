# v1.1.x：听众长连接跨切歌不中断

**日期**：2026-06-30
**目的**：让落地页听众在源切换时无需刷新或重连
**状态**：设计中
**范围**：v1.1 收尾后剩余的 B7，扩展为完整"长连接韧性"能力
**作者**：产品 / 架构（AI 协作）

---

## 1. 背景

v1 主体 29 个 commit 已完成（HEAD `756f95f`），v1.1 收尾 10 个 commit 已合入。HANDOFF 第 79-83 行仅记录了 B7（`/stream` 无源立即 503），但用户在收尾后反馈了**关联但更严重的体验问题**：

> 当前推流音频播放完成或中途推流新的歌曲，需要重新加载或刷新链接才会播放/有音频数据。

经过代码核查（`src/services/broadcaster.ts:70-84` 与 `src/app.ts:83-105`），确认根因是 `Broadcaster.detachSource()` 在推流切换时**主动关闭所有 listener 流**。这导致：

- 旧 ffmpeg 进程退出 → SourceReceiver 触发 `session-end` → `archiver.stop()` 跑完
- 旧 listener 仍持有旧 PassThrough 的引用（HTTP 连接未断）
- 用户操作 admin 启动新 ffmpeg → `attachInternalStream` 检测到 `activeSession` 存在 → `pipeFrom()` 调 `detachSource()` → **主动关闭所有旧 listener**
- 浏览器 `<audio>` 收到 `net::ERR_…` 不自动重试 → 静默

B7 与此同源 — 两者都源于"`Broadcaster` 在源切换时缺乏对 listener 的韧性处理"。本设计将两者合并处理。

---

## 2. 目标 / 非目标

### 2.1 目标

- 听众在落地页（`public/index.html`）打开后，**源切换（自动 / 手动）不导致听觉中断**。
- 落地页 `<audio>` 在服务端 503 / 网络错误时**自动重试**，最长等待由配置决定。
- 听众数量（50 ~ 500）规模下，源切换的 P99 延迟 < 200ms（不含网络 RTT）。
- 不破坏 v1 已有的 83 个单元 + 集成测试。

### 2.2 非目标

- 不做服务端 hold（等源上线后才返回 200）— 由前端轮询实现。
- 不做 ICY metadata 注入（v2 范围）。
- 不做播放器端缓冲策略优化（如 MediaSource API 切片拼接）。
- 不做 admin UI 自身的轮询 / 状态优化 — 已在 B5 / d841f4f 修复。
- 不改 SourceReceiver 的认证 / 协议层。

---

## 3. 决策汇总

| 决策点 | 选择 | 理由 |
|---|---|---|
| 源切换时 listener 行为 | 保持长连接跨切歌 | 用户体验连续，无 audible gap |
| 重连触发方 | 前端 `audio` `error` 事件 → 轮询 `/api/status` | 不依赖服务端发信号，浏览器兼容性好 |
| 主动 stop 行为 | 服务端 close + 前端进入轮询等待 | 与"自动切歌"统一处理路径 |
| 轮询间隔 | 默认 5s，上限 30s（可配） | 500 听众 = 100 QPS，可接受 |
| 源切换时 ring buffer | 清空（新源从开头起） | 避免 MP3 帧拼接噪音；听感是"无缝续播" |
| admin 启动下一首 | 自动先 stop 旧 ffmpeg | 避免两首叠加；切歌听感干净 |
| 新增服务端配置 | `stream.pollIntervalMs`（默认 5000，上限 30000） | 可控、可观测 |

---

## 4. 架构

### 4.1 当前数据流

```
[ffmpeg PUT /source] → SourceReceiver.on('data') → PassThrough
                                                  ↓
                          Archiver.start()  +  Broadcaster.pipeFrom(passthrough)
                                                  ↓
                          ringBuffer.push + listeners[i].write(chunk)
                                                  ↓
                          PassThrough → reply.raw.write(chunk)
                                                  ↓
                          [browser <audio>]

切歌时:
  SourceReceiver.on('session-end') → PassThrough.end()
    → Broadcaster.detachSource() → 主动 listener.end()  ← 罪魁
    → 浏览器 audio 收到 net::ERR_*
    → 不自动重试  → 静默
```

### 4.2 目标数据流

```
[ffmpeg PUT /source] → SourceReceiver.on('data') → PassThrough
                                                  ↓
                          Archiver.start()  +  Broadcaster.pipeFrom(passthrough)
                                                  ↓
                          ringBuffer.reset + listeners[i].write(chunk)
                                                  ↓
                          PassThrough → reply.raw.write(chunk)
                                                  ↓
                          [browser <audio>]

切歌时（重点变化）:
  SourceReceiver.on('session-end')
    → Broadcaster.detachSource()  ← 不再 end listener，只解绑旧 source
    → source-end 事件（清空旧引用，但 listener 仍订阅同一 HTTP 连接）
  SourceReceiver.on('session-start') [新源]
    → Broadcaster.pipeFrom(newStream, newSession)
    → ringBuffer.reset()
    → listeners[i].write(newStream 第一块数据)  ← listener 续命
  浏览器 audio
    → audio element 继续收到 chunk  ← 听感无中断
  主动 /api/source/stop 时
    → Broadcaster.endAll()  ← 新增：明确关闭所有 listener
    → 浏览器 audio 收到 net::ERR_*
    → audio 'error' 事件 → 前端轮询 /api/status
```

### 4.3 客户端轮询状态机

```
                  ┌─────────────────────┐
                  │  IDLE (audio 未播放) │
                  └──────────┬──────────┘
                             │ 用户点击播放
                             ▼
            ┌────────────────────────────────┐
            │ CONNECTING  /stream  GET         │
            └──────┬──────────────┬───────────┘
           503  │              │ 200
               ▼              ▼
   ┌──────────────────┐  ┌──────────────┐
   │ WAITING_FOR_SOURCE│  │  PLAYING      │
   │ poll /api/status  │  │ audio.playing │
   │ every 5s          │  └──────┬───────┘
   │ broadcast.isLive  │         │ error / ended / stalled
   │  ↑ false  ↓ true   │         ▼
   └────┬───────────────┘  ┌──────────────┐
        │ true              │  RECONNECT    │
        ▼                   │ poll 5s       │
  reset src + CONNECTING    └───────────────┘
```

---

## 5. 详细设计

### 5.1 后端 — `src/services/broadcaster.ts`

#### 5.1.1 `pipeFrom()` 改造

**当前行为**：在 `pipeFrom()` 内部调用 `detachSource()`，会主动 `listener.end()` 关闭所有现存 listener。

**目标行为**：

- 解绑旧 `sourceStream` 的 `data` / `end` / `error` 监听
- 保留所有 `listeners` Map 中的 Listener 引用
- 重置 `ringBuffer`
- 设置新的 `currentSession` / `sourceStream`
- 新源 `data` 事件触发时，对**所有现存 listener** 写 chunk

代码伪代码：

```typescript
pipeFrom(stream: Readable, session?: SourceSession): void {
  // 1. 解绑旧 source 的事件（不再 end listener）
  this.unbindSource()

  // 2. 重置 ring buffer
  this.ringBuffer.reset()

  // 3. 挂新 source
  this.sourceStream = stream
  if (session) this.currentSession = session

  // 4. 监听新 source
  const processChunk = (chunk: Buffer) => {
    this.ringBuffer.push(chunk)
    for (const listener of this.listeners.values()) {
      listener.write(chunk)
    }
  }
  stream.on('data', processChunk)
  this.onSourceEndHandler = () => this.unbindSource()
  stream.on('end', this.onSourceEndHandler)
  stream.on('error', this.onSourceEndHandler)

  // 5. 触发外部事件（让 archiver / ws-hub 知道源切了）
  this.emit('source-changed', { session, listenerCount: this.listeners.size })
}

private unbindSource(): void {
  if (this.sourceStream && this.onSourceEndHandler) {
    this.sourceStream.off('data', /* prev handler */)
    this.sourceStream.off('end', this.onSourceEndHandler)
    this.sourceStream.off('error', this.onSourceEndHandler)
  }
  this.sourceStream = null
  this.currentSession = null
  this.onSourceEndHandler = null
  // 注意：listener 集合不动
}
```

#### 5.1.2 新增 `endAll()` — 主动停止

```typescript
endAll(): void {
  this.unbindSource()
  for (const listener of this.listeners.values()) {
    listener.end()
  }
  this.listeners.clear()
  this.ringBuffer.reset()
}
```

被 `/api/source/stop` 路径调用（不是自动切歌路径）。

#### 5.1.3 事件接口

```typescript
// 新增事件
'live-start'  // 真正的新流挂上（有 listener）
'source-end'   // 旧 source 解绑（不一定踢 listener）
```

- 移除 `currentSession = null` 时主动发 `'source-end'` 的逻辑（避免误导监听器以为 listener 被关）
- `'session-end'`（来自 SourceReceiver）→ 触发 `unbindSource` + 发 `'source-end'`
- `'session-start'`（来自 SourceReceiver）→ 触发 `pipeFrom` + 发 `'live-start'`

#### 5.1.4 `subscribe()` 不变

- 仍然返回 ListenerConnection（包含当前 ring buffer 快照 + 订阅新流）
- 当 `pipeFrom` 后调 `subscribe()`，listener 收到新源第一块数据

#### 5.1.5 兼容性

- `isLive()` 语义不变：`currentSession !== null`
- `getCurrentSession()` 不变
- `ringBufferSize()` 不变
- `unsubscribe()` 不变

### 5.2 后端 — `src/app.ts` 编排

#### 5.2.1 session-start / session-end 处理

**当前**：

```typescript
sourceReceiver.on('session-start', (session) => {
  sourceStream = new PassThrough()
  archiver.start(sourceStream).catch(...)
  broadcaster.pipeFrom(sourceStream, session)
  wsHub.emitEvent('source-start', session)
})

sourceReceiver.on('data', (chunk) => {
  sourceStream?.write(chunk)
})

sourceReceiver.on('session-end', (session) => {
  sourceStream?.end()
  sourceStream = null
  archiver.stop().catch(() => {})
  wsHub.emitEvent('source-end', { sessionId: session.id })
})
```

**问题**：每次 session-start 都新开 PassThrough + 启 archiver，导致 archiver 在切歌时被频繁 stop/start，与"长连接跨切歌"目标冲突。

**目标行为**：

```typescript
let sourceStream: PassThrough | null = null

sourceReceiver.on('session-start', (session) => {
  // 1. 关闭上一个本地 PassThrough
  if (sourceStream && !sourceStream.destroyed) {
    sourceStream.end()
  }
  // 2. 启新 PassThrough
  sourceStream = new PassThrough()
  // 3. archiver 持续挂上（只在第一次 session-start 启；后续 session 不重启）
  if (!archiver.isRunning()) {
    archiver.start(sourceStream).catch(...)
  }
  // 4. broadcaster 切源（不踢 listener）
  broadcaster.pipeFrom(sourceStream, session)
  // 5. ws 广播
  wsHub.emitEvent('source-start', session)
})

sourceReceiver.on('data', (chunk) => {
  sourceStream?.write(chunk)
})

sourceReceiver.on('session-end', (session) => {
  // 1. 关本地 PassThrough（broadcaster 会自动解绑）
  if (sourceStream && !sourceStream.destroyed) {
    sourceStream.end()
  }
  sourceStream = null
  // 2. archiver 持续运行（下一个 session-start 时复用）
  // 3. ws 广播
  wsHub.emitEvent('source-end', { sessionId: session.id })
})
```

**archiver 改动**：新增 `isRunning(): boolean` 方法，记录 archiver 内部 `currentSegment` 状态（v1 已有 `getStatus()`，需扩展）。

#### 5.2.2 `/api/source/start` — 自动 stop 旧 ffmpeg

**当前**：调起新 ffmpeg 进程，与旧 ffmpeg 并存，叠加推流。

**目标**：

```typescript
app.post('/api/source/start', async (request) => {
  // ... 校验 body ...
  // 新增：在调起新 ffmpeg 前，先 stop 所有现存推流进程
  await stopAllPushProcs()
  // ... 后续不变 ...
})
```

`stopAllPushProcs()` 复用 `/api/source/stop` 已有的 SIGTERM → 500ms → SIGKILL 逻辑，提取为本地函数。

注意：stop 旧 ffmpeg **不**调 `broadcaster.endAll()`。停止 ffmpeg 进程会自然触发 SourceReceiver 的 `session-end` → broadcaster 走 unbindSource 路径 → 不踢 listener。当新 ffmpeg 启动后（admin 等待 500ms SIGKILL 后），新 session-start 触发 `pipeFrom` → 听众听感 = 短暂静音（最多 1s）+ 新源开始。

#### 5.2.3 `/api/source/stop` — 主动踢 listener

**当前**：

```typescript
app.post('/api/source/stop', async () => {
  // 杀 ffmpeg 进程
})
```

**目标**：在杀进程后，新增 `broadcaster.endAll()` 调用，主动关闭所有 listener。听众的 `audio` 收到 `error` → 进入轮询等待。

```typescript
app.post('/api/source/stop', async () => {
  await stopAllPushProcs()
  broadcaster.endAll()  // 新增
  archiver.stop().catch(() => {})  // 新增：archiver 也停
  return { ok: true, killed }
})
```

#### 5.2.4 SIGTERM 后 race 处理

当 admin 启动下一首时：
1. `stopAllPushProcs()` 发 SIGTERM → 旧 ffmpeg 退出
2. SourceReceiver 触发 `session-end` → `unbindSource`
3. 500ms 后 SIGKILL 残留
4. **同一 API 调用** 立即 spawn 新 ffmpeg
5. 新 ffmpeg 第一块数据到 SourceReceiver → `session-start` → `pipeFrom` → listener 续命

但步骤 1-3 是 async，步骤 4-5 是 sync。**新 ffmpeg 启动**时旧 ffmpeg 还没退出，SourceReceiver 检测到 `activeSession` 存在会**先踢旧 session**（`source-receiver.ts:46-54`）。这是正确的：踢旧 ffmpeg socket 不影响 listener（listener 走的是 broadcaster）。

**关键修复**：`SourceReceiver.attachInternalStream` 踢旧 socket 的同时，应该让 broadcaster 走 unbindSource（不是 endAll），即不要主动 `listener.end()`。v1 这里是 broadcaster 自动调用 `detachSource()`，需要同步改造为 `unbindSource()`（v1.x 调整）。

### 5.3 后端 — `src/services/source-receiver.ts`

#### 5.3.1 不主动 emit 'session-end' 影响 listener

SourceReceiver 现有的 `'session-end'` 事件在 socket 关闭时 emit，由 `app.ts` 监听并转发到 broadcaster。这是 OK 的 — 但要确保 `broadcaster.unbindSource()` 不踢 listener（见 5.1.1）。

不修改 SourceReceiver 主体逻辑。

### 5.4 后端 — `src/services/archiver.ts`

#### 5.4.1 新增 `isRunning()`

```typescript
private running = false

async start(passthrough: PassThrough): Promise<void> {
  // ... 现有逻辑 ...
  this.running = true
}

async stop(): Promise<void> {
  // ... 现有逻辑 ...
  this.running = false
}

isRunning(): boolean {
  return this.running
}
```

#### 5.4.2 `start()` 幂等性

如果 `start()` 被重复调用（不应发生但防御），第二次应该 no-op 或抛出明确错误。建议：throw 显式错误，由调用方处理（`app.ts` 已经检查 `isRunning()`）。

### 5.5 后端 — 配置文件

#### 5.5.1 `config/config.yaml`

新增：

```yaml
stream:
  pollIntervalMs: 5000   # 前端轮询 /api/status 间隔（落地页用）
  pollIntervalMaxMs: 30000  # 上限保护
```

#### 5.5.2 `src/config.ts`

`AppConfig` 接口增加 `stream: { pollIntervalMs: number; pollIntervalMaxMs: number }`，默认值 + 验证（不能超过 `pollIntervalMaxMs`）。

#### 5.5.3 `src/routes/config.ts`

`/api/config` 返回新增字段（**注意**：只返回非敏感字段，参见 A1 修复 7591d51 的过滤逻辑）。

#### 5.5.4 `src/web/types.ts`

`ConfigResponse` 接口增加 `stream: { pollIntervalMs: number; pollIntervalMaxMs: number }`。

### 5.6 前端 — `public/index.html`（落地页）

**当前**：

```html
<audio controls preload="none">
  <source src="/stream" type="audio/mpeg">
</audio>
```

**目标**：

#### 5.6.1 内联状态机

```html
<script>
  const audio = document.querySelector('audio')
  const statusEl = document.querySelector('#status')
  let pollTimer = null
  let pollInterval = 5000  // 从 /api/config 拉取
  let isPolling = false

  async function fetchConfig() {
    try {
      const res = await fetch('/api/config')
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  async function tryConnect() {
    // 用时间戳 cache-bust，避免浏览器缓存旧连接
    audio.src = '/stream?t=' + Date.now()
    audio.load()
    try {
      await audio.play()
      setStatus('收听中')
    } catch (err) {
      // autoplay 被拦截，等用户点击
      setStatus('点击播放')
    }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text
  }

  function startPolling() {
    if (isPolling) return
    isPolling = true
    const tick = async () => {
      try {
        const res = await fetch('/api/status')
        if (res.ok) {
          const data = await res.json()
          if (data.broadcaster?.isLive) {
            isPolling = false
            if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
            await tryConnect()
            return
          }
        }
      } catch {}
      setStatus('等待直播开始…')
      pollTimer = setTimeout(tick, pollInterval)
    }
    tick()
  }

  audio.addEventListener('error', () => {
    setStatus('连接中断，正在重试…')
    startPolling()
  })
  audio.addEventListener('stalled', () => {
    setStatus('缓冲中…')
  })
  audio.addEventListener('ended', () => {
    // 源自然结束（理论上不应发生 — v1.x 已修，但兜底）
    setStatus('直播已结束')
    startPolling()
  })

  audio.addEventListener('play', () => {
    // 用户手动点击播放
    setStatus('收听中')
  })

  // 初始化
  (async () => {
    const cfg = await fetchConfig()
    if (cfg?.stream?.pollIntervalMs) {
      pollInterval = Math.min(cfg.stream.pollIntervalMs, cfg.stream.pollIntervalMaxMs ?? 30000)
    }
  })()
</script>
```

#### 5.6.2 UI 提示

- 状态文字显示在 audio 元素下方
- 样式与现有深色主题一致
- 不引入新依赖（保持纯 HTML5 audio + 内联 JS）

#### 5.6.3 用户体验

| 状态 | 提示 |
|---|---|
| 未播放 | "点击播放按钮收听直播"（v1 已有） |
| 播放中 | "收听中" |
| 503 / 错误 | "连接中断，正在重试…" |
| 等待源 | "等待直播开始…" |
| 源已结束 | "直播已结束"（兜底） |

### 5.7 前端 — admin UI（`src/web/views/source.ts` / dashboard）

**不改**：admin UI 已有 `source-start` / `source-stop` 按钮。v1.1.x 行为变化对用户透明：点"启动下一首"现在会**自动**先 stop 旧 ffmpeg（用户无感知，因为本来就预期切歌）。

**可选**：admin 启动后短暂显示"切换中…"提示，500ms 后自动消失（不做也行）。

---

## 6. 数据结构与接口

### 6.1 `Broadcaster` 类变化摘要

| 方法 | v1 | v1.1.x |
|---|---|---|
| `pipeFrom(stream, session?)` | 主动踢旧 listener | 保留 listener，清 ring buffer，订阅新源 |
| `detachSource()` | 公开，踢 listener | **改为私有 `unbindSource()`**，不踢 listener |
| `endAll()` | 不存在 | **新增**：主动关闭所有 listener（仅 stop 路径用） |
| `subscribe()` | 不变 | 不变 |
| `unsubscribe()` | 不变 | 不变 |
| `isLive()` | 不变 | 不变 |
| `getCurrentSession()` | 不变 | 不变 |
| `ringBufferSize()` | 不变 | 不变 |

### 6.2 事件接口

| 事件 | emit 时机 | 监听方 |
|---|---|---|
| `live-start` (新) | `pipeFrom()` 完成，新源已订阅 | ws-hub（转为 `source-start`） |
| `source-end` (新) | `unbindSource()` 时 | ws-hub（转为 `source-end`，admin 通知） |
| `data` | 旧：broadcaster 内部 | 移除（仅 listener 用） |

ws-hub 事件格式不变（向后兼容 v1.1 dashboard 客户端）。

### 6.3 新增配置

```typescript
interface AppConfig {
  // ... 现有字段 ...
  stream: {
    pollIntervalMs: number  // 默认 5000
    pollIntervalMaxMs: number  // 默认 30000
  }
}
```

---

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| SourceReceiver 收到非法 source（auth 失败） | 不变，401 |
| ffmpeg 进程中途崩溃 | SourceReceiver 触发 session-end → broadcaster unbindSource → listener 短暂静默 → 新 ffmpeg 启动后（admin 手动 / 自动）→ 听众听感：短暂静音 + 新源 |
| 网络抖动导致 listener 收包失败 | PassThrough 内部错误 → `reply.raw.write` throw → 现有代码 `listener.end()` + disconnect（v1 已有，保持） |
| admin stop 路径 | broadcaster.endAll() → listener 关闭 → 前端 audio error → 轮询 |
| 听众浏览器兼容（旧 IE） | 不支持；v1 已有要求，现状不变 |
| 500 听众同时轮询 `/api/status` | 100 QPS（5s 间隔），Fastify 单机轻松处理 |
| `/api/config` 返回失败 | 前端用默认 5000ms |

---

## 8. 测试

### 8.1 单元测试

**`tests/unit/broadcaster.test.ts`** — 新增 / 调整：

- `pipeFrom` 第二次调用不清 listener（用 mock listener，断言调用次数 = 1 而不是 2）
- `pipeFrom` 第二次调用重置 ring buffer
- `pipeFrom` 第二次调用将新 source 数据写入所有现存 listener
- `endAll` 关闭所有 listener 并清空 listeners Map
- `endAll` 不影响 ringBufferSize（重置为 0）
- `unbindSource` 不踢 listener
- `isLive` 在 `pipeFrom` 完成后立即返回 `true`
- `isLive` 在 `unbindSource` 后立即返回 `false`

**`tests/unit/archiver.test.ts`** — 调整（如有）：

- `isRunning()` 在 start 后 true、stop 后 false
- `start()` 重复调用抛错

### 8.2 集成测试

**`tests/integration/e2e.test.ts`** — 新增：

- "切歌韧性"：启动 ffmpeg1 → listener 连接 /stream 收到 chunk → stop ffmpeg1 → start ffmpeg2 → **listener 仍连接且收到新 chunk**（不重连）
- "主动 stop 触发前端重试"：listener 连接到 /stream → POST /api/source/stop → listener 收到 EOF → mock fetch /api/status 返回 isLive=true → 重新 GET /stream → 收到新 chunk
- "无源 503"：listener GET /stream → 收到 503（保持 v1 行为，不做服务端 hold）

### 8.3 手动 E2E（README 附录）

1. `pnpm dev`
2. 打开浏览器 `http://localhost:8000/` → 落地页
3. 点击播放 → 503（无源）
4. 状态显示"等待直播开始…"
5. 打开 admin `/admin` → 上传文件 → 启动播放
6. **听众落地页自动开始播放，无需刷新**
7. 等播放完，admin 启动下一首
8. **听众落地页自动接续新首，无需刷新**
9. admin 点停止
10. 听众落地页显示"直播已结束"，重新开始轮询

---

## 9. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| archiver 持续运行导致磁盘持续增长 | 长时间不下播会持续切 segment | 现有 retentionDays 配置 + 自动清理 |
| 多次 session 切换累积内存泄漏 | listener 未清理 / PassThrough 引用未释放 | `unbindSource` 显式置 null；listener 关闭时 unsubscribe |
| 500 听众同时轮询 100 QPS | 单机压力 | 5s 间隔保守值；后续可调 |
| 浏览器缓存 /stream URL | 重连不生效 | cache-bust `?t=Date.now()` |
| 跨切歌时 ring buffer 重置导致老听众听不到前一首末尾 | 听感 1-2s 静音 | 用户决策（"clear_on_switch"） |
| 旧 ffmpeg 进程 SIGTERM 后未及时退出 | 短暂叠加推流 | 500ms SIGKILL 兜底 |

---

## 10. 迁移与回滚

### 10.1 迁移

- 配置文件添加 `stream` 段，旧配置自动用默认值（`pollIntervalMs: 5000`）
- 现有 `/api/config` 调用者（admin 端）增加新字段，UI 暂不渲染
- 数据库无 schema 变化

### 10.2 回滚

- `git revert` 整个 v1.1.x commit 序列
- Broadcaster 行为回退到 v1.1（主动踢 listener）
- 落地页回退到 v1 行为（无轮询，503 后用户手动刷新）
- 配置文件 `stream` 段可保留无影响

---

## 11. 后续扩展（v2+，不在本设计范围）

- MediaSource API 切片拼接，跨切歌真正零静音
- 落地页加 PWA / Service Worker 离线缓存
- 推流端健康检查 + 自动重启（DJ 进程崩溃自愈）
- ICY metadata 注入（歌名 / 封面）
- 多人 DJ 协作（takeover 协议）

---

**文档结束。请 review 后进入 writing-plans 阶段。**
