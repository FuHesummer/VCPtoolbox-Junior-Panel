// Placeholder Registry API
// 占位符注册表 —— 识别「未装插件提供的占位符」，配合 install 热加载协议实现一键修复
// 后端挂载：/admin_api/placeholder-registry
import { apiFetch } from './client'

export interface PlaceholderEntry {
  name: string
  kind: 'static-placeholder' | 'tool-description' | 'tvs-variable' | 'emoji-list' | 'agent-timeline' | string
  description?: string
  source?: string
  commandCount?: number
  commands?: string[]
  tvsFile?: string
}

export interface PluginRegistryEntry {
  displayName: string
  description: string
  pluginType: string
  category: string
  icon: string
  directoryName: string
  version: string | null
  placeholders: PlaceholderEntry[]
}

export interface PatternRule {
  pattern: string
  flags?: string
  plugin: string
  displayName: string
  kind: string
  description: string
  icon?: string
  category?: string
  isCorePlugin?: boolean
}

export interface PlaceholderRegistry {
  version: string
  generatedAt: string
  stats: {
    pluginCount: number
    placeholderCount: number
    patternRuleCount: number
    totalScannedDirs: number
  }
  plugins: Record<string, PluginRegistryEntry>
  patternRules: PatternRule[]
}

export interface RegistryResponse {
  success: boolean
  source: 'memory' | 'sibling-repo' | 'file-fresh' | 'file-stale' | 'remote'
  warning?: string | null
  data: PlaceholderRegistry
}

export function getPlaceholderRegistry(opts: { suppressErrorToast?: boolean } = {}) {
  // 默认静默失败：registry 是增强能力，不应该用 toast 骚扰用户
  return apiFetch<RegistryResponse>('/admin_api/placeholder-registry', {
    showLoader: false,
    suppressErrorToast: opts.suppressErrorToast ?? true,
  })
}

export function refreshPlaceholderRegistry() {
  return apiFetch<{ success: boolean; source: string; pluginCount: number; patternRuleCount: number; version: string | null; generatedAt: string | null }>(
    '/admin_api/placeholder-registry/refresh',
    { method: 'POST' },
  )
}

/**
 * 在 registry 中查找某个占位符对应的插件
 * @returns 命中的插件名和描述；未命中返回 null
 */
export function lookupPlaceholder(
  registry: PlaceholderRegistry | null,
  placeholderName: string,
): { pluginKey: string; plugin: PluginRegistryEntry; entry: PlaceholderEntry } | null {
  if (!registry) return null
  // 1. 精确匹配 plugins[*].placeholders[*].name
  for (const [key, plugin] of Object.entries(registry.plugins)) {
    const entry = plugin.placeholders.find(p => p.name === placeholderName)
    if (entry) return { pluginKey: key, plugin, entry }
  }
  // 2. patternRules 正则匹配
  for (const rule of registry.patternRules) {
    try {
      const re = new RegExp(rule.pattern, rule.flags || '')
      if (re.test(placeholderName)) {
        // 把 pattern 规则包成 PluginRegistryEntry 风格返回
        const pseudoPlugin: PluginRegistryEntry = {
          displayName: rule.displayName,
          description: rule.description,
          pluginType: 'unknown',
          category: rule.category || 'tool',
          icon: rule.icon || 'extension',
          directoryName: rule.plugin,
          version: null,
          placeholders: [],
        }
        const pseudoEntry: PlaceholderEntry = {
          name: placeholderName,
          kind: rule.kind,
          description: rule.description,
          source: `pattern:${rule.pattern}`,
        }
        return { pluginKey: rule.plugin, plugin: pseudoPlugin, entry: pseudoEntry }
      }
    } catch { /* 忽略非法正则 */ }
  }
  return null
}
