# radioServices 实施进度

**日期**：2026-06-30
**目的**：跨会话交接 / 进度跟踪

## 当前状态

**v1 全部完成** ✅

设计规格：`docs/superpowers/specs/2026-06-29-radio-services-design.md`（830 行）
实施计划：`docs/superpowers/plans/2026-06-29-radio-services.md`（4826 行）

### 已完成 commits（21 个）
```
dc4dc26 fix(source): accept POST as well as PUT on /source  ← 最新 HEAD（收尾 E2E 发现）
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

**测试**：65 passed (12 test files) · `pnpm typecheck` exit 0

**Tasks 0-16 全部完成 + 完整走完两阶段审查**

## 收尾发现的问题（v1 范围外，待 v1.1 处理）

### A. 安全性问题（来自最终代码审查）

1. **`/api/config` 暴露 sourcePassword** — `src/routes/config.ts:12` 返回完整配置对象，含明文密码
   - 修复：过滤敏感字段再返回
2. **上传未验证 MIME type** — `src/services/upload-service.ts` 只检查扩展名
   - 修复：用 `file-type` 等库检查 magic bytes
3. **`pkill` 误杀风险** — `src/app.ts:188` 用 `pkill -f` 可能误杀其他进程
   - 修复：维护 push PID 列表，精确 kill
4. **推流密码硬编码** — 默认 `"hackme"` 在多处出现
   - 修复：启动检测默认值并警告

### B. 功能/UX 问题

5. **`updateStatusIndicator` 前端无效** — `src/web/main.ts` 检查 `source.connected`，但后端 `/api/status` 不返回该字段
6. **`public/index.html` 听众落地页缺失** — README 提到但未实现
7. **`/stream` 无源时立即 503** — 应该等待 source 启动而非拒绝（取决于产品决策）

### C. 代码组织

8. **`escapeHtml` 在 4 个 view 文件中重复定义** — 应抽取到 `ui.ts`
9. **前端类型定义缺失** — 大量 `any`
10. **路由参数 `Number(id)` 宽松** — 无效字符串返回 NaN

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

## 当前会话之前的对话 ID

如需查询先前对话（包含完整决策记录），可从 agent-transcripts 找：
- 本次会话前的 brainstorming 决策、规格讨论记录需要时可追溯

