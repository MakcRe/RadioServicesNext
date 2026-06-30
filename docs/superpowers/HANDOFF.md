# radioServices 实施进度

**日期**：2026-06-30
**目的**：跨会话交接 / 进度跟踪

## 当前状态

**v1 + v1.1 收尾 + B7 扩展全部完成** ✅

设计规格（v1）：`docs/superpowers/specs/2026-06-29-radio-services-design.md`（830 行）
实施计划（v1）：`docs/superpowers/plans/2026-06-29-radio-services.md`（4826 行）
设计规格（B7）：`docs/superpowers/specs/2026-06-30-stream-wait-on-source.md`（673 行）

### 已完成 commits（v1.1.x 共 6 个：B7 落地）

```
857efcf docs(spec): add design for B7 listener resilience on source switch
54c27c9 test(e2e): cover source-switch listener resilience (HANDOFF B7)
53656a7 feat(landing): poll /api/status and auto-reconnect after stream drops
d4dd0e1 feat(config): expose stream.pollIntervalMs for the landing page
8fe6d61 fix(app): source-start auto-stops prior ffmpeg; source-stop calls endAll
49b1275 refactor(broadcaster): split detachSource and add endAll for source-switch resilience  ← B7 起点
```

### 已完成 commits（v1.1 收尾 10 个）
```
756f95f docs: mark C9 and C10 as done in HANDOFF
18df09c refactor(web): replace any with typed API responses + tighten route id parsing
```

v1 主体（19 个）：
```
dc4dc26 fix(source): accept POST as well as PUT on /source
85ae72c chore: cleanup before release
1daac48 docs: README + final docs
b4de420 test: integration + E2E tests
6d63e1b feat: source, archive, listeners, ffmpeg-panel views
5c0831e feat: admin web UI (skeleton + dashboard)
4d6f73c feat: fastify app with all REST routes + WS
5662073 docs: update HANDOFF for next session (Task 12 ready for review)
18c86ef feat: WS event hub
5177ad7 fix(playlist+upload): existence checks, atomic write+insert, race fix
8c22a36 feat: upload service + playlist service
b782e93 fix(manager): atomic single-INSERT, normalize device_type to spec literal
191b70a feat: listener manager with UA parsing
6c5ff88 fix(archiver): stop() race condition + stderr guard + state coverage
ee6980f feat: archiver with segment + cleanup
1f00705 fix(broadcaster): clear listeners+buffer on source end, guard subscribe after end
69d5bd0 feat: broadcaster with ring buffer snapshot
7f280ef fix(receiver): fix race condition window, isolate onData errors, add session metadata test
40adce1 feat: icecast source receiver with auth + single-session
4327369 fix(manager): snapshot getStatus, real triggerDownload, close listeners
41c325a fix(manager): narrow sysCandidates type per TS strict mode
5412b28 feat: ffmpeg manager with bundled/system/missing fallback
f181a19 fix(downloader): dedupe import + validate SHA256 format
285a492 fix(downloader): add SHA256 verification per design spec
d80a8dc feat: config loading + pino logger
72d47a0 chore: scaffold TypeScript + Fastify project
bdf1556 docs: design spec + implementation plan
```

**测试**：91 passed (14 test files) · `pnpm typecheck` exit 0

**Tasks 0-16 全部完成 + 完整走完两阶段审查**

## 收尾发现的问题（v1 范围外，待 v1.1 处理）

### A. 安全性问题（来自最终代码审查）

1. ✅ **`/api/config` 暴露 sourcePassword** — `src/routes/config.ts:12` 返回完整配置对象，含明文密码
   - 修复：过滤敏感字段再返回（`7591d51`）
2. ✅ **上传未验证 MIME type** — `src/services/upload-service.ts` 只检查扩展名
   - 修复：用 magic bytes 校验扩展名匹配（`b951463` + `cee815d`，覆盖 M4A 与未知扩展名）
3. ✅ **`pkill` 误杀风险** — `src/app.ts:188` 用 `pkill -f` 可能误杀其他进程
   - 修复：维护 push PID 列表，精确 kill（`ae53f7d`）
4. ✅ **推流密码硬编码** — 默认 `"hackme"` 在多处出现
   - 修复：启动检测默认值并 warn（`33d1d5e`）

### B. 功能/UX 问题

5. ✅ **`updateStatusIndicator` 前端无效** — `src/web/main.ts` 检查 `source.connected`，但后端 `/api/status` 不返回该字段
   - 修复：dashboard 改读 `broadcaster.isLive` / `listeners.count`，并把视图按模块拆分（`d841f4f` + `8eece9c`）
