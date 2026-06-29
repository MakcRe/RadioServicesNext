# radioServices 设计规格

**日期**：2026-06-29
**状态**：用户已批准架构（Icecast HTTP 流方案 A）+ 已修正 ffmpeg 安装策略，等待最终 review
**作者**：产品经理（AI 协作）

## 一句话定义

一个用 Node.js + TypeScript 实现的本地优先广播电台服务器。运营方（"小白"用户）通过 ffmpeg 命令行推送音频流，或通过浏览器上传文件触发推流；听众通过 `http://host/stream` 或 `http://host/live.mp3` 实时收听，也可以点播最近 N 天的存档回放。

---

## 1. 目标与范围

### 1.1 用户与角色

| 角色 | 谁 | 干什么 |
|---|---|---|
| **运营方（DJ）** | 你（小白用户） | 用 ffmpeg 命令行或浏览器界面上传并推送音频 |
| **听众** | 任何访问 URL 的人 | 通过浏览器或 VLC/MPV 等播放器实时收听、回放 |
| **管理员（=运营方）** | 你 | 通过浏览器管理界面查看状态、管理歌单、查看日志 |

### 1.2 关键需求（与用户确认后定稿）

| 需求项 | 决定 |
|---|---|
| 推流端工具 | **ffmpeg 命令行**，系统未安装时自动下载 |
| 收听端 | **浏览器 + VLC/MPV 都支持** |
| 听众 URL 形态 | **`/stream` 和 `/live.mp3` 都支持**（同一内容，两条 URL） |
| 频道数 | **单频道** |
| 同时在线规模 | **50 ~ 500 人** |
| 部署环境 | **先在本地跑通**，公网部署后续考虑 |
| 鉴权 | **完全公开，无登录**（推流侧用一个静态密码防滥用，不对听众鉴权） |
| 元数据 | **不需要**正在播放信息 |
| 音频格式 | **MP3**（最通用，浏览器/VLC 原生支持） |
| 存档策略 | **按时间切片**（默认每小时一段 MP3） |
| 存档保留 | **可配置，默认 7 天** |
| 浏览器可视化界面 | **全部要**：状态、上传/推流、歌单、历史日志 |
| ffmpeg 安装 | **从 BtbN/FFmpeg-Builds 下载到项目目录内**，不用系统包管理器 |

### 1.3 非目标（明确不做）

- **多频道**：v1 不支持，单电台
- **实时元数据（ICY metadata）**：v1 不支持正在播放歌名
- **HTTPS / 域名证书**：v1 仅 HTTP，HTTPS 留给部署阶段
- **CDN / 大规模分发**：v1 单进程，最多 500 人
- **听众账号 / 会员制**：完全公开
- **移动 App**：仅 Web 浏览器 + 桌面播放器
- **录制/排程/定时推流**：v1 不做（"录制"指定时启动无人值守的录制/播放任务；歌单循环是手动触发后顺序播放，不属于"排程"）
- **公网部署相关**：DDNS、反向代理、端口转发等留给后续

---

## 2. 架构总览

### 2.1 数据流图

```
┌──────────────────────────────────────────────────────────────┐
│                    radioServices (Node.js)                    │
│                                                              │
│  ┌──────────┐     ┌────────────────┐     ┌──────────────┐    │
│  │ ffmpeg   │────▶│  Source        │     │   Listener   │◀───┼─── 浏览器 / VLC
│  │ (推流端) │ PUT │  Receiver      │◀───▶│   Broadcaster│──▶ │── 浏览器 / VLC
│  └──────────┘     └───────┬────────┘     └──────────────┘    │
│       │                   │                       │          │
│       │           ┌───────▼────────┐              │          │
│       │           │   Archiver     │              │          │
│       │           │ (ffmpeg切片)   │              │          │
│       │           └───────┬────────┘              │          │
│       │                   │                       │          │
│       │           ┌───────▼────────┐              │          │
│       │           │ archive/*.mp3  │              │          │
│       │           └────────────────┘              │          │
│       │                                           │          │
│  ┌────▼────────────────────────────────────────────▼─────┐   │
│  │                SQLite (歌单/配置/日志)                │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │       Admin Web UI (HTML + TS, 浏览器内可视化)         │   │
│  │   状态页 / 推流控制 / 歌单 / 听众日志                    │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 三条核心数据路径

#### 路径 A：推流路径

```
ffmpeg (本地或远程) PUT /source (Icecast 协议, HTTP chunked)
   │
   ▼
