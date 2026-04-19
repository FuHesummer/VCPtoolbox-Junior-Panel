// VCP 全局配置元数据 Schema
// 定义 config.env 所有字段的类型、校验规则、UI 布局
// 与 envParser.ts 配合使用：envParser 负责解析/构建 .env 文本，本文件负责 UI 渲染元数据

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'password'
  | 'integer'
  | 'boolean'
  | 'textarea'
  | 'slider'
  | 'select'
  | 'tag-input'
  | 'model-select'
  | 'tvs-file-select'
  | 'folder-select'
  | 'prompt-editor'
  | 'dynamic-pairs'
  | 'url'

export interface ConfigField {
  key: string
  label: string
  description?: string
  type: FieldType
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: Array<{ value: string; label: string }>
  required?: boolean
  width?: 'full' | 'half'
  placeholder?: string
  defaultValue?: string
  sensitive?: boolean
}

export interface ConfigSection {
  id: string
  title: string
  icon?: string
  description?: string
  collapsible?: boolean
  defaultOpen?: boolean
  fields: ConfigField[]
}

export interface ConfigTab {
  key: string
  label: string
  icon: string
  sections: ConfigSection[]
}

// ---------------------------------------------------------------------------
// Tab 1: 连接与鉴权
// ---------------------------------------------------------------------------

