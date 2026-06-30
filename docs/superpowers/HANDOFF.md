# radioServices 实施进度

**日期**：2026-06-30
**目的**：跨会话交接 / 进度跟踪

## 当前状态

**v1 + v1.1 收尾 + B7 扩展 + C 修复 C11**全部完成 ✅

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

**测试**：99 passed (14 test files) · `pnpm typecheck` exit 0

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

12. ✅ **`FFmpegManager` 初始化顺序与设计规格不符** — `src/services/ffmpeg-manager.ts` 之前实现为 override → bundled → **system** → download → missing（注释自承顺序倒置以"减少不必要的网络"）。规格 `2026-06-29-radio-services-design.md` §3.1 与验收 #2/#3 明确要求"优先使用项目内下载的版本；下载失败时回退到系统 ffmpeg"
   - 修复：把 system 兜底挪到 download 失败之后；正确顺序 override → bundled → download → system → missing
   - 重写 `tests/integration/ffmpeg-manager.test.ts`：7 个测试覆盖规格 5 个优先级路径 + 进度事件；用 `vi.mock(downloader.downloadFfmpeg)` 隔离网络
   - 改动 2 个文件：`src/services/ffmpeg-manager.ts`、`tests/integration/ffmpeg-manager.test.ts`

13. ✅ **FFmpeg 面板：当数据源为 `system` 时应显示下载按钮，而非"已安装并可用"** — `src/web/views/ffmpeg-panel.ts` 之前只看 `status.available`，对 `bundled` / `override` / `system` 一律显示"✓ FFmpeg 已安装并可用"。这与上一项修复后的新行为（"system" 意味着下载失败回退）矛盾：用户看面板会以为没事，但实际上项目内无二进制、版本不受控。
   - 修复：把"下载安装"卡片按 `status.source` 拆分三态：
     - `bundled` / `override` → "✓ FFmpeg 已安装并可用"
     - `system` → "⚠ 启动时下载失败，目前使用系统 FFmpeg。建议重新下载项目内版本以保证版本一致。" + 下载按钮
     - `missing` → "FFmpeg 未安装，需要下载后才能使用录制功能。" + 下载按钮
   - 改动 1 个文件：`src/web/views/ffmpeg-panel.ts`

14. ✅ **点击"下载 FFmpeg"后 SSE 静默失败（`data: {"state":"idle"}` 后无任何更新）** — `FFmpegManager.triggerDownload()` 设 `forceDownload=true` 后调 `initialize()`，但 `initialize()` 的 reentrancy guard（`if (this.initializingPromise) return this.initializingPromise`）会**返回首次启动时缓存的 promise**，`forceDownload=true` 完全失效。后果：`doInitialize` 不再跑，`downloadFfmpeg` 从未被调用，`'download'` 事件从未触发。SSE 连接只能收到首次握手时的 `idle` 帧。
   - 修复：`triggerDownload()` 在调 `initialize()` 之前重置 `this.initializingPromise = null`，让 forceDownload 真正走到下载分支
   - 新增回归测试 "triggerDownload() forces a fresh download after initial initialize()" — verify 模式下 fail（`downloadFfmpeg` calls: 0≠1）+ 修复下 pass；这是确凿的 bug 证据
   - 改动 1 个文件：`src/services/ffmpeg-manager.ts`（1 行 + 注释）
   - 测试：94 passed (14 test files) · `pnpm typecheck` exit 0

15. ✅ **macOS 下载 ffmpeg 404** — 初版以为 BtbN 还在发布 macOS 只是路径换了（`ffmpeg-n8.1.1-latest-macos64-gpl-8.1.1.tar.xz`），实则 2026 年探测发现 BtbN 已**完全停止发布 macOS 构建**（README 明文 "Static Windows (x86_64) and Linux (x86_64) Builds"；最近 25 个 release 0 个 macOS asset）。
   - 修复：macOS 下载源切到 **osxexperts.net**（Helmut Tessarek 维护，`ffmpeg-static` README 引用源）
   - 文件命名约定：`ffmpeg<majorMinor>{arm,intel}.zip`（e.g. 8.1 → `ffmpeg81arm.zip` for Apple Silicon，8.0 → `ffmpeg80intel.zip` for Intel）
   - macOS 不提供 SHA256 sidecar → 跳过 SHA256 校验（其他平台保持原逻辑）
   - macOS 用 `unzip` 而非 `tar -xJ`（zip 容器 vs tar.xz）
   - 新增 `RADIO_FFMPEG_MAC_URL` 环境变量支持自定义 macOS 镜像
   - `resolveLatestFfmpegVersion()` 适配 HTML 分支（macOS 解析 `ffmpegXX<arm|intel>.zip` 链接，**不再**依赖 BtbN tags API）
   - `FFmpegManager.initialize()` 按平台分流：macOS 走 osxexperts，其他平台仍 BtbN
   - 默认 `config.ffmpeg.version`：macOS = `'8.1'`，其他 = `'7.1'`
   - 新增 5 个单元测试（macOS URL × 3、HTML 解析、空解析）+ 既有 4 个
   - 改动 3 个文件：`src/services/ffmpeg-downloader.ts`、`src/services/ffmpeg-manager.ts`、`src/config.ts`
   - 测试：103 passed (14 test files) · `pnpm typecheck` exit 0
   - 端到端验证：HTTP Range 远程解析 ZIP EOCD 拿到真实文件大小 22,547,365 字节（21.5 MB）、文件名 `ffmpeg`、压缩方法 deflate

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