6. ✅ **`public/index.html` 听众落地页缺失** — README 提到但未实现
   - 修复：`public/index.html` 含深色主题 HTML5 `<audio>` 播放器，`preload="none"`，graceful 降级（`c8082c3`）
7. ✅ **`/stream` 无源时立即 503** — 设计选择（保留） + 落地页轮询重试

### D. v1.1.x 收尾（HANDOFF 完成 + 用户提的"切歌必须刷新"问题）

11. ✅ **听众长连接跨切歌不中断** — 用户会话内提出的体验问题（B7 扩展）
   - 修复：`Broadcaster.detachSource` 拆为 `unbindSource`（不踢 listener）+ `endAll`（仅 /api/source/stop 用）；`broadcaster.pipeFrom()` ring buffer 在末尾 reset（clear-on-switch）
   - 修复：`/api/source/start` 启动新 ffmpeg 前先 stop 旧（避免双流叠加）
   - 修复：`/api/source/stop` 调 `broadcaster.endAll()`
   - 修复：archiver 跨 session 持久运行（不再每次重启）
   - 修复：落地页 `public/index.html` 加轮询 /api/status + audio error 自动重试，状态文字（等待/收听/重试/结束）
   - 配置：`stream.pollIntervalMs`（默认 5000）+ `stream.pollIntervalMaxMs`（默认 30000）
   - 测试：broadcaster 5 个新单测 + config 1 个 + e2e 2 个"切歌韧性"用例
   - 改动 5 个文件：broadcaster.ts / app.ts / config.ts / routes/config.ts / web/types.ts / index.html
   - 设计稿：`docs/superpowers/specs/2026-06-30-stream-wait-on-source.md`（673 行）

### C. 代码组织

8. ✅ **`escapeHtml` 在 4 个 view 文件中重复定义** — 应抽取到 `ui.ts`
   - 修复：抽取到 `src/web/ui.ts`，4 个 view 改为 import（`c8082c3`）
9. ✅ **前端类型定义缺失** — 大量 `any`
   - 修复：新建 `src/web/types.ts` 统一前后端响应类型，`api-client.ts` 全部 `Promise<T>`；前端 6 处 `any` 全部去掉（`18df09c`）
10. ✅ **路由参数 `Number(id)` 宽松** — 无效字符串返回 NaN
   - 修复：新增 `parseId()` / `parsePositiveId()`，前端 4 处 + 后端 4 处 `Number()` 全部替换为带 400 的解析函数（`18df09c`）

## E2E 验证结果（本次会话完成）

```
✅ 服务启动 (系统 ffmpeg 8.1.1 fallback)
✅ GET /api/status / ffmpeg/status / listeners / playlist / archive
✅ GET /admin/index.html + /admin/app.js (200)
✅ GET /stream + /live.mp3 无源 → 503
✅ POST /source ffmpeg 推流 → 200
✅ Listener GET /stream 收到 4642 字节 MP3（含 ID3 + MP3 frame）
```

发现并修复：**Icecast POST 兼容 bug**（dc4dc26）— ffmpeg 默认用 POST，但 SourceReceiver 只注册 PUT。

## v1.1 收尾（已完成）

本次 v1 → v1.1 收尾共 10 个 commit（`18df09c` / `c8082c3` / `bf1b6d3` / `7490c8b` / `8eece9c` / `d841f4f` / `0f8822b` / `3bd171c` / `33d1d5e` + 前一轮的 `7591d51` / `ae53f7d` / `cee815d` / `b951463` / `53149c4`），解决的问题对应 HANDOFF 第 61-83 行的 A1-A4、B5、B6、C8、C9、C10：

- **A1** `/api/config` 不再返回明文 `sourcePassword`
- **A2** 上传按 magic bytes 校验类型，支持 M4A 与未知扩展名
- **A3** ffmpeg 推流进程走精确 PID 管理，弃用 `pkill -f`
- **A4** 默认密码 `"hackme"` 启动时 warn
- **B5** dashboard LIVE/OFFLINE 与 listener 计数现在能正确反映后端状态
- **B6** 听众落地页 `public/index.html` 已实现（深色主题 + HTML5 audio + graceful 无源降级）
- **C8** `escapeHtml` 已从 4 个 view 抽取到 `ui.ts`
- **C9** 前端 6 处 `any` 全部替换为 `src/web/types.ts` 中的强类型响应
- **C10** 路由 `:id` 现在用 `parsePositiveId()` 校验，无效 ID 抛 400（前端用 `parseId()` + toast 兜底）

未修复项（B7）保留在 "## 收尾发现的问题" 中，留待后续 v1.1.x。

## 当前会话之前的对话 ID

如需查询先前对话（包含完整决策记录），可从 agent-transcripts 找：
- 本次会话前的 brainstorming 决策、规格讨论记录需要时可追溯

