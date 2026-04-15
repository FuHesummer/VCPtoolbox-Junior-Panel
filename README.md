# VCPtoolbox-Junior-Panel

> **VCPtoolbox-Junior 官方管理面板** · Vue 3 + TypeScript + Vite 重构版
>
> 这是一个**独立仓库**。面板与 Junior 本体**完全解耦**，通过 Junior 暴露的 `/admin_api/*` HTTP 契约通信。
>
> 你可以基于本仓库二开，也可以参考 [PANEL_DEVELOPER_GUIDE.md](./PANEL_DEVELOPER_GUIDE.md) 从零搭建自己的面板实现。

---

## 🎯 这是什么

VCPtoolbox-Junior 采用**"纯 API 契约 + 多面板生态"**架构（参考 CLIProxyAPI 设计）：

- **本体**（[VCPtoolbox-Junior](https://github.com/lioensky/VCPToolBox-Junior)）只开放 `/admin_api/*` 管理 API
- **面板**（本仓库）是其中一个官方实现，第三方可以做任意替代面板

---

## 🚀 快速开始（本地开发）

### 1. 克隆 + 安装

```bash
git clone <panel-repo-url>
cd VCPtoolbox-Junior-Panel
npm install
```

### 2. 启动 Junior 本体

面板需要连接一个运行中的 Junior 实例。参考 [本体 README](../VCPtoolbox-Junior/README.md)：

```bash
cd /path/to/VCPtoolbox-Junior
node server.js        # 主服务  6005
node adminServer.js   # 管理代理 6006
```

### 3. 启动面板 dev 服务器

```bash
npm run dev           # 启动 Vite，默认 http://localhost:5173/AdminPanel/
```

`vite.config.ts` 已配置代理：`/admin_api/*` → `http://localhost:6006`（adminServer）

### 4. 登录

默认账号在本体的 `config.env` 里：`AdminUsername` / `AdminPassword`

---

## 📦 构建与发布

```bash
npm run build         # 输出到 dist/（vue-tsc 类型检查 + vite build）
npm run build:fast    # 跳过类型检查快速构建
npm run preview       # 本地预览 dist
npm run typecheck     # 仅类型检查
npm run lint          # ESLint
npm run test          # Vitest
```

**生产部署两种方式**：

| 方式 | 场景 |
|------|------|
| (A) 本地构建 → 本体 `ADMIN_PANEL_SOURCE` 指向本仓库 dist | 开发者自定义改动后部署 |
| (B) 下载官方 Release zip → 解压到本体 `data/panel/` | 普通用户装机 |

详见 [PANEL_DEVELOPER_GUIDE.md §7](./PANEL_DEVELOPER_GUIDE.md#7-部署与发布)

---

## 🛠️ 技术栈

- **框架**：Vue 3.5 + TypeScript + Composition API
- **构建**：Vite 5 + vue-tsc
- **路由**：vue-router 4
- **状态**：Pinia 2
- **UI**：自研组件 + Material Symbols 图标
- **主题**：粉色玻璃拟态（CSS 变量驱动）

---

## 🗂️ 项目结构

```
src/
├── api/              # 后端 API 客户端（/admin_api/* 封装）
│   ├── client.ts     # 统一 fetch 层（鉴权、loading、错误 toast）
│   ├── system.ts     # 系统监控
│   ├── plugins.ts    # 插件管理
│   ├── maintenance.ts# 运维中心
│   └── ...           # 一共 16 个模块
├── components/       # 通用组件（PageHeader / EmptyState / BaseModal...）
├── composables/      # Composition API 工具
├── config/           # 导航 / 常量配置
├── layouts/          # 主布局
├── router/           # 路由表
├── stores/           # Pinia stores（auth / toast / loader）
├── styles/           # 全局样式 + 主题
├── types/            # 公共类型声明
├── utils/            # 工具函数（markdown / 时间格式化...）
├── views/            # 页面
│   ├── overview/     # 仪表盘 / 服务器日志 / NewAPI 监控
│   ├── config/       # 全局配置 / Agent / Tvs / Toolbox
│   ├── memory/       # 日记 / 知识库 / 思维链 / RAG
│   ├── tools/        # 预处理器 / 调用审核 / 占位符
│   ├── plugins/      # 插件商店 / 插件管理 / 插件 NavView（native 渲染）
│   ├── community/    # VCP 论坛
│   └── system/       # 运维中心
├── plugin-host.ts    # 插件 native 模式的 window.__VCPPanel 宿主
├── App.vue
├── main.ts
└── env.d.ts
```

---

## 🔌 插件 native 面板

Junior 插件可以暴露一个自己的 Vue 组件挂载到本面板的侧边栏：

- 插件 manifest 里声明 `adminNav: { type: 'native', entry: 'panel.js' }`
- 本面板通过 `window.__VCPPanel` 暴露 Vue 运行时 + `pluginApi` + `showToast` 等
- 插件 `panel.js` 使用 IIFE 注册组件：`P.register('pluginName', VueComponent)`

详见 [PANEL_DEVELOPER_GUIDE.md §6](./PANEL_DEVELOPER_GUIDE.md#6-插件协议接入)

---

## 📜 替代面板

想做自己的面板？只要实现 `/admin_api/*` 的调用方即可。建议参考：

1. [PANEL_DEVELOPER_GUIDE.md](./PANEL_DEVELOPER_GUIDE.md) — 完整 API + 协议说明
2. 本仓库 `src/api/` — 每个模块都是独立 TS 文件，可直接抄 fetch 调用
3. 本仓库 `src/views/` — 参考 UI 实现

---

## 🤝 贡献

- 本仓库由 **VCPtoolbox-Junior 核心团队**维护
- 协议变更会在 [PANEL_DEVELOPER_GUIDE.md](./PANEL_DEVELOPER_GUIDE.md) 记录
- 欢迎 PR / Issue / 替代面板实现

---

## 📄 License

（跟随 Junior 本体 License）