Source Receiver
   │  解析 Icecast headers（Authorization、User-Agent）
   │  限制同时只有 1 个推流会话
   ▼
   ├──▶ Broadcaster.ringBuffer (128KB ring buffer)
   │
   └──▶ Archiver 启动 ffmpeg segment 子进程
              -i pipe:0 -c copy -f segment
              -segment_time 3600 -segment_atclocktime 1
              -strftime 1
              输出: bin/archive/YYYY-MM-DD-HH.mp3
```

#### 路径 B：实时收听路径

```
浏览器/VLC GET /stream 或 GET /live.mp3
   │
   ▼
Listener Broadcaster
   │  1. 先写 ring buffer 全部内容（新听众接续）
   │  2. 之后订阅 currentStream 的新字节
   ▼
   HTTP 200, Content-Type: audio/mpeg, Transfer-Encoding: chunked
   边推边读，直到客户端断开
```

#### 路径 C：回放路径

```
浏览器/VLC GET /archive/2026-06-29-15.mp3
   │
   ▼
Archive Static Server (express.static 风格)
   │  支持 HTTP Range (206 Partial Content)，听众可 seek
   ▼
   bin/archive/YYYY-MM-DD-HH.mp3
```

### 2.3 技术栈

| 维度 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript | 需求指定 |
| HTTP 框架 | **Fastify** | 性能更好、内置 TS 类型、schema 校验、pino 日志 |
| 数据库 | **better-sqlite3** | 同步 API、单文件、零运维 |
| WebSocket | **ws** | 推送实时状态到前端 |
| 外部进程 | **ffmpeg 子进程** | 切片、推流、探测 |
| 前端构建 | **esbuild** | 单文件打包，零配置 |
| 测试 | **Vitest + supertest** | TS 原生支持好 |
| 日志 | **pino**（Fastify 默认） | 高性能 |
| 包管理 | pnpm（已在 package.json） | 用户已配置 |
| ffmpeg 下载源 | **BtbN/FFmpeg-Builds**（GitHub Releases） | 全平台静态二进制 |

---

## 3. 模块详细设计

### 3.1 `FFmpegManager` — ffmpeg 生命周期

#### 职责
确保项目启动时有一个可用的 ffmpeg 二进制。优先使用项目内下载的版本；下载失败时回退到系统 ffmpeg；都没有则启动失败。

#### 状态机

```
启动时:
  ↓
[检查 bin/ffmpeg/current/ffmpeg(.exe) 是否存在且可执行]
  ├─ 存在 & 可执行 → 用项目内的 ✓
  ├─ 不存在 → [下载固定版本] → 成功?
  │                       ├─ 是 → 用项目内的 ✓
  │                       └─ 否 → [检查系统 ffmpeg]
  │                                    ├─ 存在 → 用系统的 ✓
  │                                    └─ 不存在 → 启动失败 + Web 报错
```

#### 目录结构

```
bin/
└── ffmpeg/
    ├── current -> .versions/7.1/   # 软链（macOS/Linux）
    │                               # Windows: current.bat 桥接
    └── .versions/
        ├── 7.1/
        │   ├── ffmpeg (.exe)
        │   └── ffmpeg.sha256
        └── 7.0/
            └── ...
