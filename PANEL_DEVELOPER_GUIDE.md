# VCPtoolbox-Junior 管理面板开发指南

> **面向对象**：想要**替代/扩展/重新实现** Junior 管理面板的开发者
>
> **核心思想**：Junior 本体只暴露 HTTP API，面板是**独立仓库**，通过契约通信。
> 你写任意技术栈的面板（React / Svelte / Next.js / Tauri / 命令行...）都能对接。

---

## 目录

1. [架构概览](#1-架构概览)
2. [鉴权机制](#2-鉴权机制)
3. [双服务架构](#3-双服务架构)
4. [API 总览](#4-api-总览)
5. [核心约定](#5-核心约定)
6. [插件协议接入](#6-插件协议接入)
7. [部署与发布](#7-部署与发布)
8. [常见问题](#8-常见问题)

---

## 1. 架构概览

```
┌────────────────────────────────────────────────────────────────┐
│                   你的面板（任意技术栈）                        │
│                                                                 │
│  ① 静态站点 → 构建产物丢 data/panel/ 由本体挂载                  │
│  ② Dev 模式  → 面板 dev server 代理到 adminServer               │
│  ③ 桌面端    → 直接跨域调用 adminServer API                      │
└────────────────────────────────────────────────────────────────┘
                            ↓  HTTP /admin_api/*
┌────────────────────────────────────────────────────────────────┐
│  VCPtoolbox-Junior 本体                                        │
│                                                                 │
│  ┌─ adminServer.js (6006) ───────────────┐                     │
│  │  鉴权层 + 静态面板挂载 + API 反代       │                     │
│  │  · 鉴权中间件：Basic Auth / Cookie     │                     │
│  │  · 静态挂载：/AdminPanel/* → dist/     │                     │
│  │  · 反代：/admin_api/* → main server    │                     │
│  └────────────────────────────────────────┘                     │
│                        ↓                                        │
│  ┌─ server.js (6005) ────────────────────┐                     │
│  │  主服务：Chat API + 插件执行 +          │                     │
│  │          /admin_api/* 业务路由          │                     │
│  │  · 16 个模块 × 97 endpoints             │                     │
│  │  · 插件动态路由 /admin_api/plugins/:name/api/*                │
│  └────────────────────────────────────────┘                     │
└────────────────────────────────────────────────────────────────┘
```

### 面板与本体的约定

- 面板只访问 `/admin_api/*`（除登录相关）
- 面板 URL 前缀：`/AdminPanel/`（Vue Router base 或静态 server 路径）
- 所有 API 都要求鉴权（除 `/admin_api/verify-login` 自己）
- 响应格式约定见 [§5 核心约定](#5-核心约定)

---

## 2. 鉴权机制

### 2.1 登录流程

```
POST /admin_api/verify-login
Content-Type: application/json
Body: { "username": "xxx", "password": "xxx" }

→ 成功：Set-Cookie: sessionId=xxx; HttpOnly
→ 失败：401
```

### 2.2 鉴权方式

后端同时接受两种鉴权方式（任一即可）：

| 方式 | 适用场景 | 示例 |
|------|---------|------|
| **Cookie Session** | 浏览器环境（登录后自动） | `credentials: 'include'` |
| **HTTP Basic Auth** | curl / 桌面端 / CI | `Authorization: Basic base64(user:pass)` |

### 2.3 检查登录态

```
GET /admin_api/check-auth
→ 200 { authenticated: true }  // 或 401
```

### 2.4 登出

```
POST /admin_api/logout
→ 清除 cookie
```

### 2.5 前端封装建议

参考本仓库 `src/api/client.ts`：

```typescript
export async function apiFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    credentials: 'include',   // 带 cookie
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  })
  if (res.status === 401) {
    // 重定向登录页
    window.location.href = '/AdminPanel/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}
```

---

## 3. 双服务架构

Junior 本体跑两个 Node 进程：

| 进程 | 端口 | 职责 |
|------|------|------|
| `server.js` | 6005 | 主服务：Chat API / 插件执行 / `/admin_api/*` 业务逻辑 |
| `adminServer.js` | 6006 | 管理代理：鉴权 + 静态面板 + `/admin_api/*` 反代到 6005 |

### 面板应该连哪个？

- **生产环境**：连 `adminServer` (6006)。它做鉴权 + 挂载面板 + 反代
- **开发环境**：同样连 6006。Vite dev server 代理 `/admin_api/*` → `http://localhost:6006`

### adminServer 反代细节

- 所有 `/admin_api/*` 请求经过鉴权检查后透传到 6005
- SSE（Server-Sent Events）支持（运维中心 `/admin_api/maintenance/jobs/:id/stream` 依赖）
- POST 空 body 兼容（`req.body !== undefined` 检查）

---

## 4. API 总览

Junior 本体在 `routes/admin/*.js` 一共 **16 个模块 × 97 个端点**。

### 4.1 分组速查表

| 模块 | 端点前缀 | 文件 |
|------|---------|------|
| [服务器](#41-服务器-server) | `/server/*` `/verify-login` `/logout` `/check-auth` | server.js |
| [系统监控](#42-系统监控-system) | `/system-monitor/*` `/weather` `/dailyhot` `/user-auth-code` | system.js |
| [日志](#43-日志-logs) | `/server-log/*` | logs.js |
| [配置](#44-配置-config) | `/config/main*` `/tool-approval-*` | config.js |
| [插件](#45-插件-plugins) | `/plugins/*` `/preprocessors/order` `/plugin-ui-prefs` | plugins.js |
| [插件商店](#46-插件商店-plugin-store) | `/plugin-store/*` | pluginStore.js |
| [Agents](#47-agents) | `/agents/*` | agents.js |
| [TVS 变量](#48-tvs-变量) | `/tvsvars/*` | tvs.js |
| [Toolbox](#49-toolbox) | `/toolbox/*` | toolbox.js |
| [占位符](#410-占位符) | `/placeholders*` | placeholders.js |
| [定时调度](#411-定时调度) | `/schedules*` | schedules.js |
| [RAG](#412-rag) | `/rag-*` `/semantic-*` `/thinking-*` `/vectordb-*` `/available-clusters` | rag.js |
| [工具列表编辑器](#413-工具列表编辑器) | `/tool-list-editor/*` | toolListEditor.js |
| [日记/知识库](#414-日记知识库) | `/dailynotes/*` | dailyNotes.js → dailyNotesRoutes.js |
| [NewAPI 监控](#415-newapi-监控) | `/newapi-monitor/*` | newapiMonitor.js |
| [仪表盘布局](#416-仪表盘布局) | `/dashboard-layout` | dashboardLayout.js |
| [运维中心](#417-运维中心) | `/maintenance/*` | maintenance.js |

### 4.1 服务器 server

| Method | Path | 用途 |
|--------|------|------|
| POST | `/server/restart` | 重启主服务 |
| POST | `/verify-login` | 登录 |
| POST | `/logout` | 登出 |
| GET  | `/check-auth` | 检查登录态 |

### 4.2 系统监控 system

| Method | Path | 用途 |
|--------|------|------|
| GET | `/system-monitor/system/resources` | CPU / 内存 / Node 进程 |
| GET | `/system-monitor/pm2/processes` | PM2 进程列表 |
| GET | `/user-auth-code` | UserAuth 插件验证码 |
| GET | `/weather` | 天气信息（WeatherReporter） |
| GET | `/dailyhot` | 热榜数据（DailyHot） |

### 4.3 日志 logs

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/server-log` | 当前会话日志（支持 `offset` / `incremental`） |
| POST   | `/server-log/clear` | 清空当前日志 |
| GET    | `/server-log/archives` | 归档列表（按日期） |
| GET    | `/server-log/archives/:date/:index` | 单个归档内容 |
| DELETE | `/server-log/archives/:date/:index` | 删除归档 |
| GET    | `/server-log/restart-logs` | 重启脚本日志 |

### 4.4 配置 config

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/config/main` | 主配置（去敏感） |
| GET  | `/config/main/raw` | 原始 `config.env` 文本 |
| POST | `/config/main` | 保存主配置 |
| GET  | `/tool-approval-config` | 工具调用审核配置 |
| POST | `/tool-approval-config` | 更新审核配置 |
| GET  | `/tool-approval-pending` | 待审工具调用列表 |
| POST | `/tool-approval-pending/:requestId` | 批准/拒绝 |

### 4.5 插件 plugins

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/plugins` | 插件列表（含 manifest） |
| POST | `/plugins/:name/toggle` | 启用/禁用 |
| POST | `/plugins/:name/description` | 改描述 |
| POST | `/plugins/:name/config` | 旧版配置保存 |
| POST | `/plugins/:name/commands/:cmd/description` | 改工具命令描述 |
| GET  | `/plugins/:name/config-schema` | 配置项 schema |
| POST | `/plugins/:name/config-values` | 按 schema 保存配置 |
| GET  | `/plugins/:name/admin-page` | 插件 admin 页面 HTML（iframe 模式） |
| GET  | `/plugins/:name/admin-assets/*subpath` | 插件 admin 静态资源（native 模式 panel.js + dashboardCards） |
| GET  | `/preprocessors/order` | 预处理器顺序 |
| POST | `/preprocessors/order` | 保存顺序 |
| GET  | `/plugin-ui-prefs` | 插件 UI 开关偏好（dashboardCards / adminNav 开关） |
| POST | `/plugin-ui-prefs` | 保存偏好 |

### 4.6 插件商店 plugin-store

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/plugin-store/remote` | 云端可用列表 |
| GET  | `/plugin-store/installed` | 本地已装列表 |
| GET  | `/plugin-store/updates` | 可更新列表 |
| GET  | `/plugin-store/resolve-deps/:name` | 依赖解析（连锁安装） |
| POST | `/plugin-store/install/:name` | 安装 |
| POST | `/plugin-store/update/:name` | 更新 |
| POST | `/plugin-store/uninstall/:name` | 卸载 |

### 4.7 Agents

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/agents/map` | Agent 别名映射 |
| POST   | `/agents/map` | 保存映射 |
| GET    | `/agents` | Agent 文件列表 |
| POST   | `/agents/new-file` | 创建新 Agent 提示词文件 |
| GET    | `/agents/:fileName` | 单个 Agent 内容 |
| POST   | `/agents/:fileName` | 保存内容 |
| GET    | `/agents/:alias/avatar` | 头像 |
| POST   | `/agents/:alias/avatar` | 上传头像 |
| DELETE | `/agents/:alias/avatar` | 删除头像 |

### 4.8 TVS 变量

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/tvsvars` | 变量文件列表 |
| GET    | `/tvsvars/:fileName` | 单个变量内容 |
| POST   | `/tvsvars/:fileName` | 保存 |
| DELETE | `/tvsvars/:fileName` | 删除 |

### 4.9 Toolbox

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/toolbox/map` | Toolbox 配置映射 |
| POST | `/toolbox/map` | 保存映射 |
| GET  | `/toolbox/files` | 文件列表（元数据） |
| GET  | `/toolbox/file/:encodedPath` | 单文件内容（含 fold blocks） |
| POST | `/toolbox/file/:encodedPath` | 保存 |
| POST | `/toolbox/new-file` | 新建 |

### 4.10 占位符

| Method | Path | 用途 |
|--------|------|------|
| GET | `/placeholders` | 所有占位符清单（插件注册 + 内置） |
| GET | `/placeholders/detail` | 占位符详情（包含来源） |

### 4.11 定时调度

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/schedules` | 定时任务列表 |
| POST   | `/schedules` | 创建/更新 |
| DELETE | `/schedules/:id` | 删除 |

### 4.12 RAG

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/rag-tags` | RAG 标签配置 |
| POST | `/rag-tags` | 保存（writeFile-style，直接落盘 body） |
| GET  | `/rag-params` | RAG 热参数 |
| POST | `/rag-params` | 保存 |
| GET  | `/semantic-groups` | 语义组 |
| POST | `/semantic-groups` | 保存 |
| GET  | `/thinking-chains` | 思维链 |
| POST | `/thinking-chains` | 保存 |
| GET  | `/available-clusters` | 可用思维簇 |
| GET  | `/vectordb-status` | 向量库状态 |

### 4.13 工具列表编辑器

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/tool-list-editor/tools` | 工具总表 |
| GET    | `/tool-list-editor/configs` | 配置文件列表 |
| GET    | `/tool-list-editor/config/:name` | 单个配置 |
| POST   | `/tool-list-editor/config/:name` | 保存 |
| DELETE | `/tool-list-editor/config/:name` | 删除 |
| GET    | `/tool-list-editor/check-file/:file` | 预览文件 |
| POST   | `/tool-list-editor/export/:file` | 导出为 TVS 变量 |

### 4.14 日记/知识库

路由前缀：`/dailynotes/*`

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/dailynotes/search` | 跨文件夹搜索 |
| GET  | `/dailynotes/admin/queue-status` | 写入队列状态 |
| GET  | `/dailynotes/folders` | 文件夹列表（支持 `?mode=diary\|knowledge\|public`） |
| GET  | `/dailynotes/folder/:folder` | 单文件夹内容 |
| GET  | `/dailynotes/note/:folder/:file` | 单笔记内容 |
| POST | `/dailynotes/note/:folder/:file` | 保存笔记 |
| POST | `/dailynotes/move` | 批量移动 |
| POST | `/dailynotes/delete-batch` | 批量删除 |
| POST | `/dailynotes/folder/delete` | 删除空文件夹 |
| POST | `/dailynotes/associative-discovery` | 联想追溯 |

### 4.15 NewAPI 监控

| Method | Path | 用途 |
|--------|------|------|
| GET | `/newapi-monitor/summary` | 总览 |
| GET | `/newapi-monitor/trend` | 趋势数据 |
| GET | `/newapi-monitor/models` | 按模型维度 |
| GET | `/newapi-monitor/dimensions` | 按 Key/User/Channel 维度 |

### 4.16 仪表盘布局

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/dashboard-layout` | 用户自定义布局 |
| POST | `/dashboard-layout` | 保存（writeFile-style） |

### 4.17 运维中心

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/maintenance/scripts` | 白名单脚本清单 |
| POST | `/maintenance/run` | 启动脚本（串行锁，只允许 1 个并发） |
| GET  | `/maintenance/jobs/current` | 当前运行中任务 |
| GET  | `/maintenance/jobs/:id` | 单个任务详情（含 stdout） |
| POST | `/maintenance/jobs/:id/cancel` | SIGTERM（3s 后 SIGKILL） |
| GET  | `/maintenance/jobs/:id/stream` | **SSE** 实时日志流 |
| GET  | `/maintenance/history` | 审计历史（落盘 data/maintenance-history.json） |

---

## 5. 核心约定

### 5.1 writeFile-style POST

RAG / dashboard-layout / 部分 TVS 端点采用"**body 即文件内容**"模式：

```javascript
// 前端直接把整个 object 塞进 body，后端落盘
await fetch('/admin_api/rag-tags', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tags: [...], someField: 'x' }),  // 不要包 wrapper
})
```

### 5.2 错误响应

统一结构：

```json
{ "error": "错误消息", "details": "可选详情" }
```

状态码：

| Code | 语义 |
|------|------|
| 400 | 参数错误 |
| 401 | 未登录 |
| 403 | 已登录但权限不足 / 路径穿越等 |
| 404 | 资源不存在 |
| 409 | 并发冲突（如运维中心串行锁） |
| 429 | 频率限制 |
| 500 | 服务器内部错误 |
| 503 | 服务暂不可用（插件管理器未就绪） |
| 504 | 网关超时 |

### 5.3 SSE 实时流

运维中心 `/maintenance/jobs/:id/stream` 是标准 SSE：

```
event: replay
data: {"text": "...之前缓冲的输出..."}

event: chunk
data: {"kind": "stdout", "text": "..."}

event: done
data: {"status": "completed", "exitCode": 0, "finishedAt": "..."}
```

前端用 `EventSource` + `withCredentials: true`。

---

## 6. 插件协议接入

Junior 插件可以扩展管理面板，一共 4 种协议：

### 6.1 adminNav — 侧边栏入口

插件 `plugin-manifest.json`：

```json
{
  "adminNav": {
    "title": "我的插件",
    "icon": "extension",
    "type": "native",            // 或 "iframe"
    "entry": "panel.js"          // native 时的 Vue 组件入口
  }
}
```

面板读取 `GET /admin_api/plugins` 中每个启用插件的 `manifest.adminNav`，过滤后注入侧边栏。

### 6.2 pluginAdminRouter — 插件自带后端 API

插件 `module.exports` 暴露 Express.Router：

```javascript
const express = require('express');
const pluginAdminRouter = express.Router();
pluginAdminRouter.use(express.json());
pluginAdminRouter.get('/items', (req, res) => res.json([...]));
pluginAdminRouter.post('/items', async (req, res) => { ... });

module.exports = { initialize, shutdown, pluginAdminRouter };
```

前端访问 `/admin_api/plugins/<PluginName>/api/items` 会自动分发到插件的 router。

### 6.3 native 面板 — 共享 Vue 运行时

插件 `admin/panel.js` 使用 IIFE 注册组件：

```javascript
(function () {
  const P = window.__VCPPanel;   // 主面板暴露的 Vue + helpers
  if (!P) return;
  const { ref, computed, onMounted } = P.Vue;
  const { pluginApi, showToast } = P;
  const api = pluginApi('MyPlugin');   // 自动带 /admin_api/plugins/MyPlugin/api 前缀

  const MyPluginPage = {
    name: 'MyPluginPage',
    template: `<div class="page">...</div>`,
    setup() {
      const data = ref([]);
      onMounted(async () => {
        data.value = await api.get('/items');
      });
      return { data };
    },
  };
  P.register('MyPlugin', MyPluginPage);
})();
```

**window.__VCPPanel 的暴露内容**（本仓库 `src/plugin-host.ts`）：

| 字段 | 说明 |
|------|------|
| `Vue` | Vue 3 运行时（`ref / computed / onMounted / watch / ...`） |
| `register(name, component)` | 注册插件组件 |
| `pluginApi(name)` | 构造插件 API 客户端（`.get/.post/.put/.delete`） |
| `showToast(msg, kind)` | 消息提示 |
| `formatTime(ms)` | 时间格式化 |
| `markdown(text)` | 简易 markdown 渲染 |

**五条黄金规则**（panel.js 开发避坑）：

1. 绝不在 `template: \`...\`` 字符串里用 `${jsExpr}` — 用字符串拼接或 Vue 的 `{{ }}` 插值
2. 绝不在 Teleport 出去的 DOM 上用祖先选择器（`.page .child`）— 用独立 class 前缀
3. style 注入要**每次覆盖**：`oldStyle?.remove()` 再 appendChild，不要 idempotent skip
4. 改造前必须读插件 `.js` 源码找到真实 API 路径 — 不能从 `admin/index.html` 反推
5. 插件 admin API 走解耦路径 `/admin_api/plugins/:name/api/*`（插件自己 pluginAdminRouter 实现）

### 6.4 dashboardCards — 仪表盘卡片

插件 `plugin-manifest.json`：

```json
{
  "dashboardCards": [
    {
      "id": "my-summary",
      "title": "我的插件",
      "icon": "star",
      "source": "dashboard-card.html"   // admin/ 目录下的 HTML 片段
    }
  ]
}
```

面板读取所有启用插件的 `manifest.dashboardCards`，通过 `/admin_api/plugins/:name/admin-assets/<source>` 拉 HTML，注入到 Dashboard 卡片容器。

HTML 可内嵌 `<script>` 走 `/admin_api/*` 拉数据（前端已处理 script 重新挂载）。

### 6.5 tvsVariables — 插件自带占位符

插件 `plugin-manifest.json`：

```json
{
  "capabilities": {
    "tvsVariables": [
      {
        "key": "VarMyTool",
        "file": "tvs/mytool.txt",
        "description": "我的工具使用指南"
      }
    ]
  }
}
```

**加载行为**（"首次移动 + 保留用户改动"策略）：
- 首次加载：`<pluginDir>/tvs/mytool.txt` → 移动到 `TVStxt/mytool.txt`
- 用户在 TvsEditor 修改后：再次启动不会被覆盖
- 卸载（通过 PluginStore）：删除 `TVStxt/` 下的文件

面板侧不需要特殊处理 — 面板只管呈现 `TVStxt/*`，移动逻辑在本体 `Plugin.js` 里。

### 6.6 admin-assets 静态资源

所有上述协议涉及的插件静态资源都走：

```
GET /admin_api/plugins/:pluginName/admin-assets/:subpath
```

**安全**：subpath 做了 path traversal 校验，只能访问插件 `admin/` 目录下的文件。

**缓存**：已禁用浏览器缓存（Cache-Control: no-cache），panel.js 改版立即生效。

---

## 7. 部署与发布

### 7.1 开发模式

```bash
# 在面板仓库
npm run dev
# → Vite dev server 起在 5173，代理 /admin_api/* 到 adminServer 6006
```

本体侧不需要做任何配置。

### 7.2 生产模式（源码 → 构建 → 挂载）

```bash
# 在面板仓库
npm run build                # 产出 dist/

# 本体 config.env 新增
ADMIN_PANEL_SOURCE=/absolute/path/to/panel/dist
# （未来增强：也支持 git URL / zip URL）

# 本体重启
node adminServer.js
# → adminServer 启动时读配置，挂载 dist 为 /AdminPanel/* 静态路径
```

> **当前状态**：`ADMIN_PANEL_SOURCE` 配置项尚未在本体实装（Task #157 进行中），过渡期 adminServer 仍从本体内置 `AdminPanel-Vue/dist/` 加载。

### 7.3 Release 发布

面板仓库使用 GitHub Actions 构建并发布 zip：

```yaml
# .github/workflows/release.yml (规划中)
on:
  push:
    tags: [v*.*.*]
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: softprops/action-gh-release@v1
        with:
          files: panel-dist.zip
```

用户装机：

```bash
# 本体里
curl -LO https://github.com/<org>/VCPtoolbox-Junior-Panel/releases/latest/download/panel-dist.zip
unzip panel-dist.zip -d data/panel/
# 在 config.env 填：ADMIN_PANEL_SOURCE=data/panel
```

### 7.4 多面板切换（面板 Registry）

> **规划中**（Task #158）

本体将维护 `panel-registry.json`，列出官方认证 + 社区面板：

```json
{
  "panels": [
    {
      "name": "official",
      "repo": "https://github.com/.../VCPtoolbox-Junior-Panel",
      "release": "https://.../releases/latest",
      "maintainer": "Junior Core Team"
    },
    {
      "name": "minimal",
      "repo": "...",
      "description": "极简命令行风格面板"
    }
  ]
}
```

用户可在"面板商店"一键切换。

---

## 8. 常见问题

### Q1: CORS 问题？

同源部署（adminServer 同时提供面板 + API）完全没问题。
跨域调用（桌面端 / 独立域名）需要配置 adminServer CORS 白名单，或走 HTTP Basic Auth（免 cookie）。

### Q2: SSE 断流？

- 确保经过的所有代理（Vite / adminServer / Nginx 如果有）都开启流式转发
- adminServer 反代代码在 `adminServer.js` 已处理 SSE（`proxyRes.pipe(res)`）
- 后端 `res.flushHeaders()` + 15s 心跳（`:hb\n\n`）防超时断开

### Q3: panel.js 热更新怎么做？

admin-assets 端点已禁用缓存。插件 panel.js 改完硬刷浏览器（Ctrl+Shift+R）即可生效。

不用重启主服务（`/admin_api/plugins/:name/admin-assets/*` 实时读文件）。

### Q4: 替代面板最小骨架？

三个文件即可：

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head><title>Minimal Panel</title></head>
<body>
  <button id="refresh">刷新插件列表</button>
  <pre id="output"></pre>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

```javascript
// main.js
async function fetchPlugins() {
  const res = await fetch('/admin_api/plugins', { credentials: 'include' })
  if (res.status === 401) return location.href = '/AdminPanel/login.html'
  const data = await res.json()
  document.getElementById('output').textContent = JSON.stringify(data, null, 2)
}
document.getElementById('refresh').onclick = fetchPlugins
fetchPlugins()
```

```html
<!-- login.html（复用本仓库 src/views/LoginView.vue 逻辑，或自己写个最小表单） -->
```

把这 3 个文件放到任意 HTTP 目录 → 通过 `ADMIN_PANEL_SOURCE` 指向即可。

### Q5: 想参考现有实现？

- `src/api/` 每个模块都是独立 TS 文件，API 契约清清楚楚
- `src/views/` 页面实现，粉色玻璃拟态主题可改可抄
- `src/components/BaseModal.vue` 等通用组件可直接复用

### Q6: 面板会随本体升级吗？

不会。面板和本体**独立版本**。

- 本体变更 API 会在这份 [PANEL_DEVELOPER_GUIDE.md](./PANEL_DEVELOPER_GUIDE.md) 里打版本记录
- 面板可以选择兼容旧 API 或跟进新 API
- 每次重大协议变更（breaking change）本体会在 CHANGELOG 标注

---

## 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-15 | v2.0 | 独立仓库化；Vue 3 重构版替换旧静态面板；写开发指南 |
| 2026-04-14 | v1.x | Plugin admin 协议 v2.0（pluginAdminRouter + native 模式） |
| 2026-04-14 | v1.x | TVS 工具指南协议 v2.1（tvsVariables） |

---

**Questions / Feedback** → 在 [VCPtoolbox-Junior](https://github.com/lioensky/VCPToolBox-Junior) 仓库开 issue，标题带 `[Panel]` 前缀
