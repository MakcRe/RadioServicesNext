# radioServices

一个用 Node.js + TypeScript 实现的本地广播电台服务器。通过 ffmpeg 命令行或浏览器界面上传音频，实时推流给听众，并自动按小时切片存档。

---

## 特性

- **零配置启动**：自动检测或下载 ffmpeg，无需手动安装
- **双入口推流**：命令行 ffmpeg / Web 界面上传均支持
- **实时收听**：`/stream` 和 `/live.mp3` 双 URL，浏览器和 VLC/MPV 均可播放
- **自动存档**：持续推流时按整点切片为 MP3，支持回放最近 N 天
- **管理界面**：状态面板、歌单管理、听众日志、ffmpeg 下载进度
- **跨平台**：支持 macOS / Linux / Windows

---

## 快速上手

### 1. 安装依赖

```bash
pnpm install
```

### 2. 初始化配置

```bash
cp config/config.example.yaml config/config.yaml
```

根据需要编辑 `config/config.yaml`，默认配置如下：

```yaml
server:
  host: "0.0.0.0"
  port: 8000

auth:
  sourcePassword: "hackme"   # 推流密码

ffmpeg:
  version: "7.1"
  sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"

archive:
  directory: "bin/archive"
  segmentDurationSec: 3600   # 每小时一片
  retentionDays: 7           # 保留 7 天

playlist:
  uploadDir: "bin/uploads"
  maxFileSizeMB: 500
  allowedExtensions:
    - ".mp3"
    - ".m4a"
    - ".aac"
    - ".ogg"
    - ".wav"
    - ".flac"
```

### 3. 启动服务

```bash
pnpm dev
```

首次启动时，如果项目内没有 ffmpeg，会自动从 GitHub 下载（预计 30-60 秒）。Web 界面会在下载完成后刷新状态。

### 4. 推流音频

**方式一：命令行推流（使用项目内 ffmpeg）**

```bash
./bin/ffmpeg/current/ffmpeg -re -i your_audio.mp3 \
  -c copy -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source
```

**方式二：Web 界面上传**

浏览器打开 http://localhost:8000/admin，进入「推流」标签页，拖拽上传音频文件，点击「立即推流」。

> 推流密码默认为 `hackme`，可在 `config.yaml` 中修改 `auth.sourcePassword`。

### 5. 收听

- 浏览器：http://localhost:8000/stream 或 http://localhost:8000/live.mp3
- VLC：`vlc http://localhost:8000/live.mp3`
- 回放存档：http://localhost:8000/admin，进入「回放」标签页

---

## 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    radioServices (Node.js)                    │
│                                                              │
│  ┌──────────┐     ┌────────────────┐     ┌──────────────┐   │
│  │ ffmpeg   │────▶│  Source        │     │   Listener   │◀──┼─── 浏览器 / VLC
│  │ (推流端) │ PUT │  Receiver      │◀───▶│   Broadcaster│──▶│── 浏览器 / VLC
│  └──────────┘     └───────┬────────┘     └──────────────┘   │
│       │                   │                       │         │
│       │           ┌───────▼────────┐              │         │
│       │           │   Archiver     │              │         │
│       │           │ (ffmpeg切片)   │              │         │
│       │           └───────┬────────┘              │         │
│       │                   │                       │         │
│       │           ┌───────▼────────┐              │         │
│       │           │ bin/archive/   │              │         │
│       │           │ YYYY-MM-DD-HH.mp3            │         │
│       │           └────────────────┘              │         │
│  ┌────▼────────────────────────────────────────────▼─────┐  │
│  │                SQLite (歌单/配置/日志)                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │       Admin Web UI (HTML + TS, 浏览器内可视化)         │  │
│  │   状态页 / 推流控制 / 歌单 / 听众日志                    │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

三条核心数据路径：

- **推流路径**：ffmpeg PUT /source → SourceReceiver → Broadcaster → Archiver
- **实时收听**：浏览器/VLC GET /stream → Broadcaster → 实时音频流
- **回放路径**：GET /archive/YYYY-MM-DD-HH.mp3 → 存档文件（支持 HTTP Range seek）

---

## 配置说明

### YAML 配置文件

所有配置项均在 `config/config.yaml` 中管理：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `server.host` | `"0.0.0.0"` | 监听地址 |
| `server.port` | `8000` | 监听端口 |
| `auth.sourcePassword` | `"hackme"` | 推流鉴权密码 |

