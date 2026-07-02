# radioServices 实施进度

**日期**：2026-07-02
**目的**：跨会话交接 / 进度跟踪

> ⚠️ **如果你是一个新对话的 AI，看到本文件**：请先完整读完本文档再行动，特别留意 [§已知差距](#已知差距monorepo-后未实现--回归) 和 [§BACKLOG](#known-gaps-–-where-the-work-lives)。本文档已包含当前会话 ID 之前的全部上下文（HEAD、commits、踩过的坑、未完成项），下一个动作应当紧接**§跨会话交接建议**的阅读顺序。

## 当前状态

**Monorepo 重构 + 文档同步 + P0-1/P2-11 + P0-2 修复**：全部完成 ✅

仓库已从单包项目（`src/`、`public/`、`tests/`）重构为 5 包 monorepo + 4 个内置插件，并通过文档同步让 README、HANDOFF 与新架构对齐。本会话还完成了 BACKLOG 开工顺序第 2 项（P0-2：`/api/ffmpeg/download/status` 改为真 SSE，向 FFmpegManager 'download' 事件转发，初始 `idle` 帧 + `retry: 5000`，客户端断开双订阅清理，无 listener 泄漏）。

**HEAD**：`0995e1c` · `pnpm test` 143 / 146 通过（3 个失败为 `ffmpeg-manager.test.ts` 网络限制环境问题，HANDOFF 已知与重构无关）· `pnpm -r typecheck` exit 0 · `pnpm dev:all` 正常启动，`/health` 与 `/api/status` 返回 200，`/api/ffmpeg/download/status` 返回真 SSE。

设计稿与计划：

| 文档 | 路径 |
|------|------|
| Monorepo 架构设计 | `docs/superpowers/specs/2026-07-01-monorepo-design.md` |
| Monorepo 重构实施计划 | `docs/superpowers/plans/2026-07-01-monorepo-refactoring.md` |
| v1 设计规格（已整合进 shared） | `docs/superpowers/specs/2026-06-29-radio-services-design.md` |
| FFmpeg 版本选择器设计 | `docs/superpowers/specs/2026-06-30-ffmpeg-version-selector-design.md` |

## 重构后的架构

```
radioServices/
├── packages/
│   ├── shared/              # @radio-services/shared   — 类型、配置、接口契约（零运行时依赖，仅 js-yaml）
│   ├── core/                # @radio-services/core     — 服务、SQLite、插件运行时
│   │   └── src/plugin-system/{plugin-discoverer,plugin-loader,plugin-registry,plugin-context-impl}.ts
│   ├── server/              # @radio-services/server   — Fastify HTTP/WS 宿主
│   ├── web/                 # @radio-services/web      — esbuild 浏览器管理界面
│   └── plugins/
│       ├── manifest.json    # discoverer 扫描的白名单
│       ├── playlist/        # @radio-services/plugin-playlist
│       ├── archive/         # @radio-services/plugin-archive
│       ├── listeners/       # @radio-services/plugin-listeners
│       └── ffmpeg/          # @radio-services/plugin-ffmpeg
├── tests/                   # 工作区根测试（vitest，扁平）
├── bin/, config/, docs/, public/, data/, logs/
├── pnpm-workspace.yaml      # packages/* + packages/plugins/*
├── tsconfig.base.json       # 共享 TS 基础配置
└── README.md                # 中英双语总览
```

每个包有自己的 `package.json` + `tsconfig.json` + `README.md`，通过 pnpm `workspace:*` 协议互相引用。下游包通过 `exports` 字段读取 `dist/index.js` / `dist/index.d.ts`，因此 **build 顺序固定**：

```bash
pnpm --filter @radio-services/shared build
pnpm --filter @radio-services/core   build
# 然后才是 server / web / 各插件
```

`pnpm dev` 通过 `tsx/esm` + 插件 manifest 的 `source` 字段绕过该顺序 —— 见 `f5f6493` 的改动。

## 本轮 commits

### Monorepo 重构（`71456cc`）

`refactor: Monorepo 重构 - 5 包结构 + 插件系统 (#1)`

将单包项目拆为 5 个工作区包：

- `@radio-services/shared`：类型、配置加载、插件接口契约（`Plugin`、`PluginContext`、`DiscoveredPlugin`）
- `@radio-services/core`：服务（`Broadcaster`、`RingBuffer`、`SourceReceiver`、`ListenerManager`、`WsHub`）、SQLite 层（`schema.sql` + repos）、插件运行时（`PluginDiscoverer` → `PluginLoader` → `PluginRegistry` → `PluginContextImpl`）
- `@radio-services/server`：Fastify 宿主 + 路由
- `@radio-services/web`：esbuild 打包的浏览器管理界面
- `@radio-services/plugins/*`：4 个内置插件，每个独立 package

插件通过 `manifest.json` 自描述（name / version / entry / source / priority），discoverer 在启动时扫描 `packages/plugins/`，loader 用 `dynamic import()` 加载每个插件。

### dev 模式启动修复（`f5f6493`）

`fix: enable dev mode by adding source entry fallback and missing plugin deps`

monorepo 合并后 `pnpm dev:all` 失败，原因：

1. 插件 manifest 的 `entry` 指向 `dist/index.js`，但 dev 模式不先 build
2. 4 个插件的 `package.json` 缺第三方依赖（`keyv`、`keyv-file`、`ua-parser-js`、`better-sqlite3`）
3. `@radio-services/shared` 的 `loadConfig` 使用 `require('js-yaml')`，ESM 模块上下文失败
4. 根 `devDependencies` 缺 `fastify` + `supertest`，顶层 `tests/` 找不到模块

修复：

- `PluginLoader.resolveEntry()`：3 级回退 —— `manifest.entry`（dist）→ `manifest.source`（src）→ 约定 `src/index.ts`
- 4 个 manifest 全部添加 `"source": "src/index.ts"`
- 4 个插件的 `package.json` 补齐运行时依赖（keyv/keyv-file/ua-parser-js/better-sqlite3）
- `shared/src/config-func.ts`：`require('fs')` + `require('js-yaml')` → ESM `import`
- `shared/package.json`：添加 `js-yaml` 依赖
- 根 `package.json`：devDeps 添加 `fastify` + `supertest`

验证：`pnpm dev:all` 启动成功；`/health` 返回 `{"ok":true}`，`/api/status` 返回 broadcaster/ffmpeg/listeners 完整 JSON。

### typecheck 修复（`3a15af8`）

`fix: missing dependencies and tsconfig for typecheck to pass`

`pnpm typecheck` 报错：web 找不到 `@radio-services/shared` 的类型。根因：

1. `packages/core/tsconfig.json` 的 `paths: { "@radio-services/shared": ["../shared/src"] }` 让 tsc 把 shared 源文件纳入 core 编译，输出 `dist/core/src/...` 和 `dist/shared/src/...`（共享被重复构建）
2. archive / ffmpeg 用 `pino` 类型但未声明依赖
3. `server/src/config.ts` 引用 `js-yaml` 但 server 没声明依赖（虽然 server 运行时不调用它）

修复：

- `packages/core/tsconfig.json`：移除 `paths`，加显式 `rootDir: "src"`
- `archive` / `ffmpeg`：`pino: "^9.4.0"`
- `server`：`js-yaml: "^4.1.0"` + `@types/js-yaml: "^4.0.9"`

验证：`pnpm -r build` 全部通过；`pnpm -r typecheck` 全部通过；`dist/` 结构干净（不再有 `dist/core/src/`、`dist/shared/src/`）。

### 文档同步（`0c58b8f`）

`docs: update README.md for monorepo and add per-package READMEs`

- 根 `README.md`：重写为 monorepo 工作区入口（**中英双语**），含完整 HTTP surface 表 + 插件系统章节 + 故障排查
- 新增 `packages/{shared,core,server,web}/README.md`：4 个核心包独立说明
- 新增 `packages/plugins/README.md`：伞形索引 + "新增插件"教程
- 新增 `packages/plugins/{playlist,archive,listeners,ffmpeg}/README.md`：4 个内置插件独立说明

所有 README 中的路径用 `ls` 实地核对过 src/ 结构，无悬空引用。

## 历史背景（重构前的工作）

v1 → v1.3 的迭代成果都已迁移进新包，原始问题修复点见 git log。回顾要点：

### v1 单包阶段（19 个 commits）

完成：Fastify 宿主、SQLite 数据层、广播/环形缓冲、推流接入、FFmpeg 控制器、自动存档、歌单上传、听众追踪、WS Hub、Admin Web UI、E2E 测试。详见 `git log 72d47a0^..abd5b9e`。

### v1.1 安全/UX 收尾（10 个 commits）

`src/routes/config.ts` 不再返回明文 `sourcePassword`；上传按 magic bytes 校验类型；`pkill -f` 改为精确 PID 管理；默认密码 `"hackme"` 启动时 warn；听众落地页 `public/index.html`；`escapeHtml` 抽取到 `ui.ts`；前端 6 处 `any` 替换为 `src/web/types.ts` 强类型响应；路由 `:id` 用 `parsePositiveId()` 校验。

> 这些文件已随重构迁移：`src/web/` → `packages/web/src/`，`src/routes/` → `packages/server/src/routes/` + `packages/plugins/*/src/routes/`，`src/web/types.ts` → `packages/web/src/types.ts` + `packages/shared/src/types/api.ts`。

### v1.2 / v1.3 FFmpeg 版本选择器

`feat(ffmpeg): version selector`（`abd5b9e`）等 9 个 commits，实现版本持久化、运行时状态、远程版本列表、UI 版本选择卡片。代码位于 `packages/plugins/ffmpeg/src/services/`。

## 已知差距（monorepo 后未实现 / 回归）

本轮重构 + 修复把代码搬进了新结构、让 typecheck / dev 模式跑起来，但**没全部恢复 v1 → v1.1 已交付的功能**。逐项盘点见 `docs/superpowers/BACKLOG.md`，简要摘要：

### P0（阻塞管理后台与下载 UX）

1. ✅ **`/admin` 静态资源已挂载**：`packages/server/src/app.ts` 引入 `@fastify/static`（`resolvePath(__dirname, '../../../public')`），加 `build:web:deploy` 脚本同步 `public/admin/{app.js,app.css}`。6 个 E2E 用例覆盖 `GET /`、`/admin`、`/admin/index.html`、`/admin/app.js`、`/admin/app.css` + 404 回归 + cwd 无关回归。
2. ✅ **`/api/ffmpeg/download/status` 改为真 SSE**：抽出 `attachDownloadStatusSse()`（`packages/plugins/ffmpeg/src/routes/ffmpeg.ts`），手写 SSE 帧：headers `Content-Type: text/event-stream` + `Cache-Control: no-cache, no-transform` + `Connection: keep-alive` + `X-Accel-Buffering: no`；初始一帧 `{state:'idle'}` 加 `retry: 5000`；订阅 `FFmpegManager.on('download', …)` 转发所有进度事件；客户端断开通过 `request.raw` 与 `reply.raw` 双订阅清理（Fastify hijack 后生命周期模糊，两边都监保险），调用 `reply.hijack()` 时 `.bind(reply)` 保住 `this`（v1 初次实现漏 bind，hijack 内 `Symbol(fastify.reply.hijacked)` 写入 `this` 为 undefined，已修复）。前端 `EventSource('/api/ffmpeg/download/status')` 现能收到 `downloading/verifying/extracting/complete/error` 全套状态。6 个单元测试 + 1 个 e2e 烟测（`tests/integration/ffmpeg-download-sse.test.ts`）。

### P1（v1.1 已修过、monorepo 化后回归）

3. **`plugin.start()` / `stop()` 从未调用**：`app.ts` 只调 init，`server.ts` shutdown 不调 stop。破坏插件契约语义，archive / ffmpeg 子进程有句柄泄漏风险。
4. **`/api/archive/:filename` 不支持 HTTP Range**：用 `await readFile()` 整文件读内存，handler 没读 `Range` 请求头，`<audio>` 拖动进度条失败。
5. **`/api/listeners/history` 用 `Number()` 解析**：v1.1 commit `18df09c` 已经替换为 `parsePositiveId()`，monorepo 化时 playlist 端修了，listeners 端漏改。
6. **`/api/source/stop` 未触发 `endAll()`**：`broadcaster.endAll()` 已实现但**全工程无任何调用方**。v1.1 commit `8fe6d61` "source-stop calls endAll" 修复丢失。

### P2（设计规格有、monorepo 没迁移）

7. **`/api/playlist/loop` 端点缺失**：v1 设计规格 §3.7 要求 `POST /api/playlist/loop { enabled }`，monorepo 后 playlist plugin 没注册。
8. **`PlaylistService.nextSong()` / `popFirst()` 死代码**：设计成循环推流作业者，但全工程无调用方。
9. **WS 推送无人调用**：`PluginContext.registerWsHandler()` 没人调，`/ws` 实际连不上，前端 `wsClient` 超时。
10. **ffmpeg 路由重复**：`/api/ffmpeg/upgrade` 与 `/api/ffmpeg/download` 行为重复，应合并。
11. ✅ **`public/index.html` 落地页可走 8000 访问**：随 P0-1 一起修。`GET /` → 200 + `public/index.html`。

详细修复建议、关联代码位置、测试覆盖缺口表，**见 `docs/superpowers/BACKLOG.md`**。该文档**应作为下一个会话的首要工作内容**。

<a id="known-gaps-–-where-the-work-lives"></a>
<a id="backlog-reference"></a>

### 开工顺序建议（P0 必须先做）

| # | 任务 | 阻塞谁 |
|---|------|--------|
| 1 | ✅ P0-1 + P2-11：server 挂 `public/` 静态，加 `@fastify/static` + `build:web:deploy` 脚本 | 管理后台与听众落地页 |
| 2 | ✅ P0-2：`/api/ffmpeg/download/status` 改真 SSE | FFmpeg 下载 UI |
| 3 | P1-3：`app.ts` 调 `plugin.start()`、`server.ts` shutdown 调 `plugin.stop()` | archive / ffmpeg 句柄泄漏 |
| 4 | P1-6：`/api/source/stop` 调 `broadcaster.endAll()`（broadcast 注册为 plugin 服务） | 切歌韧性 |
| 5 | P1-4：`/api/archive/:filename` Range + 206 | Archive 跳进度 |
| 6 | P1-5：`/api/listeners/history` `Number()` → `parsePositiveId()` | 输入校验 |
| 7 | P2-7 / P2-8：playlist `loop` 端点 + worker 调 `nextSong()` / `popFirst()` | 循环推流 |
| 8 | P2-9：server 暴露 `/ws` 透传 `wsHub` 事件 | 实时状态推送 |
| 9 | P2-10：`/api/ffmpeg/upgrade` 合并进 `/download` | API 卫生 |

**P0 不通之前不要回头改 UI 细节**。

## 测试 / 质量

| 指标 | 数值 |
|------|------|
| 测试用例 | 146 个（`tests/` + `packages/*/`），143 通过，3 失败 |
| 失败测试 | `ffmpeg-manager.test.ts` 3 个 — 均为实际下载超时，沙盒网络限制下 `www.osxexperts.net` 不可达，HANDOFF 已知与重构无关 |
| 类型检查 | `pnpm -r typecheck` exit 0 |
| 构建 | `pnpm -r build` 8 个包全部通过 |
| 启动 | `pnpm dev:all` server + web 并行运行 |

> ⚠️ **本表只反映 monorepo 化是否"至少跑得起来"**，不代表功能完整。功能差距详见上节及 `BACKLOG.md`。

## 跨会话交接建议

新接手时建议从以下顺序入手：

1. 根 `README.md` —— 了解 monorepo 布局、HTTP surface、插件系统
2. `docs/superpowers/BACKLOG.md` —— **首要**：当前已知功能差距清单
3. `docs/superpowers/specs/2026-07-01-monorepo-design.md` —— 包间契约的源头
4. `packages/shared/README.md` —— 类型、配置、插件接口
5. `packages/core/README.md` —— 服务、SQLite、插件运行时
6. `packages/plugins/README.md` —— 内置插件索引 + 新增插件流程
7. `vitest.config.ts` —— 顶层测试如何解析 `@radio-services/*`

## 当前会话之前的对话 ID

需要查询先前对话的完整决策记录时，可在 `agent-transcripts/` 中查找。

旧版本 HANDOFF（v1.1 收尾时）归档于 `git log -p docs/superpowers/HANDOFF.md`（HEAD~4 之前的版本）。

## 新对话开局的"召唤词"模板

新对话的 AI **不会自动**读 HANDOFF 或 BACKLOG，必须由你在第一条消息里调用。建议把下面这段复制粘贴成新会话的 kickoff 消息：

```
你好。请按顺序读：
1) docs/superpowers/HANDOFF.md
2) docs/superpowers/BACKLOG.md

本会话的待办是 BACKLOG.md 的项目 #<填编号>（按 HANDOFF 里
"开工顺序建议"表的顺序填）。请先复述你对这两份文档的理解，
确认后再动手。
```

替换 `<填编号>` 为开工事项（P0-1 / P0-2 / P1-3 …），或直接说"按开工顺序从第 1 项开始"逐项推进。