```

#### 平台 → 下载 URL 映射

下载源固定为 **BtbN/FFmpeg-Builds** 的 GitHub Release。版本号硬编码在代码里（v1 固定 7.1）。

| 平台 | 架构 | 文件名格式 | 解压格式 |
|---|---|---|---|
| macOS | arm64 | `ffmpeg-master-latest-macos64-gpl.tar.xz` | tar.xz |
| macOS | x86_64 | `ffmpeg-master-latest-macos64-gpl.tar.xz` | tar.xz |
| Linux | x86_64 | `ffmpeg-master-latest-linux64-gpl.tar.xz` | tar.xz |
| Linux | arm64 | `ffmpeg-master-latest-linuxarm64-gpl.tar.xz` | tar.xz |
| Windows | x86_64 | `ffmpeg-master-latest-win64-gpl.zip` | zip |

URL 模板：
```
https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/{filename}
```

#### 下载流程

1. 解析 `process.platform` 和 `process.arch`
2. 拼出下载 URL
3. 下载到 `bin/ffmpeg/.downloads/`（带 `.part` 后缀，下载完成后改名）
4. 通过 SSE 推送进度到前端（`Content-Length` + 已下载字节）
5. 校验 SHA256（BtbN 每个 release 提供 `.sha256` 文件）
6. 解压到 `bin/ffmpeg/.versions/{version}/`
7. 给 `ffmpeg(.exe)` 加可执行权限（macOS/Linux）
8. 更新 `current` 软链
9. 失败时清理临时文件，保留旧版本不动

#### Web 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/ffmpeg/status` | GET | 返回 `{ installed, source, version, path }` |
| `/api/ffmpeg/download/status` | GET (SSE) | 实时推送 `{ percent, downloaded, total, speed, state }` |
| `/api/ffmpeg/download` | POST | 触发下载任务（异步） |
| `/api/ffmpeg/upgrade` | POST | 检查 GitHub 最新 release 并下载 |

#### macOS 安全提示处理

macOS 上 BtbN 的二进制**未签名**，首次运行会被 Gatekeeper 拦截。Web 界面在检测到这种情况时，给用户图文操作指引：

```
系统设置 → 隐私与安全性 → 在底部点"仍要打开"
```

同时提供一个"测试执行"接口 `POST /api/ffmpeg/test`，尝试 `ffmpeg -version`，返回 exit code 供前端诊断。

---

### 3.2 `SourceReceiver` — Icecast 推流接收

#### 职责
接收来自 ffmpeg / BUTT / Mixxx 等的 Icecast 协议 PUT 请求，转为 Node.js Readable 流。

#### Icecast 协议核心

```
请求行: PUT /source HTTP/1.0
请求头:
  Authorization: Basic <base64(mount:password)>
  Content-Type: audio/mpeg
  Ice-Name: My Radio
  Ice-Public: 1
  User-Agent: <ffmpeg/butt/etc>

响应: HTTP/1.0 200 OK
      icy-metaint: <N>  (可选, 元数据间隔)

正文: 连续的 MP3 字节流, Transfer-Encoding: chunked
```

#### 实现要点

- 监听 `PUT /source`
- 解析 `Authorization` Basic，校验（固定密码在 `config.yaml`）
- 不限制 `Content-Type`（兼容各种编码）
- 限制同时只有 1 个推流会话：新推流开始时，优雅关闭旧推流（先发 HTTP 200 给旧推流表示"被踢了"）
- `req` 本身就是 Readable，直接 pipe 给下游
- 推流断开时（网络中断/主播停止），触发 `session-end` 事件

#### 接口

```typescript
interface SourceReceiver {
  start(): Promise<void>
  getActiveSession(): SourceSession | null
  on(event: 'session-start' | 'session-end', listener: (session: SourceSession) => void): void
}

interface SourceSession {
  id: string                    // UUID
  startAt: Date
  sourceType: 'ffmpeg' | 'butt' | 'mixxx' | 'other'  // 从 User-Agent 推断
  userAgent: string
  mountpoint: string           // /source
  metadata?: {
    name?: string
    genre?: string
    description?: string
  }
}
```

#### 为什么自己实现不依赖库

现有 Node.js Icecast 库（如 `icecast-parser`）都是**解析 Icecast 流用的**，没有"接收 Icecast PUT 请求"的成熟库。自己实现 80 行代码，可控、无外部依赖。

---

### 3.3 `Broadcaster` — 实时音频分发

#### 职责
把 SourceReceiver 的当前字节流实时 fan-out 给所有听众。

#### 核心数据结构

```typescript
class Broadcaster extends EventEmitter {
  private currentStream: Readable | null   // 来自 SourceReceiver
  private ringBuffer: RingBuffer            // 默认 128KB
  private listeners: Set<ListenerConnection>
  
  pipeFrom(source: Readable): void
  subscribe(listener: ListenerConnection): void
  unsubscribe(listener: ListenerConnection): void
  isLive(): boolean
}
```