> **⚠️ SECURITY**: Always change `auth.sourcePassword` from the default value
> (`hackme`) before deploying. The server logs a warning on startup if the
> default is detected, but this is a fail-open check — production deployments
> should never rely on the default.
| `ffmpeg.version` | `"7.1"` | ffmpeg 版本 |
| `archive.retentionDays` | `7` | 存档保留天数 |
| `archive.minFreeSpaceMB` | `500` | 磁盘空间警戒线 |

### 环境变量

暂不支持环境变量覆盖，所有配置通过 `config.yaml` 管理。

---

## 测试

### 运行所有测试

```bash
pnpm test
```

### 监听模式（开发时）

```bash
pnpm test:watch
```

### 类型检查

```bash
pnpm typecheck
```

---

## 故障排查

### macOS 提示「无法打开，因为无法验证开发者」

这是 Gatekeeper 安全机制。解决方法：

1. 打开「系统设置」→「隐私与安全性」
2. 滚动到下方，点击「仍要打开」
3. 重新启动服务

### ffmpeg 下载失败

- 检查网络能否访问 GitHub（`https://github.com/BtbN/FFmpeg-Builds/releases`）
- 或手动下载对应平台的 ffmpeg，放到 `bin/ffmpeg/current/` 目录
- 确认文件名为 `ffmpeg`（macOS/Linux）或 `ffmpeg.exe`（Windows）

### 端口 8000 被占用

修改 `config/config.yaml` 中的 `server.port`，或找出占用进程：

```bash
# macOS / Linux
lsof -i :8000

# Windows
netstat -ano | findstr :8000
```

### 推流失败（401 Unauthorized）

确认推流命令中的密码与 `config.yaml` 中 `auth.sourcePassword` 一致。

### 听众收听无声音

- 确认推流正在进行中（管理界面状态栏显示「推流中」）
- 确认浏览器/VLC 连接到的是正确的 URL
- 尝试用 VLC 播放 `http://localhost:8000/live.mp3`

---

## 协议兼容性

radioServices 实现了 Icecast HTTP 流协议，兼容以下客户端：

| 客户端 | 平台 | 推流 | 收听 |
|---|---|---|---|
| ffmpeg | macOS/Linux/Windows | 支持 | 支持 |
| VLC | 全部 | 支持 | 支持 |
| MPV | 全部 | 支持 | 支持 |
| BUTT | macOS/Linux/Windows | 支持 | - |
| Mixxx | 全部 | 支持 | - |
| Safari / Chrome / Firefox | 全部 | - | 支持 |

### 推荐推流命令

```bash
# 推流本地文件（单曲循环）
./bin/ffmpeg/current/ffmpeg -stream_loop -1 -re -i your_audio.mp3 \
  -c copy -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source

# 推流麦克风输入（ macOS）
./bin/ffmpeg/current/ffmpeg -f avfoundation -i ":0" \
  -c:a libmp3lame -b:a 128k \
  -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source

# 推流远程流（如网络电台）
./bin/ffmpeg/current/ffmpeg -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -i "https://example.com/stream.mp3" \
  -c copy -f mp3 -content_type audio/mpeg \
  http://localhost:8000/source
```

---

## 路线图

### v1.0 — 当前版本
- 单频道 Icecast 流服务器
- 自动 ffmpeg 安装
- 按小时自动切片存档
- Web 管理界面（状态/推流/回放/听众）
- 歌单循环推流

### v2.0
- 多频道支持
- 实时元数据（ICY metadata）
- HTTPS 支持
- Web 端录音功能

### v3.0
- Docker 部署
- 多语言管理界面
- 定时推流排程
- API 令牌鉴权

---

## 项目结构

```
radioServices/
├── src/
│   ├── server.ts                # 入口
│   ├── app.ts                   # Fastify 应用工厂
│   ├── config.ts                # 配置加载
│   ├── routes/                  # API 路由
│   ├── services/                # 核心服务
│   ├── db/                      # SQLite 数据层
│   ├── web/                     # 前端 TS 源码
│   └── utils/                   # 工具函数
├── public/
│   ├── index.html               # 听众落地页
│   └── admin/                   # 管理界面
├── bin/                         # 运行时数据（ffmpeg/歌单/存档）
├── logs/                        # 运行时日志
├── tests/                       # 单元测试 + 集成测试
├── config/
│   └── config.example.yaml      # 配置模板
├── docs/
│   └── superpowers/specs/       # 设计规格文档
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 许可

MIT License