const connectionTab: ConfigTab = {
  key: 'connection',
  label: '连接与鉴权',
  icon: 'vpn_key',
  sections: [
    {
      id: 'api-connection',
      title: 'API 连接',
      fields: [
        {
          key: 'API_URL',
          label: 'API 地址',
          description: 'AI 服务的 API 地址，如 https://api.openai.com 或自建 NewAPI 中转地址',
          type: 'url',
          placeholder: 'http://127.0.0.1:3000',
          width: 'full',
        },
        {
          key: 'API_Key',
          label: 'API 密钥',
          description: 'AI 服务商的 API 密钥（如 OpenAI 的 sk-xxx 或 NewAPI 的 token）',
          type: 'password',
          required: true,
          sensitive: true,
          width: 'full',
          placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
        },
      ],
    },
    {
      id: 'server-port',
      title: '服务端口',
      fields: [
        {
          key: 'PORT',
          label: '监听端口',
          description: 'VCP 服务运行的端口',
          type: 'integer',
          defaultValue: '6005',
          width: 'half',
        },
        {
          key: 'CALLBACK_BASE_URL',
          label: '内回调地址',
          description: '服务器内回调地址，插件异步任务完成后通知主程序用；本地保持 localhost:6005，部署时换成公网 IP/域名',
          type: 'url',
          defaultValue: 'http://localhost:6005/plugin-callback',
          width: 'full',
        },
      ],
    },
    {
      id: 'access-keys',
      title: '访问密码',
      fields: [
        {
          key: 'Key',
          label: '聊天 API 密码',
          description: '访问 VCP 聊天 API（/v1/chat/completions）的密码，保护服务不被滥用',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
        {
          key: 'Image_Key',
          label: '图片服务密码',
          description: '访问 VCP 图片服务的密码',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
        {
          key: 'File_Key',
          label: '文档服务密码',
          description: '访问 VCP 插件生成文档服务的密码',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
        {
          key: 'VCP_Key',
          label: 'WebSocket 鉴权 Key',
          description: 'VCP WebSocket 鉴权 Key，用于管理面板与分布式服务器之间的实时通信',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
        {
          key: 'AdminUsername',
          label: '管理面板用户名',
          description: '登录 VCP 管理后台的用户名',
          type: 'text',
          defaultValue: 'admin',
          width: 'half',
        },
        {
          key: 'AdminPassword',
          label: '管理面板密码',
          description: '登录 VCP 管理后台的密码，请务必改为强密码',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
      ],
    },
    {
      id: 'newapi-monitor',
      title: 'NewAPI 监控',
      collapsible: true,
      defaultOpen: false,
      description: '管理面板 NewAPI 请求/Token 用量接口配置',
      fields: [
        {
          key: 'NEWAPI_MONITOR_BASE_URL',
          label: 'NewAPI 后台地址',
          description: 'NewAPI 后台地址',
          type: 'url',
          defaultValue: 'http://127.0.0.1:3000',
          width: 'full',
        },
        {
          key: 'NEWAPI_MONITOR_ACCESS_TOKEN',
          label: '系统访问令牌',
          description: 'NewAPI 系统访问令牌，在 NewAPI 个人设置 > 安全设置 > 系统访问令牌中生成',
          type: 'password',
          sensitive: true,
          width: 'full',
        },
        {
          key: 'NEWAPI_MONITOR_TIMEOUT_MS',
          label: '监控请求超时',
          description: '监控请求超时时间（毫秒）',
          type: 'integer',
          defaultValue: '15000',
          unit: 'ms',
          width: 'half',
        },
        {
          key: 'NEWAPI_MONITOR_API_USER_ID',
          label: '管理员用户 ID',
          description: 'NewAPI 管理员用户 ID，与生成令牌的用户对应',
          type: 'text',
          width: 'half',
        },
      ],
    },
    {
      id: 'github-access',
      title: 'GitHub 访问',
      collapsible: true,
      defaultOpen: false,
      description: '插件商店与面板更新所需的 GitHub 访问凭证',
      fields: [
        {
          key: 'GITHUB_TOKEN',
          label: 'GitHub Token',
          description: 'GitHub Personal Access Token（可选，无需任何 scope，仅用于提高 API 限额 60/h 至 5000/h）',
          type: 'password',
          sensitive: true,
          width: 'full',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tab 2: AI 引擎
// ---------------------------------------------------------------------------

const aiEngineTab: ConfigTab = {
  key: 'ai-engine',
  label: 'AI 引擎',
  icon: 'psychology',
  sections: [
    {
      id: 'service-behavior',
      title: '服务行为',
      fields: [
        {
          key: 'VCPToolCode',
          label: '工具调用验证码',
          description: 'VCP 工具调用是否需要用户验证码（防御性开关，防止未授权工具调用）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'MaxVCPLoopStream',
          label: '流式最大循环深度',
          description: 'VCPTool 在流式请求中的最大循环栈深度（防止工具链无限递归）',
          type: 'slider',
          min: 1,
          max: 15,
          step: 1,
          defaultValue: '5',
          width: 'half',
        },
        {
          key: 'MaxVCPLoopNonStream',
          label: '非流式最大循环深度',
          description: 'VCPTool 在非流式请求中的最大循环栈深度',
          type: 'slider',
          min: 1,
          max: 15,
          step: 1,
          defaultValue: '5',
          width: 'half',
        },
        {
          key: 'ApiRetries',
          label: 'API 重试次数',
          description: '上游 API 网络波动时的重试次数',
          type: 'integer',
          defaultValue: '3',
          width: 'half',
        },
        {
          key: 'ApiRetryDelay',
          label: 'API 重试间隔',
          description: '每次重试的间隔（毫秒）',
          type: 'integer',
          defaultValue: '200',
          unit: 'ms',
          width: 'half',
        },
      ],
    },
    {
      id: 'model-routing',
      title: '模型路由',
      fields: [
        {
          key: 'WhitelistImageModel',
          label: '图像生成白名单模型',
          description: '图像生成白名单模型，请求直接转发到后端 AI 服务，跳过 VCP 处理链',
          type: 'model-select',
          defaultValue: 'gemini-2.0-flash-exp-image-generation',
          width: 'full',
        },
      ],
    },
    {
      id: 'multimodal',
      title: '多模态',
      description: '图像/音频/视频识别模型与预算配置',
      fields: [
        {
          key: 'MultiModalModel',
          label: '多模态识别模型',
          description: '多模态数据识别模型',
          type: 'model-select',
          defaultValue: 'gemini-2.5-flash',
          width: 'full',
        },
        {
          key: 'MultiModalPrompt',
          label: '多模态系统提示词',
          description: '多模态识别引擎的系统提示词',
          type: 'textarea',
          width: 'full',
        },
        {
          key: 'MediaInsertPrompt',
          label: '多模态数据插入提示',
          description: '多模态数据插入到系统提示词的分隔提示',
          type: 'textarea',
          width: 'full',
        },
        {
          key: 'MultiModalModelOutputMaxTokens',
          label: '输出最大 Token 数',
          description: '多模态模型输出最大 token 数',
          type: 'integer',
          defaultValue: '50000',
          width: 'half',
        },
        {
          key: 'MultiModalModelContent',
          label: '上下文最大 Token 数',
          description: '多模态模型上下文最大 token 数',
          type: 'integer',
          defaultValue: '250000',
          width: 'half',
        },
        {
          key: 'MultiModalModelThinkingBudget',
          label: '思维预算 Token 数',
          description: '多模态模型思维预算 token 数',
          type: 'integer',
          defaultValue: '23000',
          width: 'half',
        },
        {
          key: 'MultiModalModelAsynchronousLimit',
          label: '异步请求上限',
          description: '多模态异步请求上限（每次最多异步处理的图片数）',
          type: 'slider',
          min: 1,
          max: 20,
          step: 1,
          defaultValue: '10',
          width: 'half',
        },
      ],
    },
    {
      id: 'role-divider',
      title: '角色分割',
      description: '通过 <<<[ROLE_DIVIDE_xxx]>>> 语法进行上下文切割',
      fields: [
        {
          key: 'EnableRoleDivider',
          label: '启用角色分割',
          description: '启用角色分割功能的总开关',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'EnableRoleDividerInLoop',
          label: '循环中启用分割',
          description: 'VCPTool 调用循环栈中是否启用角色分割',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'EnableRoleDividerAutoPurge',
          label: '自动清除禁用标签',
          description: '特定角色分割被禁用时，是否自动从上下文清除该角色标签',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerSystem',
          label: '允许 System 分割',
          description: '是否允许切割为 System 角色',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerAssistant',
          label: '允许 Assistant 分割',
          description: '是否允许切割为 Assistant 角色',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerUser',
          label: '允许 User 分割',
          description: '是否允许切割为 User 角色',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerScanSystem',
          label: '监测 System 楼层',
          description: '是否对 System 楼层进行分割监测',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'RoleDividerScanAssistant',
          label: '监测 Assistant 楼层',
          description: '是否对 Assistant 楼层进行分割监测',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerScanUser',
          label: '监测 User 楼层',
          description: '是否对 User 楼层进行分割监测',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerRemoveDisabledTags',
          label: '移除禁用角色标签',
          description: '当 RoleDividerXXX=false 时，是否自动从上下文移除该角色的标签',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'RoleDividerIgnoreList',
          label: '分割忽略列表',
          description: '分割忽略列表（JSON 数组字符串），匹配时忽略换行/反斜杠/空格',
          type: 'textarea',
          width: 'full',
          placeholder: '["content1","content2"]',
        },
      ],
    },
    {
      id: 'text-replace',
      title: '文本替换',
      description: '发送前对提示词进行文本替换（绕限制/优化指令）',
      fields: [
        {
          key: 'Detector',
          label: '系统提示词替换',
          description: '系统提示词检测词与替换文本（仅作用于 System Prompt），每组包含检测词和替换结果',
          type: 'dynamic-pairs',
          width: 'full',
        },
        {
          key: 'SuperDetector',
          label: '全局上下文替换',
          description: '全局上下文检测词与替换文本（含历史记录，消除重复字符等），每组包含检测词和替换结果',
          type: 'dynamic-pairs',
          width: 'full',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tab 3: 知识库
// ---------------------------------------------------------------------------

const knowledgeTab: ConfigTab = {
  key: 'knowledge',
  label: '知识库',
  icon: 'school',
  sections: [
    {
      id: 'embedding-model',
      title: '嵌入模型',
      fields: [
        {
          key: 'WhitelistEmbeddingModel',
          label: '嵌入模型',
          description: '用于知识库向量化的嵌入模型名称，必须是你的 API 服务支持的模型',
          type: 'model-select',
          defaultValue: 'gemini-embedding-exp-03-07',
          width: 'full',
        },
        {
          key: 'VECTORDB_DIMENSION',
          label: '向量维度',
          description: '向量维度，必须与嵌入模型输出维度严格匹配。常见值：gemini-embedding-exp-03-07 → 3072, text-embedding-3-small → 1536, text-embedding-3-large → 3072',
          type: 'integer',
          placeholder: '3072',
          defaultValue: '3072',
          width: 'half',
        },
        {
          key: 'WhitelistEmbeddingModelMaxToken',
          label: '每请求最大 Token',
          description: '嵌入模型每请求最大 Token 数（gemini-embedding-001 上限 20000）',
          type: 'integer',
          defaultValue: '20000',
          width: 'half',
        },
        {
          key: 'WhitelistEmbeddingModelList',
          label: '每请求文本条数',
          description: '每个 API 请求塞多少条文本（gemini-embedding-001 上限 250，建议 50）',
          type: 'integer',
          defaultValue: '50',
          width: 'half',
        },
        {
          key: 'TAG_VECTORIZE_CONCURRENCY',
          label: '嵌入并发数',
          description: '嵌入请求并发数（同时发几个 API 请求，按 RPM 配额调）',
          type: 'slider',
          min: 1,
          max: 20,
          step: 1,
          defaultValue: '5',
          width: 'half',
        },
      ],
    },
    {
      id: 'knowledge-behavior',
      title: '知识库行为',
      fields: [
        {
          key: 'KNOWLEDGEBASE_FULL_SCAN_ON_STARTUP',
          label: '启动全量扫描',
          description: '启动时是否对公共知识库全量扫描（false 加快启动但可能错过离线期变更）',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'KNOWLEDGEBASE_PERSIST_DEFAULT',
          label: '默认持久化索引',
          description: '是否默认持久化日记/知识库的向量索引到磁盘（false 推荐 -- 仅内存重建，消除大文件写入延迟）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'KNOWLEDGEBASE_PERSIST_TAG_INDEX',
          label: '持久化 Tag 索引',
          description: '是否持久化全局 Tag 索引到磁盘（false 推荐 -- 启动时从 SQL 重建）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'RAGMemoRefresh',
          label: 'RAGMemo 刷新',
          description: 'VCPTool 触发 RAGMemo 刷新机制开关（流内记忆刷新器）',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'KNOWLEDGEBASE_PERSIST_FOLDERS',
          label: '强制持久化文件夹',
          description: '强制持久化的文件夹白名单（逗号分隔，适用于万级向量以上且不常变动的冷数据）',
          type: 'tag-input',
          width: 'full',
        },
        {
          key: 'KNOWLEDGEBASE_INDEX_IDLE_TTL_MS',
          label: '索引空闲卸载超时',
          description: '知识库索引空闲自动卸载超时（毫秒，默认 2 小时）',
          type: 'integer',
          defaultValue: '7200000',
          unit: 'ms',
          width: 'half',
        },
        {
          key: 'KNOWLEDGEBASE_INDEX_IDLE_SWEEP_MS',
          label: '索引空闲扫描间隔',
          description: '知识库索引空闲扫描间隔（毫秒，默认 10 分钟）',
          type: 'integer',
          defaultValue: '600000',
          unit: 'ms',
          width: 'half',
        },
      ],
    },
    {
      id: 'filter-rules',
      title: '过滤规则',
      fields: [
        {
          key: 'IGNORE_FOLDERS',
          label: '忽略文件夹',
          description: '要忽略的文件夹名称（日记本名称），逗号分隔；VCPForum 插件启用时会自动追加',
          type: 'tag-input',
          width: 'full',
        },
        {
          key: 'IGNORE_PREFIXES',
          label: '忽略文件名前缀',
          description: '要忽略的文件名前缀，逗号分隔',
          type: 'tag-input',
          width: 'full',
        },
        {
          key: 'IGNORE_SUFFIXES',
          label: '忽略文件名后缀',
          description: '要忽略的文件名后缀，逗号分隔',
          type: 'tag-input',
          width: 'full',
        },
        {
          key: 'TAG_BLACKLIST',
          label: 'Tag 黑名单',
          description: '提取 Tag 时要忽略的 Tag 列表，逗号分隔',
          type: 'tag-input',
          width: 'full',
        },
        {
          key: 'TAG_BLACKLIST_SUPER',
          label: 'Tag 超级黑名单',
          description: '提取 Tag 后从 Tag 中移除的关键词，逗号分隔',
          type: 'tag-input',
          width: 'full',
        },
        {
          key: 'TAG_EXPAND_MAX_COUNT',
          label: 'Tag 最大扩展数',
          description: 'Tag 增强搜索时最多扩展的相关 Tag 数量',
          type: 'slider',
          min: 1,
          max: 100,
          step: 1,
          defaultValue: '30',
          width: 'half',
        },
      ],
    },
    {
      id: 'lang-confidence',
      title: '语言置信度',
      collapsible: true,
      defaultOpen: true,
      description: '语言置信度补偿，压制非技术语境下的英文技术噪音',
      fields: [
        {
          key: 'LANG_CONFIDENCE_GATING_ENABLED',
          label: '启用语言置信度补偿',
          description: '是否启用语言置信度补偿（压制非技术语境下的英文技术噪音）',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'LANG_PENALTY_UNKNOWN',
          label: '未知世界观压制权重',
          description: 'EPA 无法识别明确世界观时对英文技术词汇的压制权重（0.05 强烈压制）',
          type: 'slider',
          min: 0,
          max: 1,
          step: 0.01,
          defaultValue: '0.05',
          width: 'half',
        },
        {
          key: 'LANG_PENALTY_CROSS_DOMAIN',
          label: '跨域压制权重',
          description: 'EPA 识别出非技术世界观但召回了技术词汇时的压制权重',
          type: 'slider',
          min: 0,
          max: 1,
          step: 0.01,
          defaultValue: '0.1',
          width: 'half',
        },
      ],
    },
    {
      id: 'rerank',
      title: 'Rerank 精排',
      collapsible: true,
      defaultOpen: true,
      description: 'LightMemo 搜索 RAG 知识库后的精排服务配置；不配置则跳过 Rerank 阶段',
      fields: [
        {
          key: 'RerankUrl',
          label: 'Rerank 服务地址',
          description: 'Rerank 服务地址（如 https://api.siliconflow.cn、https://api.jina.ai）',
          type: 'url',
          width: 'full',
          placeholder: 'https://api.siliconflow.cn',
        },
        {
          key: 'RerankApi',
          label: 'Rerank API 密钥',
          description: 'Rerank 服务的 API 密钥',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
        {
          key: 'RerankModel',
          label: 'Rerank 模型',
          description: 'Rerank 模型名称（如 BAAI/bge-reranker-v2-m3、jina-reranker-v2-base-multilingual）',
          type: 'model-select',
          width: 'half',
          placeholder: 'BAAI/bge-reranker-v2-m3',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tab 4: 梦系统
// ---------------------------------------------------------------------------

const dreamTab: ConfigTab = {
  key: 'dream',
  label: '梦系统',
  icon: 'bedtime',
  sections: [
    {
      id: 'dream-schedule',
      title: '全局调度',
      description: 'AI Agent 在凌晨时段自动回顾日记、联想式做梦的调度参数',
      fields: [
        {
          key: 'DREAM_FREQUENCY_HOURS',
          label: '做梦最小间隔',
          description: '同一 Agent 两次做梦的最小间隔',
          type: 'slider',
          min: 1,
          max: 12,
          step: 1,
          unit: 'h',
          defaultValue: '3',
          width: 'half',
        },
        {
          key: 'DREAM_TIME_WINDOW_START',
          label: '时间窗口开始',
          description: '做梦时间窗口开始（24h 制，默认凌晨 1 点）',
          type: 'integer',
          defaultValue: '1',
          width: 'half',
        },
        {
          key: 'DREAM_TIME_WINDOW_END',
          label: '时间窗口结束',
          description: '做梦时间窗口结束（24h 制，默认早 8 点）',
          type: 'integer',
          defaultValue: '8',
          width: 'half',
        },
        {
          key: 'DREAM_PROBABILITY',
          label: '做梦概率',
          description: '每次到点掷骰概率（0~1）',
          type: 'slider',
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: '0.6',
          width: 'half',
        },
        {
          key: 'DREAM_TAG_BOOST',
          label: '标签共现增强因子',
          description: '标签共现增强因子（0~1）',
          type: 'slider',
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: '0.25',
          width: 'half',
        },
        {
          key: 'DREAM_CONTEXT_TTL_HOURS',
          label: '梦境上下文缓存有效期',
          description: '梦境上下文缓存有效期',
          type: 'slider',
          min: 1,
          max: 12,
          step: 1,
          unit: 'h',
          defaultValue: '4',
          width: 'half',
        },
      ],
    },
    {
      id: 'dream-agents',
      title: '做梦 Agent',
      description: 'Agent 独立配置（每个名字一组 5 行）由视图层单独渲染 Agent 卡片',
      fields: [
        {
          key: 'DREAM_AGENT_LIST',
          label: '做梦 Agent 列表',
          description: '做梦 Agent 列表（逗号分隔的中文名；留空则梦系统休眠）',
          type: 'tag-input',
          defaultValue: 'Nova',
          width: 'full',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tab 5: 核心插件
// ---------------------------------------------------------------------------

const pluginsTab: ConfigTab = {
  key: 'plugins',
  label: '核心插件',
  icon: 'extension',
  sections: [
    {
      id: 'file-operator',
      title: '文件操作器 FileOperator',
      description: '授权 AI 对受限目录做读/写/移动/复制/删除/搜索/下载',
      fields: [
        {
          key: 'ALLOWED_DIRECTORIES',
          label: '允许操作目录白名单',
          description: '允许 AI 操作的目录白名单（绝对路径，逗号分隔）；留空 = 允许所有目录（不推荐生产环境使用）',
          type: 'textarea',
          width: 'full',
          placeholder: 'D:\\VCP\\Workspace,D:\\Documents\\AI_Canvas',
        },
        {
          key: 'DEFAULT_DOWNLOAD_DIR',
          label: '默认下载目录',
          description: 'DownloadFile 命令默认保存目录（绝对路径），留空则自动使用 <项目根>/AppData/file',
          type: 'text',
          width: 'full',
        },
        {
          key: 'MAX_FILE_SIZE',
          label: '最大文件大小',
          description: '单次读/写/下载的最大文件大小（字节），参考: 10MB=10485760 / 20MB=20971520 / 50MB=52428800',
          type: 'integer',
          defaultValue: '20971520',
          unit: 'bytes',
          width: 'half',
        },
        {
          key: 'MAX_DIRECTORY_ITEMS',
          label: '目录最大返回项数',
          description: 'ListDirectory 返回的最大项数（防止列大目录把 AI 上下文吃满）',
          type: 'integer',
          defaultValue: '1000',
          width: 'half',
        },
        {
          key: 'MAX_SEARCH_RESULTS',
          label: '搜索最大结果数',
          description: 'SearchFiles 递归搜索返回的最大结果数',
          type: 'integer',
          defaultValue: '100',
          width: 'half',
        },
        {
          key: 'ENABLE_RECURSIVE_OPERATIONS',
          label: '启用递归搜索',
          description: '是否启用 SearchFiles 递归遍历子目录（false 则仅搜一层）',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'ENABLE_HIDDEN_FILES',
          label: '包含隐藏文件',
          description: 'ListDirectory/SearchFiles 是否默认包含隐藏文件（以 . 开头）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'DEBUG_MODE',
          label: 'FileOperator 调试',
          description: 'FileOperator 插件专属调试日志（独立于全局 DebugMode；开启会输出权限判定等内部行为）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
      ],
    },
    {
      id: 'context-folding',
      title: '上下文折叠 ContextFoldingV2',
      description: '对正文中远距离、低相关性的 AI 输出进行摘要折叠，减少上下文长度',
      fields: [
        {
          key: 'FOLDING_SUMMARY_MODEL',
          label: '摘要生成模型',
          description: '摘要生成模型（建议选便宜、快速的模型）',
          type: 'model-select',
          defaultValue: 'gemini-3.1-flash-lite-preview',
          width: 'full',
        },
        {
          key: 'FOLDING_MIN_DEPTH',
          label: '最低折叠深度',
          description: '最低折叠触发深度（系统强制最低为 2，最近 2 个 AI 回复始终不折叠）',
          type: 'slider',
          min: 2,
          max: 10,
          step: 1,
          defaultValue: '3',
          width: 'half',
        },
        {
          key: 'FOLDING_MAX_RETRIES',
          label: '摘要最大重试次数',
          description: '摘要生成最大重试次数',
          type: 'integer',
          defaultValue: '3',
          width: 'half',
        },
        {
          key: 'FOLDING_SUMMARY_MAX_CONCURRENT',
          label: '摘要最大并发数',
          description: '摘要生成最大并发数（队列限流；默认一次最多 5 个并发请求，减缓上游 429）',
          type: 'slider',
          min: 1,
          max: 10,
          step: 1,
          defaultValue: '5',
          width: 'half',
        },
        {
          key: 'FOLDING_SUMMARY_SYSTEM_PROMPT',
          label: '摘要系统提示词',
          description: '摘要系统提示词（使用 \\n 代表换行）',
          type: 'textarea',
          width: 'full',
        },
        {
          key: 'FOLDING_SUMMARY_USER_PROMPT',
          label: '摘要用户提示词',
          description: '摘要用户提示词模板（{CONTENT} 会被替换为实际内容）',
          type: 'textarea',
          width: 'full',
        },
      ],
    },
    {
      id: 'backup-migration',
      title: '备份与迁移',
      description: '对接上游 VCPBackUp 项目的备份/恢复/迁移体系',
      fields: [
        {
          key: 'JianguoyunDEV',
          label: '启用坚果云',
          description: '是否启用坚果云自动上传/拉取',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'JianguoyunDEVUrl',
          label: '坚果云 WebDAV 地址',
          description: 'WebDAV 服务器地址，坚果云固定为 https://dav.jianguoyun.com/dav/',
          type: 'url',
          defaultValue: 'https://dav.jianguoyun.com/dav/',
          width: 'full',
        },
        {
          key: 'JianguoyunDEVUser',
          label: '坚果云账号',
          description: '坚果云账号（邮箱）',
          type: 'text',
          width: 'half',
          placeholder: 'your_email@example.com',
        },
        {
          key: 'JianguoyunDEVPW',
          label: '坚果云应用密码',
          description: '坚果云应用密码（注意：不是登录密码，需在坚果云后台生成）',
          type: 'password',
          sensitive: true,
          width: 'half',
        },
        {
          key: 'JianguoyunPath',
          label: '坚果云备份目录',
          description: '坚果云上的备份目录（路径不存在会自动创建）',
          type: 'text',
          defaultValue: '/VCP备份',
          width: 'half',
        },
        {
          key: 'MIGRATION_UPLOAD_MAX_MB',
          label: '上传最大尺寸',
          description: 'AdminPanel 上传 VCPBackUp zip 的最大尺寸（MB）',
          type: 'integer',
          defaultValue: '5120',
          unit: 'MB',
          width: 'half',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tab 6: 个性化
// ---------------------------------------------------------------------------

const personalizationTab: ConfigTab = {
  key: 'personalization',
  label: '个性化',
  icon: 'person',
  sections: [
    {
      id: 'system-prompt',
      title: '系统提示词模板',
      fields: [
        {
          key: 'TarSysPrompt',
          label: '核心系统提示词',
          description: '最核心的系统提示词，{{Agent:Nova}} 注入默认 Agent 人设（可换为 agent_map.json 中其他别名）',
          type: 'prompt-editor',
          width: 'full',
        },
        {
          key: 'TarEmojiPrompt',
          label: '表情包提示词',
          description: '指导 AI 如何使用表情包的提示词',
          type: 'textarea',
          width: 'full',
        },
        {
          key: 'TarEmojiList',
          label: '表情包列表文件',
          description: '表情包列表文件名（从 image/ 下的同名子文件夹读取）',
          type: 'tvs-file-select',
          width: 'full',
        },
      ],
    },
    {
      id: 'tool-config',
      title: '工具配置',
      fields: [
        {
          key: 'VarToolList',
          label: '可用工具清单',
          description: 'AI 可用工具清单文件名（相对于 TVStxt/）',
          type: 'tvs-file-select',
          defaultValue: 'supertool.txt',
          width: 'full',
        },
        {
          key: 'VarVCPGuide',
          label: 'VCP 工具调用指南',
          description: '指导 AI 如何正确格式化 VCP 工具调用请求（<<<[TOOL_REQUEST]>>> 协议）',
          type: 'textarea',
          width: 'full',
        },
      ],
    },
    {
      id: 'user-info',
      title: '用户信息',
      fields: [
        {
          key: 'VarUser',
          label: '用户描述',
          description: '用户基本描述（让 AI 了解你是谁）',
          type: 'text',
          width: 'half',
        },
        {
          key: 'VarUserInfo',
          label: '用户详细信息',
          description: '用户更详细的信息（一句话简介）',
          type: 'text',
          width: 'half',
        },
        {
          key: 'VarCity',
          label: '所在城市',
          description: '你所在城市（用于天气查询等）',
          type: 'text',
          width: 'half',
        },
        {
          key: 'VarHome',
          label: '住所描述',
          description: '家庭/住所的描述',
          type: 'textarea',
          width: 'half',
        },
        {
          key: 'VarSystemInfo',
          label: '系统信息',
          description: '你的系统信息（注入提示词让 AI 了解运行环境）',
          type: 'text',
          width: 'half',
        },
        {
          key: 'VarTeam',
          label: '团队/Agent 清单',
          description: '团队/Agent 清单说明',
          type: 'textarea',
          width: 'half',
        },
      ],
    },
    {
      id: 'network-urls',
      title: '网络地址',
      fields: [
        {
          key: 'VarHttpUrl',
          label: 'HTTP 访问地址',
          description: 'VCP 服务的 HTTP 访问地址（反向代理时填域名）',
          type: 'url',
          defaultValue: 'http://localhost',
          width: 'half',
        },
        {
          key: 'VarHttpsUrl',
          label: 'HTTPS 访问地址',
          description: 'VCP 服务的 HTTPS 访问地址',
          type: 'url',
          width: 'half',
          placeholder: 'https://your-domain.com/',
        },
        {
          key: 'VarDdnsUrl',
          label: 'DDNS 地址',
          description: '使用 DDNS 时的服务地址',
          type: 'url',
          width: 'half',
          placeholder: 'http://your-ddns-provider.com',
        },
      ],
    },
    {
      id: 'rendering-settings',
      title: '渲染设置',
      collapsible: true,
      defaultOpen: true,
      description: 'Vchat 客户端渲染与气泡相关配置',
      fields: [
        {
          key: 'VarVchatPath',
          label: 'Vchat 根目录',
          description: 'Vchat 客户端或相关程序的根目录',
          type: 'text',
          width: 'full',
          placeholder: 'D:\\VCPChat',
        },
        {
          key: 'VarRendering',
          label: '渲染能力说明',
          description: 'Vchat 客户端渲染支持说明（HTML/Div/CSS/JS/MD/Py/Latex/Mermaid 等渲染规则）',
          type: 'textarea',
          width: 'full',
        },
        {
          key: 'VarDivRender',
          label: 'Div 渲染规范文件',
          description: 'Vchat 客户端气泡渲染规范的提示词文件名',
          type: 'tvs-file-select',
          defaultValue: 'DIVRendering.txt',
          width: 'half',
        },
        {
          key: 'VarDesktop',
          label: '桌面提示词文件',
          description: '桌面提示词管理文件名',
          type: 'tvs-file-select',
          defaultValue: 'DesktopCore.txt',
          width: 'half',
        },
        {
          key: 'VarAdaptiveBubbleTip',
          label: '自适应气泡指南',
          description: '主题自适应气泡实现指南（CSS 变量 + 磨砂玻璃风格的聊天气泡写法）',
          type: 'textarea',
          width: 'full',
        },
        {
          key: 'VarTimeNow',
          label: '时间模板',
          description: '时间相关占位符合成模板（可用 {{Date}} {{Today}} {{Festival}} {{Time}}）',
          type: 'textarea',
          width: 'full',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tab 7: 系统
// ---------------------------------------------------------------------------

const systemTab: ConfigTab = {
  key: 'system',
  label: '系统',
  icon: 'settings',
  sections: [
    {
      id: 'debug-logging',
      title: '调试与日志',
      fields: [
        {
          key: 'DebugMode',
          label: '调试模式',
          description: '是否输出详细调试信息到控制台（开发排错用）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'ShowVCP',
          label: '显示 VCP 信息',
          description: '非流式输出时，是否在返回结果中包含 VCP 调用信息',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'CHAT_LOG_ENABLED',
          label: '聊天日志',
          description: '是否在 DebugLog/chat/ 下记录每次 chat 的请求体与响应（可能包含敏感内容 + 占用磁盘）',
          type: 'boolean',
          defaultValue: 'false',
          width: 'half',
        },
        {
          key: 'DEFAULT_TIMEZONE',
          label: '默认时区',
          description: '服务器默认时区，用于时间相关操作和日志',
          type: 'select',
          options: [
            { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
            { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
            { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (UTC+8)' },
            { value: 'Asia/Singapore', label: 'Asia/Singapore (UTC+8)' },
            { value: 'Asia/Seoul', label: 'Asia/Seoul (UTC+9)' },
            { value: 'America/New_York', label: 'America/New_York (UTC-5)' },
            { value: 'America/Chicago', label: 'America/Chicago (UTC-6)' },
            { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8)' },
            { value: 'Europe/London', label: 'Europe/London (UTC+0)' },
            { value: 'Europe/Berlin', label: 'Europe/Berlin (UTC+1)' },
            { value: 'Europe/Paris', label: 'Europe/Paris (UTC+1)' },
            { value: 'Australia/Sydney', label: 'Australia/Sydney (UTC+10)' },
            { value: 'Pacific/Auckland', label: 'Pacific/Auckland (UTC+12)' },
            { value: 'UTC', label: 'UTC' },
          ],
          defaultValue: 'Asia/Shanghai',
          width: 'half',
        },
      ],
    },
    {
      id: 'panel-update',
      title: '面板更新',
      fields: [
        {
          key: 'PANEL_AUTO_UPDATE',
          label: '自动更新检查',
          description: '是否启用面板后台自动更新检查',
          type: 'boolean',
          defaultValue: 'true',
          width: 'half',
        },
        {
          key: 'PANEL_RELEASE_URL',
          label: 'Release API 地址',
          description: '管理面板 GitHub Release API 地址（设为 disabled 禁用自动下载）',
          type: 'url',
          defaultValue: 'https://api.github.com/repos/FuHesummer/VCPtoolbox-Junior-Panel/releases/latest',
          width: 'full',
        },
        {
          key: 'ADMIN_PANEL_SOURCE',
          label: '面板源路径',
          description: '管理面板源（支持绝对/相对路径），留空时 adminServer 按优先级自动发现',
          type: 'text',
          width: 'full',
          placeholder: '../VCPtoolbox-Junior-Panel/dist',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export const CONFIG_TABS: ConfigTab[] = [
  connectionTab,
  aiEngineTab,
  knowledgeTab,
  dreamTab,
  pluginsTab,
  personalizationTab,
  systemTab,
]

/**
 * 在所有 Tab/Section 中查找指定 key 的字段定义。
 * 对于 dynamic-pairs 类型，key 匹配的是逻辑分组名（如 "Detector"），
 * 实际 env 中的字段名带数字后缀（Detector1, Detector_Output1 等）。
 */
export function findField(key: string): ConfigField | undefined {
  for (const tab of CONFIG_TABS) {
    for (const section of tab.sections) {
      const found = section.fields.find((f) => f.key === key)
      if (found) return found
    }
  }
  return undefined
}

/**
 * 返回 Schema 管理的所有 env key 列表。
 * 注意：dynamic-pairs 类型返回的是逻辑分组名（Detector / SuperDetector），
 * 实际 env 中的带编号字段（Detector1, Detector_Output1 等）由视图层动态解析。
 */
export function getAllKeys(): string[] {
  const keys: string[] = []
  for (const tab of CONFIG_TABS) {
    for (const section of tab.sections) {
      for (const field of section.fields) {
        keys.push(field.key)
      }
    }
  }
  return keys
}
