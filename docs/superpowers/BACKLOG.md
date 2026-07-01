# radioServices 未实现 / 回归功能 Backlog

**日期**：2026-07-02
**目的**：在 monorepo 重构（commit `71456cc`）与 v1.1 修复基础上，对照 v1 设计规格、v1.1 修复记录与当前代码，列出 **未实现 / 已回归** 的功能点。优先级 P0 = 阻塞、 P1 = 已知回归、 P2 = 设计规格要求但未迁移。

**索引**

| 编号 | 优先级 | 简述 | 影响面 |
|------|--------|------|--------|
| [P0-1](#p0-1-admin-静态资源未挂载) | P0 | `/admin` 静态资源未挂载 | 管理后台 |
| [P0-2](#p0-2-api/ffmpeg/download/status-不是-sse) | P0 | `/api/ffmpeg/download/status` 不是 SSE | FFmpeg 下载 UI |
| [P1-3](#p1-3-pluginstart--stop-从未调用) | P1 | `plugin.start()` / `stop()` 从未调用 | 插件生命周期 |
| [P1-4](#p1-4-api/archive/:filename-不支持-http-range) | P1 | `/api/archive/:filename` 不支持 HTTP Range | 回放页面 |
| [P1-5](#p1-5-api/listeners/history-参数解析回归) | P1 | `/api/listeners/history` 用 `Number()` | 听众历史 |
| [P1-6](#p1-6-api/source/stop-未触发-endall) | P1 | `/api/source/stop` 未触发 `endAll()` | 切歌韧性 |
| [P2-7](#p2-7-api/playlist/loop-端点缺失) | P2 | `/api/playlist/loop` 端点缺失 | 歌单循环 |
| [P2-8](#p2-8-playlistservicenextsongpopfirst-死代码) | P2 | `nextSong()` / `popFirst()` 死代码 | 循环推流作业 |
| [P2-9](#p2-9-ws-推送无人调用) | P2 | WS handler 注册机制空转 | 实时状态推送 |
| [P2-10](#p2-10-ffmpeg-路由重复) | P2 | `/api/ffmpeg/upgrade` 与 `/download` 重复 | API 卫生 |
| [P2-11](#p2-11-publicindexhtml-无法走-8000-访问) | P2 | `public/index.html` 未被服务端暴露 | 听众落地页 |

---

## P0-1 `/admin` 静态资源未挂载

**优先级**：P0（管理后台完全无法通过浏览器访问）
**影响**：ROOT README §"Quick start"中"浏览器访问 `http://localhost:8000/admin`"打不开。

### 现象

`packages/server/src/app.ts` 只通过 `PluginContext` 拿到 plugin 注册的 REST 路由，**没有任何 `@fastify/static` 挂载**或 `fastify.register(serveStatic)` 调用。`GET /admin`、`/admin/index.html`、`/admin/app.js` 全部 404。

### 现状文件

- `packages/web/dist/` 有产物 `app.js` / `app.css` / `app.js.map`（esbuild 输出）
- `public/admin/` 也有同三个文件（旧产物）
- 但**没有脚本**从 `packages/web/dist/` 拷贝到 `public/admin/`，且 server 不会 serve `public/admin/`

### 修复建议

1. `package.json` 加 `build:web:deploy` 脚本：`pnpm build:web && cp packages/web/dist/{app.js,app.css,app.js.map} public/admin/`
2. `packages/server/src/app.ts` 引入 `@fastify/static`，把 `public/` 挂载在根（`/admin/*` → `public/admin/*`、`/*` → `public/index.html`）
3. E2E 测试加 `GET /admin/app.js 200` 用例

### 关联代码

- `packages/server/src/app.ts:24-179`（无 static 注册）
- `packages/web/package.json:6-8`（build 写 dist 不写 public）
- `package.json:13`（`build:web` 仅触发 esbuild）

---

## P0-2 `/api/ffmpeg/download/status` 不是 SSE

**优先级**：P0（FFmpeg 下载 UI 显示进度完全失败）
**影响**：用户在管理面板点"下载 FFmpeg"，进度条不动。v1.1 HANDOFF 中"B7-14 SSE 静默失败"这个 bug 没有真正修。

### 现象

```typescript
// packages/plugins/ffmpeg/src/routes/ffmpeg.ts:42-45
{
  method: 'GET',
  url: '/api/ffmpeg/download/status',
  handler: async () => {
    return { state: 'idle' }     // <-- 静态 JSON，非 SSE
  }
}
```

但前端 `packages/web/src/api-client.ts:161` 用 `EventSource()` 订阅，期望 `text/event-stream`。结果：浏览器收到一个 `data: {"state":"idle"}` 后立即结束，看不到任何进度更新。

### 修复建议

把 handler 改成：
1. 返回 `Content-Type: text/event-stream` 头
2. 监听 `runtimeState` 的状态变化（`keyv-file` 的 in-memory 缓存或 `ctx.on('ffmpeg-download-progress', handler)` 事件总线）
3. 用 `reply.raw.write(\`data: ${JSON.stringify(state)}\\n\\n\`)` 持续推送
4. 客户端断开时清理订阅

需要先决断：是否引入 fastify 内置 SSE helper（如 `fastify-sse`）还是手写。

### 关联代码

- `packages/plugins/ffmpeg/src/routes/ffmpeg.ts:42-45`
- `packages/web/src/api-client.ts:161`（EventSource 订阅端）
- `packages/plugins/ffmpeg/src/services/ffmpeg-manager.ts`（下载进度的真相来源）

---

## P1-3 `plugin.start()` / `stop()` 从未调用

**优先级**：P1（破坏插件契约语义，archive / ffmpeg 子进程有句柄泄漏风险）
**影响**：service 层运行 OK，但 plugin lifecycle 不完整。

### 现象

`packages/server/src/app.ts:99-101`：

```typescript
for (const plugin of loadedPlugins) {
  await plugin.init(pluginContext)
}
// 没有 start() 调用
```

`packages/server/src/server.ts:12-20`：

```typescript
const shutdown = async (signal: string) => {
  // 没有 plugin.stop() 调用
  await app.close()
  process.exit(0)
}
```

四个插件的 `index.ts` 都实现了 `start()` / `stop()`（多数只打日志，但 ffmpeg 的 `stop()` 调 `runtimeState.close()`，archive 的 `stop()` 调 `archiver.stop()`），目前永远不会执行。

### 修复建议

1. `app.ts` 在 init 循环之后加：

```typescript
for (const plugin of loadedPlugins) {
  await plugin.start()
}
```

2. `server.ts` 的 `shutdown` 在 `app.close()` 之前加：

```typescript
await Promise.allSettled(loadedPlugins.map(p => p.stop?.()))
```

或者用更稳的 `PluginRegistry.getAll()` 来枚举。

### 关联代码

- `packages/server/src/app.ts:99-101`
- `packages/server/src/server.ts:12-20`
- `packages/plugins/{playlist,archive,listeners,ffmpeg}/src/index.ts`（四个 init/start/stop 实现）

---

## P1-4 `/api/archive/:filename` 不支持 HTTP Range

**优先级**：P1（`<audio>` 拖动进度条失败）
**影响**：Archive 回放页面的"跳到中段"动作会从头再读整个切片（最坏几十 MB）。

### 现象

`packages/plugins/archive/src/routes/archive.ts:22-47`：

```typescript
const buf = await readFile(filepath)   // 整文件读内存
return {
  data: buf,
  headers: { 'Content-Length': String(stats.size), 'Accept-Ranges': 'bytes' }
}
```

返回的 header 还带 `Accept-Ranges: bytes`，但 handler **根本没读 `Range` 请求头**，**没返回 `206 Partial Content`**。这是 v1.1 commit `4327369` 之前的旧行为，迁移时退化。

### 修复建议

1. handler 第一行拿 `request.headers.range`，解析出 `start`/`end`
2. 用 `createReadStream(filepath, { start, end })` 返回流
3. 返回状态码 206，header 加 `Content-Range: bytes start-end/total`
4. 无 Range 时仍返回 200 + 全文件流
5. 加 E2E 测试：`GET /api/archive/test.mp3 -H "Range: bytes=0-1023"` → 206 + 1024 字节

### 关联代码

- `packages/plugins/archive/src/routes/archive.ts:22-47`

---

## P1-5 `/api/listeners/history` 参数解析回归

**优先级**：P1（无效参数 silent fallthrough 到 NaN）
**影响**：传 `?page=abc` 返回空集而不是 400，前端 debug 困难。v1.1 修复过的"路由 `Number()` 宽松"问题回归。

### 现象

`packages/plugins/listeners/src/routes/listeners.ts:24-28`：

```typescript
handler: async (query: unknown) => {
  const { page = '1', pageSize = '50' } = query as { page?: string; pageSize?: string }
  const p = Math.max(1, Number(page))           // <-- Number() 不校验
  const ps = Math.max(1, Math.min(500, Number(pageSize)))
  return deps.listenerManager.history(p, ps)
}
```

v1.1 HANDOFF §C10 明确写"路由 `:id` 现在用 `parsePositiveId()` 校验，无效 ID 抛 400"。但 monorepo 后 playlist plugin 用 `parsePositiveId()`（正确），listeners plugin 没用。

### 修复建议

1. 把 `shared/src/utils/parse-id.ts` 中的 `parsePositiveId()` / `parseId()` 抽到 `@radio-services/shared`，让所有 plugin 共用
2. listeners plugin 改用 `parsePositiveId()` 校验 query
3. ffmpeg-plugin 也检查是否同样问题
4. 加单元测试覆盖 `?page=abc` → 400

### 关联代码

- `packages/plugins/listeners/src/routes/listeners.ts:24-28`
- `packages/plugins/playlist/src/routes/playlist.ts:7-12`（已有 `parsePositiveId`，应共享）

---

## P1-6 `/api/source/stop` 未触发 `endAll()`

**优先级**：P1（B7 "切歌韧性"修复退化）
**影响**：listener 在旧推流结束后会一直 hold 住 stream socket，需要等 idle timeout。

### 现象

`packages/plugins/ffmpeg/src/routes/ffmpeg.ts:189-199`：

```typescript
{
  method: 'POST',
  url: '/api/source/stop',
  handler: async () => {
    const sourceReceiver = ctx.getService<{ detachInternalStream?: () => void }>('sourceReceiver')
    if (sourceReceiver) {
      sourceReceiver.detachInternalStream?.()  // <-- 只清 internal stream
    }
    return { success: true }
  }
}
```

v1.1 commit `8fe6d61`（"source-stop calls endAll"）原本要求：

1. 调 `broadcaster.endAll()` 强制结束所有 listener
2. 调 `stopAllPushProcs()` 精确 kill 之前 spawn 的 ffmpeg 推流进程

但 monorepo 后 `endAll()` 在 `packages/core/src/services/broadcaster.ts:85` 实现存在，**无任何调用方**。

### 修复建议

1. 把 `broadcaster` 注册为 plugin 服务（`ctx.registerService('broadcaster', broadcaster)`），当前只在 `app.ts` 持有
2. ffmpeg-plugin `/api/source/stop` 改调 `ctx.getService<Broadcaster>('broadcaster').endAll()`
3. 同理 `/api/source/start` 在启动前应调 `endAll()` 防止双流叠加
4. 加 E2E：`POST /api/source/stop` 后 `GET /stream` 立即返回 503（而非挂死）

### 关联代码

- `packages/plugins/ffmpeg/src/routes/ffmpeg.ts:189-199`
- `packages/core/src/services/broadcaster.ts:85-92`（`endAll()` 实现，无调用方）

---

## P2-7 `/api/playlist/loop` 端点缺失

**优先级**：P2（设计规格要求但 monorepo 后没迁移）
**影响**：歌单循环 UI 开关无效。

### 现象

v1 设计规格 `docs/superpowers/specs/2026-06-29-radio-services-design.md:516`：

```
| `/api/playlist/loop` | POST | `{ enabled: true|false }` |
```

但 `packages/plugins/playlist/src/routes/playlist.ts` 的路由列表（`/api/playlist`、`/api/playlist/:id`、`/api/playlist/reorder`、`/api/source/files*`、`/api/source/upload`）**没有 loop**。

### 修复建议

1. playlist plugin 加 route：

```typescript
{
  method: 'POST',
  url: '/api/playlist/loop',
  handler: async (request: unknown) => {
    const { enabled } = (request as { body: { enabled: boolean } }).body
    return { enabled: playlistService.setLoop(Boolean(enabled)) }
  }
}
```

2. `playlistService` 加 `loop` 字段 + `setLoop()` 持久化到 SQLite
3. 后台 worker（见 [P2-8](#p2-8-playlistservicenextsongpopfirst-死代码)）读这个 flag 决定是否循环

### 关联代码

- `packages/plugins/playlist/src/routes/playlist.ts:45-153`
- `packages/plugins/playlist/src/services/playlist-service.ts`（无 loop 概念）

---

## P2-8 `PlaylistService.nextSong()` / `popFirst()` 死代码

**优先级**：P2（接口存在但没有作业者）
**影响**：循环推流没有作业者，靠人手动触发。

### 现象

`packages/plugins/playlist/src/services/playlist-service.ts:47-56`：

```typescript
nextSong(): PlaylistRow | null { return this.repo.list()[0] ?? null }
popFirst(): PlaylistRow | null { this.remove(this.nextSong()?.id) ... }
```

`grep -rn nextSong packages/` 仅在定义文件内出现，**无任何调用方**。

### 修复建议

1. 在 playlist plugin（或新增 `loop` 子模块）的 `start()` 中订阅 `broadcaster` 的 `session-end` 事件
2. 监听器：

```typescript
broadcaster.on('session-end', async (session) => {
  if (!loopEnabled) return
  const next = playlistService.nextSong()
  if (!next) return
  // 通过 ffmpeg 子进程推下一首
  const proc = spawn(ffmpegPath, ['-i', next.path, '-f', 'mp3', '-'])
  sourceReceiver.attachInternalStream(proc.stdout, { name: next.display_name })
})
```

3. 加 E2E：循环模式下 `session-end` 后 1s 内 listener 收到新一首歌

### 关联代码

- `packages/plugins/playlist/src/services/playlist-service.ts:47-56`
- `packages/core/src/services/broadcaster.ts:66-68`（已 emit `session-end`，但目前 plugin 没订阅）

---

## P2-9 WS 推送无人调用

**优先级**：P2（实时状态推送架构层空转）
**影响**：前端 `wsClient.connect()` 失败、超时或根本连不上。

### 现象

`PluginContext.registerWsHandler()` 接口与实现都存在（`packages/core/src/plugin-system/plugin-context-impl.ts:25`），`app.ts:153-158` 也会把 WS 路由转发到 fastify，但**所有 plugin 都没调过 `registerWsHandler`**。

`grep -rn registerWsHandler packages/` 仅在定义处出现。

设计规格 §3.8 WS 推送事件（`source-start` / `source-end` / `listener-count` / `archive-new` / `ffmpeg-download-progress` / `config-changed`）全部走不到。`config-changed` 在 ffmpeg plugin 里走 `wsHub.emitEvent`（即 `WsHub` 实例的 in-memory event bus），但 `WsHub` 没有 `registerWsHandler` 暴露的 WS endpoint。

### 修复建议

1. server 在 `app.ts` 加一个 `/ws` endpoint，挂 `wsHub.onAny(handler)` 的透传
2. 或者每个 plugin 自己 `registerWsHandler('/ws/source-events', ...)` 监听
3. 前端 `wsClient` 改连 `/ws` 而非 `/ws/*`

### 关联代码

- `packages/core/src/plugin-system/plugin-context-impl.ts:25`
- `packages/server/src/app.ts:153-158`
- `packages/web/src/ws-client.ts`（订阅端）

---

## P2-10 ffmpeg 路由重复

**优先级**：P2（卫生问题）
**影响**：API surface 不洁。

### 现象

`packages/plugins/ffmpeg/src/routes/ffmpeg.ts:48-66`：

- `POST /api/ffmpeg/download`：触发下载（可指定 version）
- `POST /api/ffmpeg/upgrade`：触发下载（不指定）

两个 handler 几乎一样。`README.md` 第 22、59、62、189、192 行重复列出。

### 修复建议

1. 删除 `/api/ffmpeg/upgrade`
2. 文档同步删除
3. 加 `/api/ffmpeg/download` 在 `version` 字段缺失时走 latest

### 关联代码

- `packages/plugins/ffmpeg/src/routes/ffmpeg.ts:48-66`
- `packages/plugins/ffmpeg/README.md`
- `packages/server/README.md`

---

## P2-11 `public/index.html` 无法走 8000 访问

**优先级**：P2（落地页对用户不可用）
**影响**：v1.1 写的"听众落地页"功能对用户来说形同虚设——浏览器只能 `file://` 打开 HTML，无法走 `http://host:8000/`。

### 现象

`public/index.html`（落地页）存在，但同 [P0-1](#p0-1-admin-静态资源未挂载) —— server 不 serve `public/`。

### 修复建议

1. 与 P0-1 一起修：server 用 `@fastify/static` 挂 `public/`
2. `GET /` → 200 + `public/index.html`
3. 加 E2E：`GET /` → 200 HTML

### 关联代码

- `public/index.html`（存在）
- `packages/server/src/app.ts`（未挂载）

---

## 附录：测试覆盖缺口

| 用例 | 现有覆盖 | 缺口 |
|------|----------|------|
| `GET /admin/app.js` | ❌ | 无 |
| `GET /admin/index.html` | ❌ | 无 |
| `GET /` (落地页) | ❌ | 无 |
| `GET /api/archive/x.mp3 -H "Range: bytes=0-1023"` | ❌ | 无 |
| `GET /api/listeners/history?page=abc` → 400 | ❌ | 无 |
| `POST /api/source/stop` 后 `GET /stream` → 503 | ❌ | 无 |
| `POST /api/playlist/loop { enabled: true }` → 200 + state 持久 | ❌ | 无 |
| `POST /api/source/start` 第二次启动 → 旧 ffmpeg 被 kill | ❌ | 无 |
| SSE 推送进度帧 | ❌ | 无 |
| plugin.stop() 被调用（通过 mock 验证） | ❌ | 无 |

`tests/integration/e2e.test.ts` 应当扩展以上场景。