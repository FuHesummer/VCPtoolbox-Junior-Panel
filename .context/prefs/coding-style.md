# Coding Style Guide — VCPtoolbox-Junior-Panel

> 此文件定义团队编码规范，所有 LLM 工具在修改代码时必须遵守。
> 提交到 Git，团队共享。

## General
- Prefer small, reviewable changes; avoid unrelated refactors.
- Keep functions short (<50 lines); avoid deep nesting (≤3 levels).
- Name things explicitly; no single-letter variables except loop counters.
- Handle errors explicitly; never swallow errors silently.

## TypeScript / Vue 3

- Strict TypeScript mode; prefer `interface` for object shapes, `type` for unions/mapped types。
- Vue 3 Composition API（`<script setup>`），优先 `ref`/`computed`；避免 Options API 混用。
- Vue 模板注意 **mustache 嵌套冲突**：当变量内容含 `{{` 或 `}}` 时，用 `v-text` 或字符串拼接（`'{' + '{Var' + '}' + '}'`）避免编译器解析错误（典型案例见 PromptEditor 踩坑）。
- CSS：优先 scoped SFC 样式 + CSS 变量（`var(--primary-text)` 等），避免硬编码颜色。

## Plugin Native Panel 开发（`admin/panel.js`）

- IIFE 包装；通过 `window.__VCPPanel` 拿 Vue + showToast + register。
- 动态 `<style>` 每次覆盖（用固定 styleId，先 remove 再 append）。
- API 调用走 `/admin_api/plugins/<PluginName>/api/*`（走解耦路径，不依赖主服务内部路由）。

## Git Commits
- Conventional Commits，祈使语气，中文 + emoji（本仓库风格）。
- Atomic commits：一个 commit 只做一件逻辑事。

## Security
- 永远不日志 secrets（token / key / cookie / JWT）。
- 用户输入在信任边界做校验。
- `credentials: 'include'` 只用于同源 admin API。