#### 新听众连接算法

1. 新 HTTP 请求到达 `GET /stream` 或 `GET /live.mp3`
2. 创建 `ListenerConnection`，加入 `listeners` Set
3. **先把 ring buffer 全部内容一次性写入响应**（让新听众从几秒前开始听，不会冷启动）
4. **订阅 `currentStream` 的 `data` 事件**，新字节直接转发
5. 推流中断（`currentStream` end）时，所有听众收到 EOF → 浏览器/VLC 自动停止
6. 听众断开（response close）时，从 Set 中移除

#### Ring buffer 大小权衡

- 128 KB ≈ MP3 @ 128 kbps **8 秒**
- 够新听众"无缝衔接"（不会冷启动）
- 又不会无限吃内存（单进程最多几 MB 总占用）

#### HTTP 响应头

```
HTTP/1.1 200 OK
Content-Type: audio/mpeg
Transfer-Encoding: chunked
Cache-Control: no-cache, no-store
Connection: keep-alive
icy-name: radioServices
icy-public: 1
```

---

### 3.4 `Archiver` — 切片 + 清理

#### 职责
把当前推流的字节流按时间段切片成 MP3 文件，并定期清理过期文件。

#### 实现方式

启动一个 ffmpeg segment 子进程，从 SourceReceiver 的 pipe 读取，写入按时间命名的文件：

```
ffmpeg -hide_banner -loglevel error \
  -i pipe:0 \
  -c copy \
  -f segment \
  -segment_time 3600 \
  -segment_atclocktime 1 \
  -strftime 1 \
  -reset_timestamps 1 \
  bin/archive/%Y-%m-%d-%H.mp3
```

#### 关键参数说明

| 参数 | 作用 |
|---|---|
| `-c copy` | 不重新编码，直接复制 MP3 帧 → CPU 占用几乎 0 |
| `-segment_time 3600` | 每 3600 秒（1 小时）一段 |
| `-segment_atclocktime 1` | 在整点切（避免漂移，文件命名整齐） |
| `-strftime 1` | 文件名支持 strftime 模板 |
| `-reset_timestamps 1` | 每段独立时间戳（不能跨段续播） |

#### 清理任务

- 每小时跑一次（`setInterval`）
- 扫描 `bin/archive/`
- 删除 `now - retentionDays` 之前的文件
- 配置项：`config.yaml` → `archive.retentionDays: 7`（默认 7 天）
- 磁盘空间低时（< 500MB）也触发清理并 Web 报警

#### Web 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/archive/list` | GET | `?days=7` 列出最近 N 天的切片 |
| `/api/archive/:filename` | GET | 流式播放切片，支持 HTTP Range (206) |
| `/api/archive/cleanup` | POST | 手动触发清理 |

---

### 3.5 `ListenerManager` — 听众会话跟踪

#### 职责
记录每个听众的连接信息，提供在线人数统计。

#### 追踪字段

```typescript
interface ListenerLog {
  id: number
  connectedAt: Date
  disconnectedAt: Date | null
  ip: string
  userAgent: string
  device: {
    type: 'desktop' | 'mobile' | 'bot' | 'other'
    os: string
    browser: string
  }
  durationSec: number | null
  referer: string | null
}
```

#### UA 解析

用轻量库 `ua-parser-js` 解析 User-Agent 得到 device/os/browser。

#### Web 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/listeners/current` | GET | `{ count, listeners: [...] }` |
| `/api/listeners/history` | GET | `?page=1&pageSize=50` 分页历史 |

---

### 3.6 `PlaylistService` — 歌单管理

#### 职责
管理"等待推流"的文件列表，支持顺序播放和循环。

#### 数据模型

```sql
CREATE TABLE playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,           -- UPLOAD_DIR 下的文件名
  display_name TEXT NOT NULL,       -- 用户起的名字
  duration_sec REAL,                -- ffprobe 探测出的时长
  position INTEGER NOT NULL,        -- 排序
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE uploaded_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,    -- UUID + 扩展名
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_sec REAL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE listener_logs (
  -- 见 3.5
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 推流触发方式

**手动推**（Web 界面点击"立即推流"）：
```
ffmpeg -re -i bin/uploads/{filename} \
  -c copy \
  -f mp3 \
  -content_type audio/mpeg \
  http://localhost:{PORT}/source
