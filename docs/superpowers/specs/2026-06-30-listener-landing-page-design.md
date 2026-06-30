# 听众落地页设计规格

**日期**：2026-06-30
**目的**：实现 `public/index.html` 听众落地页（对应 HANDOFF B6）

---

## 1. 背景与目标

README.md 中 `public/index.html` 定义为"听众落地页"，Fastify static 插件挂载 `/` → 根路径直接服务此文件。功能定位：**让听众无需登录即可访问 `/stream` 听直播**。

## 2. 设计方案

### 方案概述：纯 HTML + CSS + HTML5 Audio（推荐）

零 JavaScript 依赖，使用原生 `<audio controls>` 元素。无直播时浏览器静默失败（不崩溃、不弹窗），符合 graceful 降级要求。

### 视觉风格

与 admin UI 保持一致的深色主题（`#0d1117` 背景），Centered 单栏布局，字体 `-apple-system`。整体简洁：Logo / 标题 + 播放器 + 版权行。

### 页面结构

```
<body>
  <div class="container">
    <div class="logo">📻</div>
    <h1>radioServices</h1>
    <p class="tagline">在线广播</p>
    <audio controls src="/stream" preload="none">
      您的浏览器不支持音频播放。
    </audio>
    <p class="footer">© 2026 · 管理入口 → <a href="/admin">/admin</a></p>
  </div>
</body>
```

### 交互设计

- **自动播放**：关闭（浏览器安全策略要求用户主动触发）
- **无源时**：`/stream` 返回 503，`<audio>` 静默停止，不弹错误
- **加载行为**：`preload="none"` — 不预加载，等待用户点击播放才请求
- **样式**：播放按钮居中，深色背景与 admin 风格统一

### 无需实现（精简范围）

- JS 状态轮询（`/api/status` 不需要）
- 实时在线人数显示
- 动态 live/offline 徽章
- 备用流地址切换

---

## 3. 文件清单

| 文件 | 操作 |
|---|---|
| `public/index.html` | 新建（替换 Fastify 默认根路径行为） |

## 4. 验收标准

1. `GET /` 返回 `public/index.html`（Fastify static 默认行为）
2. 页面可访问，有 `<audio controls src="/stream">`
3. 无直播时，播放按钮可点击但不报错
4. `pnpm typecheck` exit 0
5. 无新增 `any` 类型
