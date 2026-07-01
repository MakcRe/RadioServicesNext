# radioServices 实施进度

**日期**：2026-07-02
**目的**：跨会话交接 / 进度跟踪

## 当前状态

**Monorepo 重构 + 文档同步**：全部完成 ✅

仓库已从单包项目（`src/`、`public/`、`tests/`）重构为 5 包 monorepo + 4 个内置插件，并通过文档同步让 README、HANDOFF 与新架构对齐。

**HEAD**：`0c58b8f` · `pnpm test` 130 / 132 通过（2 个失败仅 FFmpeg 网络超时，与重构无关）· `pnpm typecheck` exit 0 · `pnpm dev:all` 正常启动，`/health` 与 `/api/status` 返回 200。

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

## 测试 / 质量

| 指标 | 数值 |
|------|------|
| 测试用例 | 132 个（`tests/` + `packages/*/`），130 通过，2 失败 |
| 失败测试 | `ffmpeg-manager.test.ts` 2 个 — 均为实际下载超时，环境问题，与重构无关 |
| 类型检查 | `pnpm -r typecheck` exit 0 |
| 构建 | `pnpm -r build` 8 个包全部通过 |
| 启动 | `pnpm dev:all` server + web 并行运行 |

## 跨会话交接建议

新接手时建议从以下顺序入手：

1. 根 `README.md` —— 了解 monorepo 布局、HTTP surface、插件系统
2. `docs/superpowers/specs/2026-07-01-monorepo-design.md` —— 包间契约的源头
3. `packages/shared/README.md` —— 类型、配置、插件接口
4. `packages/core/README.md` —— 服务、SQLite、插件运行时
5. `packages/plugins/README.md` —— 内置插件索引 + 新增插件流程
6. `vitest.config.ts` —— 顶层测试如何解析 `@radio-services/*`

## 当前会话之前的对话 ID

需要查询先前对话的完整决策记录时，可在 `agent-transcripts/` 中查找。

旧版本 HANDOFF（v1.1 收尾时）归档于 `git log -p docs/superpowers/HANDOFF.md`（HEAD~4 之前的版本）。