```

`-re` 让 ffmpeg 按真实速率读取（不加速播放）。

**歌单循环**：
开启后，按 `position ASC` 顺序循环推每个文件，每个文件推完自动推下一个，直到关闭循环或队列为空。

#### Web 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/source/upload` | POST | 上传音频文件（multipart） |
| `/api/source/files` | GET | 列出已上传文件 |
| `/api/source/files/:id` | DELETE | 删除已上传文件 |
| `/api/playlist` | GET | 列出歌单 |
| `/api/playlist` | POST | 添加到歌单 |
| `/api/playlist/:id` | PUT | 修改歌单项 |
| `/api/playlist/:id` | DELETE | 从歌单删除 |
| `/api/playlist/reorder` | POST | 批量调整顺序 |
| `/api/playlist/loop` | POST | `{ enabled: true|false }` |
| `/api/source/start` | POST | `{ type: 'file'|'playlist', id }` 启动推流 |
| `/api/source/stop` | POST | 停止当前推流 |

---

### 3.7 `AdminAPI` — 接口汇总

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/status` | GET | 整体状态 |
| `/api/source/start` | POST | 启动推流 |
| `/api/source/stop` | POST | 停止推流 |
| `/api/source/upload` | POST | 上传文件 |
| `/api/source/files` | GET | 已上传文件列表 |
| `/api/source/files/:id` | DELETE | 删除文件 |
| `/api/playlist` | GET/POST | 歌单 |
| `/api/playlist/:id` | PUT/DELETE | 修改/删除 |
| `/api/playlist/reorder` | POST | 重排 |
| `/api/playlist/loop` | POST | 开关循环 |
| `/api/archive/list` | GET | 切片列表 |
| `/api/archive/:file` | GET | 流式播放切片 |
| `/api/listeners/current` | GET | 当前在线 |
| `/api/listeners/history` | GET | 历史日志 |
| `/api/ffmpeg/status` | GET | ffmpeg 状态 |
| `/api/ffmpeg/download` | POST | 触发下载 |
| `/api/ffmpeg/upgrade` | POST | 升级 |
| `/api/config` | GET/PUT | 配置 |
| `/ws` | WS | 实时状态推送 |

---

### 3.8 `AdminWebUI` — 前端单页应用

#### 技术栈

- 原生 HTML + TypeScript + 极简 CSS
- 不引入 React/Vue（减少构建复杂度，对小白也更易调试）
- `esbuild` 单文件打包 → `public/admin/app.js`
- 暗色主题优先（适合长时间盯后台）

#### 页面结构（单页 4 个 tab）

1. **状态 (Dashboard)**
   - 大字号"在线推流中" / "未推流"指示
   - 当前播放文件名、推流开始时长
   - 当前在线听众数
   - 最近 24h 推流时长趋势图（用简单的 inline SVG，不引图表库）
   - ffmpeg 状态卡片

2. **推流 (Source)**
   - 拖拽上传文件区域
   - 已上传文件列表（含时长、删除按钮）
   - 歌单编辑器（拖拽排序、上下移动）
   - 循环模式开关
   - "立即推流"按钮（每个文件、歌单整体）

3. **回放 (Archive)**
   - 按日期分组的切片列表
   - 点击播放（用 `<audio>` 标签）
   - 下载按钮

4. **听众 (Listeners)**
   - 实时在线列表（每 5 秒刷新）
   - 历史日志表格（分页、搜索）

#### WebSocket 推送事件

前端订阅 `/ws`，收到事件后更新 UI：

```typescript
type WSMessage = 
  | { type: 'source-start', session: SourceSession }
  | { type: 'source-end', sessionId: string }
  | { type: 'listener-count', count: number }
  | { type: 'archive-new', file: { filename: string, sizeBytes: number } }
  | { type: 'ffmpeg-download-progress', state: DownloadState }
  | { type: 'config-changed', key: string }
