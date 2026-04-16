# Development Workflow Rules — VCPtoolbox-Junior-Panel

> 此文件定义 LLM 开发工作流的强制规则。
> 所有 LLM 工具在执行任务时必须遵守，不可跳过任何步骤。

## Full Flow (MUST follow, no exceptions)

### feat (新功能)
1. 理解需求，分析影响范围（改动哪个 view / component / api 层）
2. 读取现有代码，理解模式（优先照搬既有组件风格）
3. 编写实现代码（Composition API + `<script setup>`）
4. 编写对应测试（若有 test/ 目录）
5. 运行 `npm run type-check` 和 `npm run build` 确认编译通过
6. 更新文档（若 API 层 / 协议变更）

### fix (缺陷修复)
1. 复现问题，确认症状（浏览器 devtools console）
2. 定位根因（vue/tsc 报错 / 组件生命周期 / HMR 缓存问题）
3. 修复代码
4. 验证 HMR 推送或强刷浏览器后生效

### refactor (重构)
1. 确保现有构建通过
2. 小步重构，每步可验证
3. 重构后 type-check + build 必须全部通过
4. 不改变外部行为（API 契约 / 路由路径不变）

## Context Logging (决策记录)

当做出以下决策时，MUST 追加到 `.context/current/branches/<当前分支>/session.log`：

1. **组件拆分**：新建子组件 vs 合并到父组件
2. **状态管理**：ref/computed 选型、store 是否需要
3. **API 契约**：新增 API 端点 / 响应结构调整
4. **踩坑记录**：Vue 编译器怪坑、HMR 异常、浏览器兼容性

追加格式：
```
## <ISO-8601 时间>
**Decision**: <你选择了什么>
**Alternatives**: <被排除的方案>
**Reason**: <为什么>
**Risk**: <潜在风险>
```
