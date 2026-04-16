// RAGDiaryPlugin 占位符解析 / 序列化
// 严格匹配 RAGDiaryPlugin.js 的约定（line 2290+ 和 line 1340+）

export type RagPlaceholderType = 'rag' | 'diary' | 'meta'

export interface TagMemoModifier {
  enabled: boolean
  weight: number | null   // null = 动态权重；数值 = 固定权重
  geodesic: boolean       // V8: + 号 = 测地线重排
}

export interface RagPlaceholder {
  type: 'rag'
  name: string            // 日记本名称
  time: boolean           // ::Time
  group: boolean          // ::Group
  rerank: boolean         // ::Rerank
  tagMemo: TagMemoModifier
}

export interface DiaryPlaceholder {
  type: 'diary'
  name: string            // 全量日记本名称（<<X>>）
}

export interface MetaPlaceholder {
  type: 'meta'
  chain: string           // 思考链名（:chain_name）
  group: boolean          // ::Group
  auto: boolean           // ::Auto
  autoThreshold: number | null  // ::Auto:0.65
}

export type AnyPlaceholder = RagPlaceholder | DiaryPlaceholder | MetaPlaceholder

const META_NAME = 'VCP元思考'

// ============ 解析 ============

/** 解析 [[XXX...]] 里的 raw 内容（去掉两侧方括号）。返回 RAG 或 Meta 占位符 */
export function parseRagRaw(raw: string): RagPlaceholder | MetaPlaceholder {
  // 元思考：以 VCP元思考 开头
  if (raw.startsWith(META_NAME)) {
    return parseMeta(raw)
  }
  return parseRag(raw)
}

/** 解析 <<XXX>> 里的 raw 内容 */
export function parseDiaryRaw(raw: string): DiaryPlaceholder {
  return { type: 'diary', name: raw.trim() }
}

function parseRag(raw: string): RagPlaceholder {
  const [nameRaw, ...modPartsRaw] = raw.split('::')
  const name = nameRaw.replace(/:+$/, '').trim()
  // 清理每个修饰符前后残留的 `:` 笔误（比如 `[[公共日记本:Time::Group]]`）
  const modParts = modPartsRaw.flatMap(p => p.split('::')).map(m => m.replace(/^:+/, '').trim()).filter(Boolean)

  const out: RagPlaceholder = {
    type: 'rag',
    name,
    time: false,
    group: false,
    rerank: false,
    tagMemo: { enabled: false, weight: null, geodesic: false },
  }

  for (const part of modParts) {
    if (part === 'Time') out.time = true
    else if (part === 'Group') out.group = true
    else if (part === 'Rerank') out.rerank = true
    else {
      // TagMemo 家族匹配（V8）
      // ::TagMemo       → enabled, weight=null, geodesic=false
      // ::TagMemo0.3    → enabled, weight=0.3, geodesic=false
      // ::TagMemo+      → enabled, weight=null, geodesic=true
      // ::TagMemo+0.3   → enabled, weight=0.3, geodesic=true
      const m = part.match(/^TagMemo(\+)?(\d+\.?\d*)?$/)
      if (m) {
        out.tagMemo.enabled = true
        out.tagMemo.geodesic = !!m[1]
        out.tagMemo.weight = m[2] ? parseFloat(m[2]) : null
      }
    }
  }
  return out
}

function parseMeta(raw: string): MetaPlaceholder {
  // 格式: VCP元思考:chain::Mod1::Mod2  或  VCP元思考::Mod  (无链)
  // 注意第一个冒号后面是链名（可选）
  const withoutHead = raw.slice(META_NAME.length)  // 从 VCP元思考 之后开始

  let chain = 'default'
  let remainder = withoutHead

  // 单冒号开头 → 有链名
  if (withoutHead.startsWith(':') && !withoutHead.startsWith('::')) {
    const idx = withoutHead.indexOf('::', 1)
    if (idx > 0) {
      chain = withoutHead.slice(1, idx).trim() || 'default'
      remainder = withoutHead.slice(idx)
    } else {
      chain = withoutHead.slice(1).trim() || 'default'
      remainder = ''
    }
  }

  const modParts = remainder.split('::').map(p => p.replace(/^:+/, '').trim()).filter(Boolean)

  const out: MetaPlaceholder = {
    type: 'meta',
    chain,
    group: false,
    auto: false,
    autoThreshold: null,
  }

  for (const part of modParts) {
    if (part === 'Group') out.group = true
    else if (part.toLowerCase().startsWith('auto')) {
      out.auto = true
      // Auto:0.65 或 Auto
      const thresholdMatch = part.match(/:(\d+\.?\d*)$/)
      if (thresholdMatch) {
        const t = parseFloat(thresholdMatch[1])
        if (!isNaN(t)) out.autoThreshold = t
      }
    }
  }

  return out
}

// ============ 序列化 ============

export function serializeRag(p: RagPlaceholder): string {
  const parts = [p.name]
  if (p.time) parts.push('Time')
  if (p.group) parts.push('Group')
  if (p.rerank) parts.push('Rerank')
  if (p.tagMemo.enabled) {
    const prefix = p.tagMemo.geodesic ? 'TagMemo+' : 'TagMemo'
    const suffix = p.tagMemo.weight !== null ? String(p.tagMemo.weight) : ''
    parts.push(prefix + suffix)
  }
  return parts.join('::')
}

export function serializeDiary(p: DiaryPlaceholder): string {
  return p.name
}

export function serializeMeta(p: MetaPlaceholder): string {
  let head = META_NAME
  if (p.chain && p.chain !== 'default') head += ':' + p.chain
  const mods: string[] = []
  if (p.auto) mods.push(p.autoThreshold !== null ? `Auto:${p.autoThreshold}` : 'Auto')
  if (p.group) mods.push('Group')
  return head + (mods.length ? '::' + mods.join('::') : '')
}

/** 通用序列化（加两侧标记） */
export function serializeToChip(p: AnyPlaceholder): string {
  if (p.type === 'diary') return `<<${serializeDiary(p)}>>`
  if (p.type === 'meta') return `[[${serializeMeta(p)}]]`
  return `[[${serializeRag(p)}]]`
}

/** 通用序列化（不带两侧标记，适合 chip 的 data-var） */
export function serializeToRaw(p: AnyPlaceholder): string {
  if (p.type === 'diary') return serializeDiary(p)
  if (p.type === 'meta') return serializeMeta(p)
  return serializeRag(p)
}