```

---

### 3.9 错误处理与日志

#### 错误中间件

Fastify `setErrorHandler`：
```typescript
app.setErrorHandler((error, request, reply) => {
  logger.error({ err: error, url: request.url }, 'request failed')
  reply.status(error.statusCode || 500).send({
    error: { code: error.code || 'INTERNAL_ERROR', message: error.message }
  })
})
```

#### 关键事件日志

用 `pino` 输出到 `logs/`，按天滚动（`pino-roll`）：

| 事件 | 等级 |
|---|---|
| 服务启动/停止 | info |
| ffmpeg 检测/下载/失败 | info / warn / error |
| 推流会话 start/end | info |
| 切片创建/删除 | debug |
| 听众连接/断开 | debug |
| HTTP 5xx | error |

#### 关键失败场景

| 场景 | 行为 |
|---|---|
| ffmpeg 不可用 | 启动失败，Web 界面 503 |
| 推流断开 | 自动停止广播、WebSocket 通知前端 |
| 磁盘空间不足 | 检测到 < 500MB 触发清理 + Web 报警 |
| 推流协议错误（不是 Icecast） | 400 Bad Request |
| 单听众 1 小时无活动 | 强制断开（防卡死） |

---

### 3.10 配置管理

`config.yaml`：

```yaml
server:
  host: "0.0.0.0"
  port: 8000
  baseUrl: "http://localhost:8000"

auth:
  sourcePassword: "hackme"   # Icecast Basic Auth 密码

ffmpeg:
  version: "7.1"
  sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"

archive:
  directory: "bin/archive"
  segmentDurationSec: 3600
  retentionDays: 7
  minFreeSpaceMB: 500

playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions: [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".flac"]

logging:
  directory: "logs"
  level: "info"
  retentionDays: 30
```

配置修改通过 `PUT /api/config`，变更通过 WebSocket 推送给所有前端。

---

## 4. 项目结构

```
radioServices/
├── src/
│   ├── server.ts                # 入口
│   ├── app.ts                   # Fastify 应用工厂
│   ├── config.ts                # 配置加载
│   ├── routes/
│   │   ├── stream.ts            # GET /stream, GET /live.mp3
│   │   ├── source.ts            # PUT /source
│   │   ├── archive.ts           # GET /api/archive/*
│   │   ├── playlist.ts          # 歌单 CRUD
│   │   ├── listeners.ts         # 听众日志
│   │   ├── ffmpeg.ts            # ffmpeg 管理
│   │   ├── config.ts            # 配置
│   │   └── ws.ts                # WebSocket
│   ├── services/
│   │   ├── ffmpeg-manager.ts
│   │   ├── source-receiver.ts
│   │   ├── broadcaster.ts
│   │   ├── ring-buffer.ts
│   │   ├── archiver.ts
│   │   ├── listener-manager.ts
│   │   └── playlist-service.ts
│   ├── db/
│   │   ├── sqlite.ts            # better-sqlite3 连接
│   │   ├── schema.sql           # 表结构
│   │   └── migrations.ts        # 启动时迁移
│   ├── web/                     # 前端 TS 源码
│   │   ├── main.ts              # 入口
│   │   ├── api.ts               # API 客户端
│   │   ├── ws.ts                # WebSocket 客户端
│   │   ├── views/
│   │   │   ├── dashboard.ts
│   │   │   ├── source.ts
│   │   │   ├── archive.ts
│   │   │   └── listeners.ts
│   │   └── styles.css
│   └── utils/
│       ├── logger.ts
│       ├── ua-parser.ts
│       └── path.ts
├── public/
│   ├── index.html               # 听众落地页（可选）
│   └── admin/
│       ├── index.html           # 管理界面
│       └── app.js               # esbuild 打包输出
├── bin/                         # 运行时数据（不进 git）
│   ├── ffmpeg/
│   ├── uploads/
│   └── archive/
├── logs/                        # 运行时日志
├── tests/
│   ├── unit/
│   │   ├── ffmpeg-manager.test.ts
│   │   ├── source-receiver.test.ts
│   │   ├── broadcaster.test.ts
│   │   ├── archiver.test.ts
│   │   └── playlist-service.test.ts
│   └── integration/
│       ├── stream.test.ts
│       ├── source.test.ts
│       └── admin-api.test.ts
├── config/
│   └── config.example.yaml
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-06-29-radio-services-design.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── esbuild.config.mjs
├── vitest.config.ts
├── .gitignore
└── README.md
```

---

## 5. 测试策略

### 5.1 单元测试（Vitest）

| 模块 | 测试重点 |
|---|---|
| `FFmpegManager` | URL 拼接、SHA256 校验、解压路径、失败回退 |
| `SourceReceiver` | Icecast headers 解析、并发推流处理 |
| `Broadcaster` | 多听众 fan-out、ring buffer 边界、订阅/取消订阅 |
| `Archiver` | 文件命名、清理逻辑、并发安全 |
| `PlaylistService` | 排序、循环、CRUD |
| `RingBuffer` | 边界、覆盖、读取 |

### 5.2 集成测试（supertest + Vitest）

| 路径 | 测试内容 |
|---|---|
| 推流 → 收听 | mock ffmpeg 推 mock MP3，浏览器模拟 GET /stream |
| 上传 → 推流 | 上传文件 → 启动推流 → 验证 ffmpeg 被调用 |
| 推流 → 切片 | 持续推流 → 验证 bin/archive/ 出现文件 |
| 推流 → 听众日志 | 模拟连接 → 验证日志写入 |

### 5.3 手动 E2E 测试清单（README）

```bash
# 1. 启动服务
pnpm install
pnpm dev

