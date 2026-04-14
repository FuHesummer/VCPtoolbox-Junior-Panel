# VCPtoolbox-Junior-Panel

> [VCPtoolbox-Junior](https://github.com/FuHesummer/VCPtoolbox-Junior) 独立管理面板前端（AdminPanel）

---

## 仓库定位

本仓库是 **纯前端静态资源仓库**，与主项目 Junior 后端**完全解耦**：

- 主项目通过 GitHub Releases 拉取本仓库的打包产物到 `AdminPanel/` 目录
- 本仓库**没有构建步骤**：HTML / CSS / JS 直接发布，主项目原样挂载为静态资源
- 前端对后端的唯一依赖是 `/admin_api/*` 一组 HTTP 接口（同源）

---

## 目录结构

```
VCPtoolbox-Junior-Panel/
├── index.html              # 主入口（包含侧边栏 + 动态 section）
├── login.html              # 登录页
├── script.js               # 主控逻辑（路由 + 鉴权 + API helper）
├── style.css               # 全局样式（深色主题 + CSS 变量）
├── js/                     # 按模块拆分的业务脚本
│   ├── agent-manager.js
│   ├── config.js
│   ├── dashboard.js        # 仪表盘（含 dashboardCards 注入）
│   ├── notes-manager.js    # 日记/知识库管理
│   ├── plugin-store.js     # 插件商店（含依赖弹窗）
│   ├── plugins.js          # 插件管理（含 adminNav 注入）
│   ├── utils.js            # 公共工具（apiFetch 等）
│   └── ...
├── easymde.min.{css,js}    # Markdown 编辑器
├── marked.min.js           # Markdown 渲染
├── tool_list_editor*.{html,js,css}  # 工具清单编辑器（独立页）
├── rag_tags_editor.*       # RAG 标签编辑器（独立页）
└── VCPLogo2.png / favicon.ico / font.woff2 / woff.css
```

---

## Release 协议

### 打包与发布

发布新版时按以下流程：

1. **合并改动到 `main` 分支**
2. **打 tag**（语义化版本号）：
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```
3. **创建 GitHub Release**：把仓库全部文件打包成 zip 上传为 release asset
   - asset 文件名必须以 `.zip` 结尾
   - 解压后应**直接是 AdminPanel 根**（不是套一层 `AdminPanel/` 子目录）
4. Junior 后端会在 3 小时内自动检测到新版本并下载

### 版本号约定

- 使用 `v<major>.<minor>.<patch>` 格式，例如 `v0.2.0`、`v1.0.0`
- **tag_name** 是 Junior 端版本比对的唯一依据（字符串相等 → 视为相同版本）
- 初始化用户会跳过首次远程检查（使用打包在主项目内的版本）

---

## Junior 后端消费机制

主项目通过 `modules/panelUpdater.js` 自动管理本仓库产物：

### 自动更新流程

```
Junior 启动
    ↓
adminServer.js → ensurePanel()
    ↓
┌─ AdminPanel/ 不存在 → 立刻下载最新 release → 解压到 AdminPanel/
│
└─ AdminPanel/ 存在
    ↓
    PANEL_AUTO_UPDATE=true ?
    ↓
    ├─ 是 → 后台检查：lastCheckTime > 3h 后拉 GitHub release API
    │       ↓
    │       tag_name != 本地 .panel-version → 下载解压覆盖
    │
    └─ 否 → 使用本地，不联网
```

### 关键环境变量

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `PANEL_RELEASE_URL` | `https://api.github.com/repos/FuHesummer/VCPtoolbox-Junior-Panel/releases/latest` | Release API 地址。设为 `disabled` 可完全禁用面板更新 |
| `PANEL_AUTO_UPDATE` | `true` | 是否启用后台自动更新（每 3 小时一次） |

### `.panel-version` 版本锚

- 文件位置：`AdminPanel/.panel-version`
- 内容：一行，当前已安装的 tag 名（如 `v0.2.0`）
- 由 `panelUpdater.js` 维护，**不要手动编辑**
- 首次安装时记录 Junior 主项目的 `package.json` version（视为 "bundled"）
- 后续每次下载新 release 后更新为对应 tag

### 受保护的文件

更新时 `panelUpdater.js` **不会覆盖**以下用户可能本地修改的文件（参考主项目实现）：
- 暂无（当前所有文件都会被覆盖 —— 用户本地改动请提交 PR 或 fork）

---

## API 契约（与 Junior 后端）

本仓库 JS 调用的 `/admin_api/*` 接口由 `VCPtoolbox-Junior/routes/admin/*` 提供。主要分组：

| 分组 | 路径前缀 | 说明 |
|------|---------|------|
| 系统 | `/admin_api/system/*` | 服务状态、重启、PM2 信息 |
| 配置 | `/admin_api/config` | 读写 `config.env` |
| 插件 | `/admin_api/plugins/*` | 列表、配置、admin 页面、开关 |
| 插件商店 | `/admin_api/plugin-store/*` | listRemote / install / resolve-deps |
| 日记/知识库 | `/admin_api/dailynotes/*` | folders / folder / note / 搜索 |
| Agent | `/admin_api/agents/*` | agent_map、文件管理 |
| TVS / Toolbox | `/admin_api/tvs`, `/admin_api/toolbox/*` | 变量文本、工具箱管理 |
| RAG | `/admin_api/rag-tags`, `/admin_api/rag-params` | 语义检索配置 |
| 调度 | `/admin_api/schedules/*` | 定时任务 |
| NewAPI 监控 | `/admin_api/newapi-monitor/*` | 上游模型服务监控 |

接口详情参见 `VCPtoolbox-Junior/docs/API_ROUTES.md`。

---

## 开发工作流

### 本地调试

```bash
# 假设在 Junior 根目录
cp -r ../VCPtoolbox-Junior-Panel/* AdminPanel/
# 或者做软链接
# 然后启动 Junior 后端
node server.js
```

访问 `http://localhost:6006/AdminPanel/` 即可。

### UI 扩展协议

本面板支持 Junior 插件注入 UI 的两种方式，由插件的 `plugin-manifest.json` 驱动：

- **`dashboardCards`** — 仪表盘卡片注入
- **`adminNav`** — 侧边栏一级导航 + 独立页面

详细协议见 [VCPtoolbox-Junior-Plugins/README.md](https://github.com/FuHesummer/VCPtoolbox-Junior-Plugins) 的 "AdminPanel UI 扩展" 章节。

### 样式规范

- 深色主题为主，使用 CSS 变量（`var(--bg-primary)`、`var(--text-primary)` 等）
- 强调色 `#0ea5e9`，危险色 `#dc2626`，成功色 `#22c55e`
- 字体：`system-ui, -apple-system, sans-serif`
- 圆角：控件 6-8px / 卡片 8-12px

### 不要做的事

- 不要引入构建工具（esbuild / vite / webpack）—— 本仓库走静态资源零构建路线
- 不要 require `node_modules`（前端）—— 仅用 CDN 或仓库自带 vendor 文件
- 不要在 JS 中硬编码 `/admin_api` 前缀之外的后端路径
- 不要假设运行在完整域名下（面板常挂在子路径）

---

## Contributors

| 贡献者 | 角色 |
|--------|------|
| [FuHe](https://github.com/FuHesummer) | 项目发起 / 架构设计 |
| 辉宝 | 项目命名 (VCPtoolbox-Junior) |

---

## License

MIT