# 2. 推送一个 mp3 文件（项目内 ffmpeg）
./bin/ffmpeg/current/ffmpeg -re -i test.mp3 \
  -c copy -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source

# 3. 浏览器访问
open http://localhost:8000/admin
open http://localhost:8000/stream

# 4. VLC 测试
vlc http://localhost:8000/live.mp3

# 5. 验证切片
ls bin/archive/
```

---

## 6. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| ffmpeg 下载源失效 | 项目无法启动 | v1 写死固定版本 + URL；v2 加镜像源 |
| macOS Gatekeeper 拦截 | 首次启动失败 | Web 界面给操作指引；用户手动放行 |
| 推流中断导致 ring buffer 循环依赖 | 内存泄漏 | Broadcaster 在 source-end 时清空 |
| 磁盘满 | 切片失败 | 监控 + 自动清理 + Web 报警 |
| Icecast 协议实现 bug | 兼容性问题 | 提供 `ffmpeg` 端的标准命令行示例 README；与 BUTT 实测 |
| SQLite 写入并发 | 写入失败 | 单进程 + better-sqlite3 同步 API，无此问题 |
| 切片时间漂移 | 文件名错乱 | 用 `-segment_atclocktime 1` 在整点切 |

---

## 7. 后续扩展（v2+ 留口，不在 v1 范围）

- HTTPS / 反向代理（Nginx）
- 多频道（一个进程多个 mountpoint）
- 实时元数据（ICY metadata）
- 听众账号 / 会员制
- 录制定时排程
- 移动 App
- 分布式部署 / CDN
- 数据库迁移到 PostgreSQL
- Docker 镜像

---

## 8. 验收标准

v1 完成时必须满足：

1. ✅ 服务能在 macOS / Linux / Windows 全新环境跑起来（前提：有 Node.js + 网络能访问 GitHub）
2. ✅ 首次启动自动下载 ffmpeg 到 `bin/ffmpeg/`
3. ✅ ffmpeg 下载失败时回退到系统 ffmpeg
4. ✅ 系统也没 ffmpeg 时启动失败 + Web 界面明确报错
5. ✅ 浏览器访问 `/stream` 能听到 ffmpeg 推送的音频
6. ✅ VLC 访问 `/live.mp3` 能听到同样的音频
7. ✅ 持续推流时 `bin/archive/` 出现按小时命名的 MP3 文件
8. ✅ Web 界面能看到状态、上传文件、编辑歌单、查看听众日志
9. ✅ Web 界面触发上传文件后能自动推流
10. ✅ 推流断开后听众能感知到（连接自动关闭）
11. ✅ 单元测试覆盖率 ≥ 70%
12. ✅ README 包含手动 E2E 测试步骤

---

**文档结束。请 review。**