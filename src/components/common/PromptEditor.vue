<script setup lang="ts">
// 提示词编辑器（小白友好 + 高级 + 交互式 chip）
// - 默认「小白模式」：contenteditable 编辑器，{{XXX}} 自动渲染为可拖拽的彩色 chip
//   * hover chip 显示该变量作用 + 实际内容预览
//   * 点击 chip 弹出替换面板（可换成另一个变量或删除）
//   * chip 可拖拽到文本任意位置
// - 高级模式：原始 textarea
// - 顶部「插入变量」按钮 → 弹出真实占位符面板（沿用 /admin_api/placeholders）
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import BaseModal from '@/components/common/BaseModal.vue'
import RagChipEditor from '@/components/common/RagChipEditor.vue'
import { getPlaceholders, type PlaceholderItem, type PlaceholderType } from '@/api/config'
import { getToolboxMap, type ToolboxMap } from '@/api/toolbox'
import { getPlaceholderRegistry, lookupPlaceholder, type PlaceholderRegistry } from '@/api/placeholderRegistry'
import { installPlugin } from '@/api/pluginStore'
import { listPlugins } from '@/api/plugins'

const props = defineProps<{
  modelValue: string
  rows?: number
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const mode = ref<'rich' | 'raw'>('rich')
const editorEl = ref<HTMLDivElement | null>(null)
let internalUpdate = false

// ============ 占位符分类 ============
type VarKind = 'Tar' | 'Var' | 'Sar' | 'Agent' | 'Sys' | 'Timeline' | 'Rag' | 'RagSim' | 'RagHybrid' | 'Tool' | 'Toolbox' | 'Emoji' | 'Diary'
type ChipFormat = 'var' | 'rag' | 'rag_sim' | 'rag_hybrid'

// Toolbox alias 集合（运行期从后端拉，classify 用于识别 {{alias}} / {{toolbox:alias}}）
const toolboxAliases = ref<Set<string>>(new Set())
const toolboxDescMap = ref<Record<string, string>>({})

// 占位符 registry（从插件仓库拉）：识别「未装插件的占位符」
const placeholderRegistry = ref<PlaceholderRegistry | null>(null)

// 已装插件名集合（用于判断 pattern 规则命中的插件是否已装 → 决定健康度）
const installedPluginNames = ref<Set<string>>(new Set())

function classify(name: string, format: ChipFormat = 'var'): VarKind {
  // RAG 三种语法按格式分类（不看名字）
  if (format === 'rag') return 'Rag'
  if (format === 'rag_sim') return 'RagSim'
  if (format === 'rag_hybrid') return 'RagHybrid'
  // toolbox:alias 显式前缀 → Toolbox
  if (name.startsWith('toolbox:')) return 'Toolbox'
  // 无前缀 alias 命中 toolbox 集合 → Toolbox
  if (toolboxAliases.value.has(name)) return 'Toolbox'
  // VarTimeline{Agent} 是 TimelineOrganizer 插件维护的 Agent 生平时间线，归专属类
  if (name.startsWith('VarTimeline')) return 'Timeline'
  if (name.startsWith('Tar')) return 'Tar'
  if (name.startsWith('Var')) return 'Var'
  if (name.startsWith('Sar')) return 'Sar'
  if (name.startsWith('Agent') || /^(Maid|User)/.test(name)) return 'Agent'
  // VCPXxx 前缀是 VCP 工具描述占位符（插件可能未装，但名字合法）
  if (name.startsWith('VCP')) return 'Tool'
  // 表情包命名惯例：{{XXX表情包}} → EmojiListGenerator 生成，黄色 chip
  if (name.endsWith('表情包')) return 'Emoji'
  // {{xxx日记本}} → RAGDiaryPlugin 直接注入模式，等效 RAG 占位符
  if (name.endsWith('日记本')) return 'Diary'
  return 'Sys'
}

const KIND_LABEL: Record<VarKind, string> = {
  Tar: '系统级', Var: '通用', Sar: '模型条件', Agent: 'Agent', Sys: '内置',
  Timeline: '时间线',
  Rag: 'RAG 无条件', RagSim: '相似度检索', RagHybrid: '混合阈值', Tool: 'VCP 工具',
  Toolbox: 'Toolbox 工具集',
  Emoji: '表情包',
  Diary: '日记本直注',
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!))
}

// ============ 占位符元数据（hover tooltip 用） ============
const placeholders = ref<PlaceholderItem[]>([])
const placeholderMap = computed(() => {
  const map = new Map<string, PlaceholderItem>()
  for (const p of placeholders.value) {
    // p.name 是 {{XXX}} 完整形式
    const nameOnly = p.name.replace(/^\{\{|\}\}$/g, '')
    map.set(nameOnly, p)
  }
  return map
})

// 占位符三态：✅ 有效 / ⚠️ 仓库有但未装 / ❌ 未知（都不命中）
export type PlaceholderHealth = 'ok' | 'missing-plugin' | 'unknown'

function getHealth(name: string, format: ChipFormat = 'var'): PlaceholderHealth {
  // RAG 三种格式不做健康度判定（日记本/元思考的有效性走另一条 RAG 管线）
  if (format !== 'var') return 'ok'
  // {{xxx日记本}} 是 RAGDiaryPlugin 直注模式，有效性由 RAG 管线保证
  if (name.endsWith('日记本')) return 'ok'
  // 已装插件提供的占位符 → ✅
  if (placeholderMap.value.has(name)) return 'ok'
  // Toolbox 工具集 → ✅
  const toolboxName = name.startsWith('toolbox:') ? name.slice(8) : name
  if (toolboxAliases.value.has(toolboxName)) return 'ok'
  // 内置系统占位符白名单（Date/Time/Today/Festival/Port/Image_Key 等走 placeholderMap 已覆盖，
  // 这里兜底特殊前缀 — VarTimeline 由 TimelineOrganizer bootstrap 动态注入）
  if (name.startsWith('VarTimeline')) return 'ok'
  // registry 命中
  const found = lookupPlaceholder(placeholderRegistry.value, name)
  if (found) {
    // 如果对应的插件已装 → ✅（比如 EmojiListGenerator 装了，Nova表情包/Hornet表情包 都应该是 ok）
    if (installedPluginNames.value.has(found.pluginKey)) return 'ok'
    // 核心插件默认视为已装（registry 里标 isCorePlugin，如 TimelineOrganizer）
    const ruleMatch = (placeholderRegistry.value?.patternRules || []).find(r => {
      try { return new RegExp(r.pattern, r.flags || '').test(name) && r.plugin === found.pluginKey } catch { return false }
    })
    if (ruleMatch?.isCorePlugin) return 'ok'
    // 仓库有但未装 → ⚠️
    return 'missing-plugin'
  }
  // 其他前缀（Tar/Var/Sar/Agent/VCP）能被 classify 识别但没数据源 — 标未知
  return 'unknown'
}

function getVarTooltip(name: string): string {
  // {{xxx日记本}} 直注模式 — RAGDiaryPlugin 处理
  if (name.endsWith('日记本')) {
    const diaryName = name.replace(/日记本$/, '')
    return `${name}（日记本直接注入）\nRAGDiaryPlugin 会将「${diaryName}」目录的全部内容注入到此位置\n\n点击替换 / 拖拽移动 / Delete 删除`
  }
  // Toolbox 优先识别（支持 {{alias}} 和 {{toolbox:alias}} 两种格式）
  const toolboxName = name.startsWith('toolbox:') ? name.slice(8) : name
  if (toolboxAliases.value.has(toolboxName)) {
    const desc = toolboxDescMap.value[toolboxName]
    const descLine = desc ? `\n${desc}` : ''
    return `${name}（Toolbox 工具集）${descLine}\n\n特性：全局去重 + 循环保护 + Fold 动态注入（仅特权角色展开）\n点击替换 / 拖拽移动 / Delete 删除`
  }
  const p = placeholderMap.value.get(name)
  if (p) {
    const desc = p.description ? `\n${p.description}` : ''
    const preview = p.preview ? `\n→ ${p.preview.slice(0, 100)}${p.preview.length > 100 ? '...' : ''}` : ''
    return `${p.name}${desc}${preview}\n\n点击替换 / 拖拽移动 / Delete 删除`
  }
  // 未命中已装 placeholders — 查 registry
  const found = lookupPlaceholder(placeholderRegistry.value, name)
  if (found) {
    const isInstalled = installedPluginNames.value.has(found.pluginKey)
    if (isInstalled) {
      return `✅ ${name}\n由已装插件「${found.plugin.displayName}」(${found.pluginKey}) 提供\n\n${found.plugin.description || found.entry.description || ''}\n\n点击替换 / 拖拽移动 / Delete 删除`
    }
    return `⚠️ ${name}\n此变量来自「${found.plugin.displayName}」插件（当前未安装）\n\n点击 chip 可一键跳转安装，装完立即可用`
  }
  return `❓ ${name}（未知变量，可能拼写错误或来自未收录插件） — 点击替换 / 拖拽移动`
}

// ============ 文本 ↔ HTML 转换 ============
// rawContent 不含两端符号（var: 'VarX' / rag: 'Nova日记本::Time::TagMemo0.65' / diary: 'VCP开发日记本'）
function makeChipHtml(rawContent: string, format: ChipFormat = 'var'): string {
  const primaryName = format === 'rag' ? rawContent.split('::')[0] : rawContent
  const k = classify(primaryName, format)
  const health = getHealth(primaryName, format)
  const tooltip = format === 'var' ? getVarTooltip(primaryName) : getSpecialTooltip(rawContent, format)
  // RAG 模式：chip 展示缩写（名称 · 模式1 · 模式2），节省空间
  const display = format === 'rag'
    ? primaryName + (rawContent.includes('::') ? ' · ' + rawContent.split('::').slice(1).map(m => m.replace(/^:/, '')).filter(Boolean).join(' · ') : '')
    : rawContent
  return `<span class="var-chip kind-${k} health-${health}" contenteditable="false" draggable="true" data-var="${escapeHtml(rawContent)}" data-format="${format}" data-health="${health}" title="${escapeHtml(tooltip)}">${escapeHtml(display)}</span>`
}

function getSpecialTooltip(raw: string, format: ChipFormat): string {
  const typeMap: Record<string, string> = {
    rag: 'RAG 无条件检索（[[...]]）',
    rag_sim: '相似度检索（<<...>>）',
    rag_hybrid: '混合阈值检索（《《...》》）',
  }
  const [name, ...modes] = raw.split('::')
  const modeDesc = modes.filter(Boolean).map(m => {
    const stripped = m.replace(/^:/, '')
    if (stripped.startsWith('TagMemo')) return `TagMemo 阈值 ${stripped.replace('TagMemo', '')}`
    if (stripped === 'Time') return '时间衰减'
    if (stripped === 'Group') return '语义分组'
    if (stripped === 'Rerank') return 'RRF 重排'
    return stripped
  }).join(' | ')
  return `${name}（${typeMap[format] || 'RAG'}）\n${modeDesc ? '修饰符：' + modeDesc : '无修饰符'}\n\nRAGDiaryPlugin 检索占位符，命中内容由插件注入`
}

function textToHtml(text: string): string {
  if (!text) return ''
  const lines = text.split('\n')
  return lines.map((line, i) => {
    let out = ''
    if (line === '') {
      // 空行
    } else {
      let lastIdx = 0
      // 匹配四种占位符：{{Var}} / {{toolbox:alias}} | [[X::modes]]（无条件）| <<X>>（相似度）| 《《X》》（混合阈值）
      const re = /(\{\{(?:toolbox:)?[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*\}\})|(\[\[[^\[\]\n]+?\]\])|(<<[^<>\n]+?>>)|(《《[^《》\n]+?》》)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        out += escapeHtml(line.substring(lastIdx, m.index))
        if (m[1]) {
          out += makeChipHtml(m[1].slice(2, -2), 'var')
        } else if (m[2]) {
          out += makeChipHtml(m[2].slice(2, -2), 'rag')
        } else if (m[3]) {
          out += makeChipHtml(m[3].slice(2, -2), 'rag_sim')
        } else if (m[4]) {
          out += makeChipHtml(m[4].slice(2, -2), 'rag_hybrid')
        }
        lastIdx = m.index + m[0].length
      }
      out += escapeHtml(line.substring(lastIdx))
    }
    if (i < lines.length - 1) out += '<br>'
    return out
  }).join('')
}

function htmlToText(root: HTMLElement): string {
  let out = ''
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.tagName === 'BR') {
        out += '\n'
      } else if (el.classList.contains('var-chip')) {
        const raw = el.dataset.var || el.textContent || ''
        const format = (el.dataset.format || 'var') as ChipFormat
        if (format === 'rag') out += `[[${raw}]]`
        else if (format === 'rag_sim') out += `<<${raw}>>`
        else if (format === 'rag_hybrid') out += `《《${raw}》》`
        else out += `{{${raw}}}`
      } else if (['DIV', 'P'].includes(el.tagName)) {
        if (out && !out.endsWith('\n')) out += '\n'
        for (const child of Array.from(el.childNodes)) walk(child)
      } else {
        for (const child of Array.from(el.childNodes)) walk(child)
      }
    }
  }
  for (const child of Array.from(root.childNodes)) walk(child)
  return out
}

function renderToEditor() {
  if (!editorEl.value) return
  editorEl.value.innerHTML = textToHtml(props.modelValue || '')
}

// ============ 编辑事件 ============
function syncFromEditor() {
  if (!editorEl.value) return
  const newText = htmlToText(editorEl.value)
  if (newText !== props.modelValue) {
    internalUpdate = true
    emit('update:modelValue', newText)
  }
}

function onEditorInput() {
  syncFromEditor()
  // 实时检测：如果用户输入了完整的 {{XXX}}，转 chip
  setTimeout(() => {
    if (!editorEl.value) return
    const html = editorEl.value.innerHTML
    if (/\{\{(?:toolbox:)?[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*\}\}/.test(html)) {
      const cursorAtEnd = isCursorAtEnd()
      renderToEditor()
      if (cursorAtEnd) moveCursorToEnd()
    }
  }, 60)
}

function onEditorBlur() {
  syncFromEditor()
}

function isCursorAtEnd(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !editorEl.value) return false
  const range = sel.getRangeAt(0)
  const endRange = document.createRange()
  endRange.selectNodeContents(editorEl.value)
  endRange.collapse(false)
  return range.compareBoundaryPoints(Range.END_TO_END, endRange) === 0
}

function moveCursorToEnd() {
  if (!editorEl.value) return
  const range = document.createRange()
  range.selectNodeContents(editorEl.value)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  editorEl.value.focus()
}

// ============ chip 点击替换 ============
const editingChipEl = ref<HTMLElement | null>(null)
const editingChipName = ref<string>('')

// ============ RAG chip 编辑器（三种 RAG 格式 + 元思考） ============
const ragEditorVisible = ref(false)
const ragEditorInitialType = ref<'rag' | 'rag_sim' | 'rag_hybrid'>('rag')
const ragEditorInitialRaw = ref('')

function openRagEditor(chip: HTMLElement) {
  editingChipEl.value = chip
  const fmt = (chip.dataset.format || 'var') as ChipFormat
  if (fmt === 'rag' || fmt === 'rag_sim' || fmt === 'rag_hybrid') {
    ragEditorInitialType.value = fmt
    ragEditorInitialRaw.value = chip.dataset.var || chip.textContent || ''
    ragEditorVisible.value = true
  }
}

function onRagEditorSave(payload: { format: 'rag' | 'rag_sim' | 'rag_hybrid'; raw: string }) {
  if (!editingChipEl.value) return
  // 用新 raw 和 format 重新生成 chip HTML（保留位置 + 更新样式/符号）
  const newHtml = makeChipHtml(payload.raw, payload.format)
  const tmp = document.createElement('div')
  tmp.innerHTML = newHtml
  const newChip = tmp.firstElementChild as HTMLElement
  if (newChip && editingChipEl.value.parentNode) {
    editingChipEl.value.parentNode.replaceChild(newChip, editingChipEl.value)
    editingChipEl.value = newChip
    syncFromEditor()
  }
}

function onRagEditorDelete() {
  if (!editingChipEl.value) return
  editingChipEl.value.remove()
  editingChipEl.value = null
  editingChipName.value = ''
  syncFromEditor()
}

function onEditorClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('var-chip')) {
    e.preventDefault()
    const fmt = (target.dataset.format || 'var') as ChipFormat
    // RAG 三种格式 chip 走专属编辑器
    if (fmt === 'rag' || fmt === 'rag_sim' || fmt === 'rag_hybrid') {
      openRagEditor(target)
      return
    }
    // 普通 Var chip 走 picker
    editingChipEl.value = target
    editingChipName.value = target.dataset.var || target.textContent || ''
    openPicker(true)
  }
}

// 当前点击 chip 的 format 类型
const currentChipFormat = computed<ChipFormat>(() => {
  return (editingChipEl.value?.dataset.format || 'var') as ChipFormat
})

// 当前点击 chip 对应的占位符元数据（仅 var 格式有，来自 placeholders API）
const currentChipPlaceholder = computed(() => {
  if (!editingChipName.value || currentChipFormat.value !== 'var') return null
  return placeholderMap.value.get(editingChipName.value) || null
})

// RAG / Tool 等的内置描述（不依赖 placeholders API）
const currentChipSpecialInfo = computed(() => {
  if (!editingChipName.value) return null
  const fmt = currentChipFormat.value
  const ragTypeLabel: Record<string, string> = {
    rag: 'RAG 无条件检索 [[...]]',
    rag_sim: '相似度检索 <<...>>',
    rag_hybrid: '混合阈值检索 《《...》》',
  }
  if (fmt === 'rag' || fmt === 'rag_sim' || fmt === 'rag_hybrid') {
    const [name, ...modes] = editingChipName.value.split('::')
    const modeList = modes.filter(Boolean).map(m => {
      const s = m.replace(/^:/, '')
      if (s.startsWith('TagMemo')) return `TagMemo 阈值 ${s.replace('TagMemo', '')}`
      if (s === 'Time') return '时间衰减'
      if (s === 'Group') return '语义分组'
      if (s === 'Rerank') return 'RRF 重排'
      if (/^\d+\.?\d*$/.test(s)) return `K 值乘数 ${s}`
      return s
    })
    return {
      description: `${ragTypeLabel[fmt]} — 运行时由 RAGDiaryPlugin 从 ${name} 中召回相关内容`,
      preview: modeList.length > 0 ? `修饰符：${modeList.join(' + ')}` : '无修饰符',
    }
  }
  // Var 格式且名字是 VCPXxx 前缀 → 工具占位符友好提示
  if (fmt === 'var' && editingChipName.value.startsWith('VCP')) {
    const p = placeholderMap.value.get(editingChipName.value)
    if (!p) {
      return {
        description: `VCP 工具描述占位符 — 由对应插件通过 systemPromptPlaceholders 提供`,
        preview: `当前未安装 ${editingChipName.value.slice(3)} 插件，占位符会展开为空串（不影响提示词其他部分）`,
      }
    }
  }
  return null
})

const currentChipKind = computed(() => {
  if (!editingChipName.value) return 'Sys'
  const fmt = currentChipFormat.value
  const name = fmt === 'rag' ? editingChipName.value.split('::')[0] : editingChipName.value
  return classify(name, fmt)
})

// 当前 chip 的 registry 信息（pattern 命中或显式 registry 条目都返回，区分装/未装状态）
const currentChipRegistryInfo = computed(() => {
  if (!editingChipName.value || currentChipFormat.value !== 'var') return null
  const found = lookupPlaceholder(placeholderRegistry.value, editingChipName.value)
  if (!found) return null
  // 已装 or 核心插件 → 正常显示「✅ 由 XXX 提供」；未装 → 显示安装按钮
  const isInstalled = installedPluginNames.value.has(found.pluginKey)
    || !!(placeholderRegistry.value?.patternRules || []).find(r => {
      try { return r.isCorePlugin && new RegExp(r.pattern, r.flags || '').test(editingChipName.value) && r.plugin === found.pluginKey } catch { return false }
    })
  return {
    pluginKey: found.pluginKey,
    displayName: found.plugin.displayName,
    category: found.plugin.category,
    icon: found.plugin.icon,
    description: found.plugin.description || found.entry.description || '',
    kind: found.entry.kind,
    commands: found.entry.commands || [],
    isInstalled,
  }
})

const installingPluginKey = ref<string | null>(null)
async function installMissingPlugin(pluginKey: string) {
  if (installingPluginKey.value) return
  installingPluginKey.value = pluginKey
  try {
    const r = await installPlugin(pluginKey)
    const ok = r?.success || r?.status === 'success'
    if (ok) {
      // 热加载生效 → 重新拉 placeholders + 重绘 chip
      const reload = await getPlaceholders()
      placeholders.value = reload.data?.list || placeholders.value
      if (mode.value === 'rich') renderToEditor()
      // 关闭 picker
      pickerOpen.value = false
    } else {
      // 失败：保留 picker 让用户看到错误
      console.warn('[PromptEditor] install 失败:', r?.message)
    }
  } catch (e) {
    console.error('[PromptEditor] install 异常:', e)
  } finally {
    installingPluginKey.value = null
  }
}

// 扫描当前文本，统计所有占位符的健康度（供父组件订阅）
interface HealthIssue {
  placeholder: string
  format: ChipFormat
  health: PlaceholderHealth
  pluginKey?: string
  pluginDisplayName?: string
}
interface HealthSummary {
  total: number
  ok: number
  missingPlugin: number
  unknown: number
  issues: HealthIssue[]
}

const healthSummary = computed<HealthSummary>(() => {
  const text = props.modelValue || ''
  const seen = new Set<string>()
  const issues: HealthIssue[] = []
  let total = 0, ok = 0, missingPlugin = 0, unknown = 0

  const re = /(\{\{(?:toolbox:)?[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*\}\})|(\[\[[^\[\]\n]+?\]\])|(<<[^<>\n]+?>>)|(《《[^《》\n]+?》》)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let raw = ''
    let fmt: ChipFormat = 'var'
    if (m[1]) { raw = m[1].slice(2, -2); fmt = 'var' }
    else if (m[2]) { raw = m[2].slice(2, -2); fmt = 'rag' }
    else if (m[3]) { raw = m[3].slice(2, -2); fmt = 'rag_sim' }
    else if (m[4]) { raw = m[4].slice(2, -2); fmt = 'rag_hybrid' }
    const key = `${fmt}:${raw}`
    if (seen.has(key)) continue
    seen.add(key)
    total++
    const primaryName = fmt === 'rag' ? raw.split('::')[0] : raw
    const h = getHealth(primaryName, fmt)
    if (h === 'ok') ok++
    else if (h === 'missing-plugin') {
      missingPlugin++
      const found = lookupPlaceholder(placeholderRegistry.value, primaryName)
      issues.push({
        placeholder: raw,
        format: fmt,
        health: h,
        pluginKey: found?.pluginKey,
        pluginDisplayName: found?.plugin.displayName,
      })
    } else {
      unknown++
      issues.push({ placeholder: raw, format: fmt, health: h })
    }
  }
  return { total, ok, missingPlugin, unknown, issues }
})

defineExpose({
  healthSummary,
  installMissingPlugin,
  installingPluginKey,
})

// ============ chip 拖拽 ============
let draggingChip: HTMLElement | null = null

function onEditorDragStart(e: DragEvent) {
  const target = e.target as HTMLElement
  if (target.classList?.contains('var-chip')) {
    draggingChip = target
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', target.dataset.var || '')
    }
    target.classList.add('dragging')
  }
}

function onEditorDragEnd(e: DragEvent) {
  const target = e.target as HTMLElement
  if (target.classList?.contains('var-chip')) {
    target.classList.remove('dragging')
  }
  draggingChip = null
}

function onEditorDragOver(e: DragEvent) {
  if (draggingChip) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }
}

function onEditorDrop(e: DragEvent) {
  if (!draggingChip || !editorEl.value) return
  e.preventDefault()
  // 用 caretRangeFromPoint / caretPositionFromPoint 拿到 drop 位置
  let range: Range | null = null
  // @ts-ignore - chrome
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY)
  // @ts-ignore - firefox
  else if (document.caretPositionFromPoint) {
    // @ts-ignore
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY)
    if (pos) {
      range = document.createRange()
      range.setStart(pos.offsetNode, pos.offset)
      range.collapse(true)
    }
  }
  if (range) {
    // 移除原位置
    draggingChip.remove()
    // 在新位置插入
    range.insertNode(draggingChip)
    range.setStartAfter(draggingChip)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }
  draggingChip.classList.remove('dragging')
  draggingChip = null
  syncFromEditor()
}

// 外部 modelValue 变化 → 重新渲染（除非内部触发）
watch(() => props.modelValue, () => {
  if (internalUpdate) { internalUpdate = false; return }
  renderToEditor()
})

// 模式切换 → 重新渲染
watch(mode, async (m) => {
  if (m === 'rich') {
    await nextTick()
    renderToEditor()
  }
})

onMounted(() => {
  renderToEditor()
  // 预加载占位符列表（hover tooltip 即时可用 + 弹窗无延迟）
  if (placeholders.value.length === 0) {
    getPlaceholders().then(r => {
      placeholders.value = r.data?.list || []
      // 加载完成后重新渲染一次更新 chip tooltip
      if (mode.value === 'rich') renderToEditor()
    }).catch(() => {})
  }
  // 预加载 Toolbox 工具集列表（classify 用于识别 alias chip）
  loadToolboxMap()
  // 预加载 placeholder registry（识别未装插件提供的占位符）
  getPlaceholderRegistry().then(r => {
    placeholderRegistry.value = r.data || null
    const reg = placeholderRegistry.value
    console.log('[PromptEditor] Registry 加载完成:', {
      hasData: !!reg,
      pluginCount: Object.keys(reg?.plugins || {}).length,
      patternCount: (reg?.patternRules || []).length,
      patterns: (reg?.patternRules || []).map(p => ({ pattern: p.pattern, plugin: p.plugin })),
    })
    // 立即测试 Nova表情包 识别
    if (reg) {
      const testMatch = (reg.patternRules || []).find(p => {
        try { return new RegExp(p.pattern, p.flags || '').test('Nova表情包') } catch { return false }
      })
      console.log('[PromptEditor] Nova表情包 → pattern 匹配:', testMatch ? testMatch.plugin : '无')
    }
    if (mode.value === 'rich') renderToEditor()
  }).catch(e => {
    console.warn('[PromptEditor] Registry 加载失败:', e)
  })
  // 预加载已装插件列表（用于 pattern 规则 + 已装判定：比如 EmojiListGenerator 装了，{{XXX表情包}} 应该变绿）
  loadInstalledPlugins()
})

async function loadInstalledPlugins() {
  try {
    const r = await listPlugins({ suppressErrorToast: true, showLoader: false })
    // /admin_api/plugins 直接返回数组（不走 {data:[]} 包装）
    const list = (Array.isArray(r) ? r : []) as Array<{ name?: string; manifest?: { name?: string } }>
    const names = new Set<string>()
    for (const p of list) {
      const n = p?.name || p?.manifest?.name
      if (n) names.add(n)
    }
    installedPluginNames.value = names
    console.log('[PromptEditor] 已装插件加载完成:', names.size, '个 — EmojiListGenerator=' + names.has('EmojiListGenerator'))
    if (mode.value === 'rich') renderToEditor()
  } catch (e) { console.warn('[PromptEditor] loadInstalledPlugins 失败（不阻断）:', e) }
}

// ============ Toolbox 工具集加载 ============
const toolboxLoading = ref(false)
const toolboxDropdownOpen = ref(false)
async function loadToolboxMap() {
  if (toolboxLoading.value) return
  toolboxLoading.value = true
  try {
    const map = (await getToolboxMap()) as ToolboxMap
    const aliases = new Set<string>()
    const descMap: Record<string, string> = {}
    for (const [alias, entry] of Object.entries(map || {})) {
      aliases.add(alias)
      descMap[alias] = entry?.description || ''
    }
    toolboxAliases.value = aliases
    toolboxDescMap.value = descMap
    // 重新渲染让已有 chip 的 Toolbox 识别生效
    if (mode.value === 'rich') renderToEditor()
  } catch {
    // 无 toolbox 也不阻断（用户可能还没创建）
  } finally {
    toolboxLoading.value = false
  }
}

// Toolbox 列表（按 description 加别名排序）
const toolboxList = computed(() =>
  Array.from(toolboxAliases.value).sort().map(alias => ({
    alias,
    description: toolboxDescMap.value[alias] || '',
  })),
)

function insertToolbox(alias: string) {
  toolboxDropdownOpen.value = false
  if (mode.value === 'rich' && editorEl.value) {
    const tmp = document.createElement('div')
    tmp.innerHTML = makeChipHtml(alias)
    const chip = tmp.firstChild as HTMLElement
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorEl.value.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(chip)
      range.setStartAfter(chip)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      editorEl.value.appendChild(chip)
      moveCursorToEnd()
    }
    syncFromEditor()
  } else {
    rawText.value = (props.modelValue || '') + '{' + '{' + alias + '}' + '}'
  }
}

function toggleToolboxDropdown() {
  toolboxDropdownOpen.value = !toolboxDropdownOpen.value
  if (toolboxDropdownOpen.value && toolboxAliases.value.size === 0) {
    loadToolboxMap()
  }
}

// ============ 高级模式 textarea ============
const rawText = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

// ============ 占位符选择弹窗（插入 / 替换） ============
const pickerOpen = ref(false)
const isReplacingChip = ref(false)
const pickerLoading = ref(false)
const pickerSearch = ref('')
const activeCategory = ref<'all' | PlaceholderType>('all')

const CATEGORY_LABEL: Record<PlaceholderType, string> = {
  agent: 'Agent 变量',
  env_tar_var: 'Tar / Var 变量',
  env_sar: 'Sar 模型条件',
  fixed: '固定占位符',
  static_plugin: '静态插件',
  tool_description: '工具描述',
  vcp_all_tools: '全工具列表',
  image_key: '图床密钥',
  diary: '日记本',
  diary_character: '人物日记',
  async_placeholder: '异步占位符',
  emoji: '表情包清单',
}

const CATEGORY_ICON: Partial<Record<PlaceholderType, string>> = {
  agent: 'smart_toy',
  env_tar_var: 'data_object',
  env_sar: 'tune',
  fixed: 'pin',
  static_plugin: 'extension',
  tool_description: 'build',
  vcp_all_tools: 'apps',
  image_key: 'image',
  diary: 'menu_book',
  diary_character: 'person',
  async_placeholder: 'schedule',
  emoji: 'emoji_emotions',
}

const categoryTabs = computed(() => {
  const counts: Record<string, number> = {}
  for (const p of placeholders.value) counts[p.type] = (counts[p.type] || 0) + 1
  const tabs: Array<{ key: 'all' | PlaceholderType; label: string; icon?: string; count: number }> = [
    { key: 'all', label: '全部', icon: 'list', count: placeholders.value.length },
  ]
  for (const [k, c] of Object.entries(counts)) {
    if (c === 0) continue
    tabs.push({
      key: k as PlaceholderType,
      label: CATEGORY_LABEL[k as PlaceholderType] || k,
      icon: CATEGORY_ICON[k as PlaceholderType],
      count: c,
    })
  }
  return tabs
})

const filteredPlaceholders = computed(() => {
  const kw = pickerSearch.value.trim().toLowerCase()
  return placeholders.value.filter(p => {
    if (activeCategory.value !== 'all' && p.type !== activeCategory.value) return false
    if (kw && !p.name.toLowerCase().includes(kw)
            && !(p.description || '').toLowerCase().includes(kw)
            && !(p.preview || '').toLowerCase().includes(kw)) return false
    return true
  })
})

async function openPicker(forReplace = false) {
  isReplacingChip.value = forReplace
  pickerOpen.value = true
  // 替换模式：清空筛选 + 自动定位到当前变量分类（让相关同类变量也容易看到）
  if (forReplace && editingChipName.value) {
    pickerSearch.value = ''
    activeCategory.value = 'all'
    // 等数据加载完后，尝试设置 activeCategory 为同类（让用户优先在同类里找替代项）
    nextTick(() => {
      const p = currentChipPlaceholder.value
      if (p) activeCategory.value = p.type
    })
  } else {
    isReplacingChip.value = false
    editingChipName.value = ''
  }
  if (placeholders.value.length === 0) {
    pickerLoading.value = true
    try {
      const r = await getPlaceholders()
      placeholders.value = r.data?.list || []
      if (forReplace && editingChipName.value) {
        const p = placeholderMap.value.get(editingChipName.value)
        if (p) activeCategory.value = p.type
      }
    } finally { pickerLoading.value = false }
  }
}

function pickPlaceholder(p: PlaceholderItem) {
  const nameOnly = p.name.replace(/^\{\{|\}\}$/g, '')
  if (isReplacingChip.value && editingChipEl.value) {
    // 替换原 chip
    const k = classify(nameOnly)
    editingChipEl.value.className = `var-chip kind-${k}`
    editingChipEl.value.dataset.var = nameOnly
    editingChipEl.value.title = getVarTooltip(nameOnly)
    editingChipEl.value.textContent = nameOnly
    editingChipEl.value = null
    syncFromEditor()
  } else {
    // 在光标位置插入新 chip
    if (mode.value === 'rich' && editorEl.value) {
      const tmp = document.createElement('div')
      tmp.innerHTML = makeChipHtml(nameOnly)
      const chip = tmp.firstChild as HTMLElement
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && editorEl.value.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(chip)
        range.setStartAfter(chip)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        editorEl.value.appendChild(chip)
        moveCursorToEnd()
      }
      syncFromEditor()
    } else {
      // raw 模式追加
      rawText.value = (props.modelValue || '') + p.name
    }
  }
  pickerOpen.value = false
  isReplacingChip.value = false
}

function deleteEditingChip() {
  if (editingChipEl.value) {
    editingChipEl.value.remove()
    editingChipEl.value = null
    syncFromEditor()
  }
  pickerOpen.value = false
  isReplacingChip.value = false
}

const exampleVarLiteral = '{' + '{' + 'AgentName' + '}' + '}'

// 一键插入 {{VCPAllTools}}：让 Agent 使用所有已装插件工具（最常用）
function insertAllTools() {
  const name = 'VCPAllTools'
  if (mode.value === 'rich' && editorEl.value) {
    const tmp = document.createElement('div')
    tmp.innerHTML = makeChipHtml(name)
    const chip = tmp.firstChild as HTMLElement
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorEl.value.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(chip)
      range.setStartAfter(chip)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      editorEl.value.appendChild(chip)
      moveCursorToEnd()
    }
    syncFromEditor()
  } else {
    rawText.value = (props.modelValue || '') + '{' + '{' + name + '}' + '}'
  }
}
</script>

<template>
  <div class="prompt-editor">
    <!-- 工具栏 -->
    <div class="pe-toolbar">
      <div class="mode-switch">
        <button :class="{ active: mode === 'rich' }" @click="mode = 'rich'" type="button" title="小白模式：变量显示为可拖拽的彩色徽章">
          <span class="material-symbols-outlined">visibility</span>
          小白
        </button>
        <button :class="{ active: mode === 'raw' }" @click="mode = 'raw'" type="button" title="高级模式：直接编辑原文（含 {{}} 字面量）">
          <span class="material-symbols-outlined">code</span>
          高级
        </button>
      </div>

      <button class="btn-insert" @click="openPicker(false)" type="button">
        <span class="material-symbols-outlined">add_circle</span>
        插入变量
      </button>

      <button
        class="btn-all-tools"
        @click="insertAllTools"
        type="button"
        title="在光标处插入 {{VCPAllTools}}，让 Agent 自动使用所有已装插件工具"
      >
        <span class="material-symbols-outlined">auto_awesome</span>
        一键全工具
      </button>

      <!-- Toolbox 工具集下拉 -->
      <div class="toolbox-wrap">
        <button
          class="btn-toolbox"
          @click="toggleToolboxDropdown"
          type="button"
          :title="toolboxList.length
            ? `插入 Toolbox 工具集（共 ${toolboxList.length} 个）`
            : '还没有 Toolbox，先去 Toolbox 管理创建'"
        >
          <span class="material-symbols-outlined">inventory_2</span>
          Toolbox
          <span v-if="toolboxList.length" class="tb-count">{{ toolboxList.length }}</span>
          <span class="material-symbols-outlined tb-caret">expand_more</span>
        </button>
        <div v-if="toolboxDropdownOpen" class="tb-dropdown" @click.self="toolboxDropdownOpen = false">
          <div class="tb-menu">
            <div class="tb-head">
              <span>选择 Toolbox 工具集</span>
              <button class="tb-close" @click="toolboxDropdownOpen = false" type="button">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
            <div v-if="toolboxLoading" class="tb-empty">加载中…</div>
            <div v-else-if="!toolboxList.length" class="tb-empty">
              还没有 Toolbox，先去
              <router-link :to="{ name: 'toolbox' }" @click="toolboxDropdownOpen = false">Toolbox 管理</router-link>
              创建嘛
            </div>
            <ul v-else class="tb-list">
              <li v-for="t in toolboxList" :key="t.alias" @click="insertToolbox(t.alias)" class="tb-item">
                <span class="tb-alias-dot"></span>
                <div class="tb-info">
                  <strong class="tb-alias">{{ t.alias }}</strong>
                  <span v-if="t.description" class="tb-desc">{{ t.description }}</span>
                </div>
                <span class="material-symbols-outlined tb-arrow">north_east</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <span class="hint">
        💡 鼠标停留徽章看内容；点击徽章可替换；按住拖动改位置
      </span>
      <span class="char-count">{{ (modelValue || '').length }} 字</span>
    </div>

    <!-- 小白模式：contenteditable + chip -->
    <div
      v-show="mode === 'rich'"
      ref="editorEl"
      class="pe-rich"
      contenteditable="true"
      :data-placeholder="placeholder || `直接打字。需要变量？点上方「插入变量」，或写 ${exampleVarLiteral} 自动转徽章。`"
      @input="onEditorInput"
      @blur="onEditorBlur"
      @click="onEditorClick"
      @dragstart="onEditorDragStart"
      @dragend="onEditorDragEnd"
      @dragover="onEditorDragOver"
      @drop="onEditorDrop"
      spellcheck="false"
    />

    <!-- 高级模式：textarea -->
    <textarea
      v-if="mode === 'raw'"
      v-model="rawText"
      class="pe-raw"
      :rows="rows || 22"
      :placeholder="placeholder || '原文模式：直接编辑文本（变量用 {{XXX}} 表示）'"
      spellcheck="false"
    />

    <!-- 占位符选择弹窗 -->
    <BaseModal v-model="pickerOpen" :title="isReplacingChip ? '替换变量' : '插入变量'" width="900px">
      <div class="picker">
        <!-- 当前点击的 chip 信息卡（替换模式独有） -->
        <div v-if="isReplacingChip && editingChipName" class="current-chip-card" :class="`kind-${currentChipKind}`">
          <div class="cc-icon">
            <span class="material-symbols-outlined">touch_app</span>
          </div>
          <div class="cc-info">
            <div class="cc-head">
              <span class="cc-label">当前变量</span>
              <code class="cc-name">{{ editingChipName }}</code>
              <span class="cc-kind-tag">{{ KIND_LABEL[currentChipKind] }}</span>
            </div>
            <div v-if="currentChipRegistryInfo" class="cc-registry-hint" :class="{ installed: currentChipRegistryInfo.isInstalled }">
              <p class="cc-desc">
                <span class="material-symbols-outlined">{{ currentChipRegistryInfo.isInstalled ? 'check_circle' : 'info' }}</span>
                <template v-if="currentChipRegistryInfo.isInstalled">
                  此变量由已装插件「<strong>{{ currentChipRegistryInfo.displayName }}</strong>」提供
                </template>
                <template v-else>
                  此变量来自「<strong>{{ currentChipRegistryInfo.displayName }}</strong>」插件
                </template>
                <code class="cc-plugin-key">{{ currentChipRegistryInfo.pluginKey }}</code>
              </p>
              <p v-if="currentChipRegistryInfo.description" class="cc-preview">
                {{ currentChipRegistryInfo.description }}
              </p>
              <p v-if="currentChipRegistryInfo.commands?.length" class="cc-commands">
                提供命令：{{ currentChipRegistryInfo.commands.slice(0, 5).join(' · ') }}{{ currentChipRegistryInfo.commands.length > 5 ? ' ...' : '' }}
              </p>
              <button
                v-if="!currentChipRegistryInfo.isInstalled"
                class="cc-install-btn"
                :disabled="!!installingPluginKey"
                @click="installMissingPlugin(currentChipRegistryInfo.pluginKey)"
                type="button"
              >
                <span class="material-symbols-outlined">
                  {{ installingPluginKey === currentChipRegistryInfo.pluginKey ? 'progress_activity' : 'cloud_download' }}
                </span>
                {{ installingPluginKey === currentChipRegistryInfo.pluginKey ? '正在安装并热加载...' : '一键安装修复（无需重启）' }}
              </button>
            </div>
            <div v-else-if="currentChipSpecialInfo">
              <p class="cc-desc">{{ currentChipSpecialInfo.description }}</p>
              <p class="cc-preview">→ {{ currentChipSpecialInfo.preview }}</p>
            </div>
            <div v-else-if="currentChipPlaceholder">
              <p v-if="currentChipPlaceholder.description" class="cc-desc">{{ currentChipPlaceholder.description }}</p>
              <p v-if="currentChipPlaceholder.preview" class="cc-preview">→ {{ currentChipPlaceholder.preview }}</p>
            </div>
            <p v-else class="cc-unknown">❌ 此变量在已装插件和云仓库 registry 中都未找到（可能拼写错误或来自私人插件）</p>
          </div>
          <button class="cc-delete" @click="deleteEditingChip" type="button" title="删除此变量">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>

        <div v-if="isReplacingChip" class="picker-divider">
          <span>↓ 选下方任一变量进行替换 ↓</span>
        </div>

        <div class="picker-toolbar">
          <input
            v-model="pickerSearch"
            type="search"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            placeholder="搜索变量名 / 描述 / 内容..."
            class="picker-search"
          />
          <span class="picker-stat">共 {{ filteredPlaceholders.length }} 项</span>
        </div>

        <div v-if="categoryTabs.length > 1" class="cat-tabs">
          <button
            v-for="t in categoryTabs"
            :key="t.key"
            class="cat-tab"
            :class="{ active: activeCategory === t.key }"
            @click="activeCategory = t.key"
            type="button"
          >
            <span v-if="t.icon" class="material-symbols-outlined">{{ t.icon }}</span>
            {{ t.label }}
            <span class="cnt">{{ t.count }}</span>
          </button>
        </div>

        <div v-if="pickerLoading" class="picker-loading">
          <span class="material-symbols-outlined spin">progress_activity</span>
          加载中...
        </div>

        <div v-else-if="filteredPlaceholders.length === 0" class="picker-empty">
          <span class="material-symbols-outlined">search_off</span>
          没有匹配的变量
        </div>

        <div v-else class="picker-grid">
          <div
            v-for="p in filteredPlaceholders"
            :key="p.name"
            class="ph-card"
            :class="{ 'is-current': isReplacingChip && p.name.replace(/^\{\{|\}\}$/g, '') === editingChipName }"
            @click="pickPlaceholder(p)"
          >
            <div class="ph-head">
              <code class="ph-name">{{ p.name }}</code>
              <span class="ph-tag">{{ CATEGORY_LABEL[p.type] || p.type }}</span>
            </div>
            <p v-if="p.description" class="ph-desc">{{ p.description }}</p>
            <p v-if="p.preview" class="ph-preview">{{ p.preview }}</p>
          </div>
        </div>
      </div>
      <template v-if="isReplacingChip" #footer>
        <button class="btn btn-danger" @click="deleteEditingChip" type="button">
          <span class="material-symbols-outlined">delete</span>
          删除此变量
        </button>
        <button class="btn btn-ghost" @click="pickerOpen = false; editingChipEl = null" type="button">取消</button>
      </template>
    </BaseModal>

    <!-- RAG / DiaryAll / 元思考 专属编辑器 -->
    <RagChipEditor
      v-model="ragEditorVisible"
      :initial-type="ragEditorInitialType"
      :initial-raw="ragEditorInitialRaw"
      @save="onRagEditorSave"
      @delete="onRagEditorDelete"
    />
  </div>
</template>

<style scoped lang="scss">
.prompt-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--secondary-bg);
}

/* ============ 顶部工具栏 ============ */
.pe-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--tertiary-bg);
  border-bottom: 1px solid var(--border-color);
}
.mode-switch {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  button {
    padding: 4px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--secondary-text);
    &.active { color: #fff; background: var(--button-bg); }
    &:not(.active):hover { background: var(--accent-bg); }
    .material-symbols-outlined { font-size: 14px; }
  }
}
.btn-insert {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--button-bg);
  color: #fff;
  border: none;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 5px rgba(228, 104, 156, 0.2);
  transition: all 0.12s;
  &:hover { filter: brightness(1.08); transform: translateY(-1px); }
  .material-symbols-outlined { font-size: 16px; }
}
.btn-all-tools {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #0ea5e9, #6366f1);
  color: #fff;
  border: none;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 5px rgba(14, 165, 233, 0.25);
  transition: all 0.12s;
  &:hover { filter: brightness(1.12); transform: translateY(-1px); }
  .material-symbols-outlined { font-size: 16px; }
}
.toolbox-wrap {
  position: relative;
  display: inline-flex;
}
.btn-toolbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #14b8a6, #22c55e);
  color: #fff;
  border: none;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 5px rgba(20, 184, 166, 0.25);
  transition: all 0.12s;
  &:hover { filter: brightness(1.12); transform: translateY(-1px); }
  .material-symbols-outlined { font-size: 16px; }
  .tb-caret { font-size: 14px; margin-left: -2px; opacity: 0.85; }
  .tb-count {
    background: rgba(255, 255, 255, 0.3);
    padding: 0 6px;
    border-radius: 8px;
    font-size: 11px;
  }
}
.tb-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  min-width: 320px;
  max-width: 480px;
}
.tb-menu {
  background: var(--primary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  animation: tbFadeIn 0.12s ease-out;
}
@keyframes tbFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.tb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.12), rgba(34, 197, 94, 0.06));
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-text);
  .tb-close {
    background: transparent; border: none; cursor: pointer;
    color: var(--secondary-text);
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    &:hover { background: rgba(0, 0, 0, 0.06); }
    .material-symbols-outlined { font-size: 15px; }
  }
}
.tb-empty {
  padding: 20px 14px;
  text-align: center;
  color: var(--secondary-text);
  font-size: 12px;
  a { color: var(--highlight-text); text-decoration: underline; }
}
.tb-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 340px;
  overflow-y: auto;
}
.tb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.08s;
  &:hover {
    background: linear-gradient(135deg, rgba(20, 184, 166, 0.08), rgba(34, 197, 94, 0.04));
    .tb-arrow { opacity: 1; transform: translateX(2px) translateY(-2px); }
  }
  .tb-alias-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: linear-gradient(135deg, #14b8a6, #22c55e);
    flex-shrink: 0;
  }
  .tb-info { flex: 1; min-width: 0; }
  .tb-alias {
    display: block;
    font-size: 12.5px;
    color: var(--primary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
  }
  .tb-desc {
    display: block;
    font-size: 11px;
    color: var(--secondary-text);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tb-arrow {
    font-size: 14px;
    color: #14b8a6;
    opacity: 0.3;
    transition: all 0.12s;
  }
}
.hint {
  flex: 1;
  font-size: 11px;
  color: var(--secondary-text);
}
.char-count {
  font-size: 11px;
  color: var(--secondary-text);
  font-family: monospace;
}

/* ============ contenteditable 编辑器 ============ */
.pe-rich {
  flex: 1;
  min-height: 360px;
  max-height: 65vh;
  padding: 14px 16px;
  background: var(--input-bg);
  color: var(--primary-text);
  font-size: 13px;
  line-height: 1.95;
  outline: none;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  &:focus { background: var(--secondary-bg); }
  &:empty:before {
    content: attr(data-placeholder);
    color: var(--secondary-text);
    opacity: 0.55;
    pointer-events: none;
  }
}

.pe-raw {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  padding: 12px 14px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  resize: vertical;
  background: var(--input-bg);
  color: var(--primary-text);
  min-height: 360px;
  &:focus { background: var(--secondary-bg); }
}

/* ============ chip 样式（contenteditable 内） ============ */
.pe-rich :deep(.var-chip),
.var-chip {
  display: inline-block;
  padding: 1px 12px;
  margin: 0 3px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 14px;
  font-family: 'SF Mono', Consolas, monospace;
  cursor: grab;
  vertical-align: 1px;
  white-space: nowrap;
  user-select: none;
  transition: all 0.12s;
  position: relative;
  &:hover {
    transform: translateY(-1px) scale(1.04);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
    z-index: 2;
  }
  &:active { cursor: grabbing; }
  &.dragging { opacity: 0.4; cursor: grabbing; }
  &.kind-Tar { background: rgba(106, 120, 212, 0.18); color: #4956b5; border: 1px solid rgba(106, 120, 212, 0.4); }
  &.kind-Var { background: rgba(92, 178, 163, 0.18); color: #3d8d80; border: 1px solid rgba(92, 178, 163, 0.4); }
  &.kind-Sar { background: rgba(230, 138, 76, 0.18); color: #b96b2f; border: 1px solid rgba(230, 138, 76, 0.4); }
  &.kind-Timeline { background: rgba(217, 119, 87, 0.18); color: #b8522e; border: 1px solid rgba(217, 119, 87, 0.4); }
  &.kind-Rag { background: rgba(139, 92, 246, 0.18); color: #6d3fc5; border: 1px solid rgba(139, 92, 246, 0.4); }
  &.kind-RagSim { background: rgba(99, 102, 241, 0.18); color: #4c4fd4; border: 1px solid rgba(99, 102, 241, 0.4); }
  &.kind-RagHybrid { background: rgba(217, 70, 239, 0.18); color: #a732c8; border: 1px solid rgba(217, 70, 239, 0.4); }
  &.kind-Tool { background: rgba(14, 165, 233, 0.15); color: #0284c7; border: 1px solid rgba(14, 165, 233, 0.35); }
  &.kind-Toolbox { background: linear-gradient(135deg, rgba(20, 184, 166, 0.18), rgba(34, 197, 94, 0.12)); color: #0d9488; border: 1px solid rgba(20, 184, 166, 0.4); }
  &.kind-Emoji { background: linear-gradient(135deg, rgba(250, 204, 21, 0.2), rgba(245, 158, 11, 0.15)); color: #b45309; border: 1px solid rgba(245, 158, 11, 0.45); }
  &.kind-Diary { background: linear-gradient(135deg, rgba(168, 85, 247, 0.18), rgba(139, 92, 246, 0.12)); color: #7c3aed; border: 1px solid rgba(168, 85, 247, 0.4); }
  &.kind-Agent { background: rgba(212, 116, 142, 0.18); color: #b25a76; border: 1px solid rgba(212, 116, 142, 0.4); }
  &.kind-Sys { background: rgba(136, 136, 136, 0.18); color: #555; border: 1px solid rgba(136, 136, 136, 0.4); }

  /* 三态健康度覆盖层 —— 覆盖 kind-* 的 border 样式，表达失效警告 */
  &.health-missing-plugin {
    border-color: #f59e0b !important;
    border-style: dashed !important;
    border-width: 1.5px !important;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.12);
    &::after {
      content: '⚠';
      font-size: 10px;
      margin-left: 4px;
      color: #d97706;
      font-weight: 700;
    }
  }
  &.health-unknown {
    border-color: #ef4444 !important;
    border-style: dashed !important;
    border-width: 1.5px !important;
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.12);
    opacity: 0.8;
    &::after {
      content: '?';
      font-size: 10px;
      margin-left: 4px;
      color: #b91c1c;
      font-weight: 700;
    }
  }
}

/* ============ 占位符选择弹窗 ============ */
.picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 65vh;
}

/* 当前 chip 信息卡 */
.current-chip-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1.5px solid;
  background: linear-gradient(135deg, rgba(228, 104, 156, 0.04), rgba(155, 109, 208, 0.04));
  &.kind-Tar { border-color: rgba(106, 120, 212, 0.5); background: linear-gradient(135deg, rgba(106, 120, 212, 0.08), rgba(106, 120, 212, 0.02)); }
  &.kind-Var { border-color: rgba(92, 178, 163, 0.5); background: linear-gradient(135deg, rgba(92, 178, 163, 0.08), rgba(92, 178, 163, 0.02)); }
  &.kind-Sar { border-color: rgba(230, 138, 76, 0.5); background: linear-gradient(135deg, rgba(230, 138, 76, 0.08), rgba(230, 138, 76, 0.02)); }
  &.kind-Timeline { border-color: rgba(217, 119, 87, 0.5); background: linear-gradient(135deg, rgba(217, 119, 87, 0.08), rgba(217, 119, 87, 0.02)); }
  &.kind-Rag { border-color: rgba(139, 92, 246, 0.5); background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(139, 92, 246, 0.02)); }
  &.kind-RagSim { border-color: rgba(99, 102, 241, 0.5); background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.02)); }
  &.kind-RagHybrid { border-color: rgba(217, 70, 239, 0.5); background: linear-gradient(135deg, rgba(217, 70, 239, 0.08), rgba(217, 70, 239, 0.02)); }
  &.kind-Tool { border-color: rgba(14, 165, 233, 0.5); background: linear-gradient(135deg, rgba(14, 165, 233, 0.08), rgba(14, 165, 233, 0.02)); }
  &.kind-Toolbox { border-color: rgba(20, 184, 166, 0.5); background: linear-gradient(135deg, rgba(20, 184, 166, 0.08), rgba(34, 197, 94, 0.02)); }
  &.kind-Emoji { border-color: rgba(245, 158, 11, 0.5); background: linear-gradient(135deg, rgba(250, 204, 21, 0.08), rgba(245, 158, 11, 0.02)); }
  &.kind-Diary { border-color: rgba(168, 85, 247, 0.5); background: linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(139, 92, 246, 0.02)); }
  &.kind-Agent { border-color: rgba(212, 116, 142, 0.5); background: linear-gradient(135deg, rgba(212, 116, 142, 0.08), rgba(212, 116, 142, 0.02)); }
  &.kind-Sys { border-color: rgba(136, 136, 136, 0.5); }
  .cc-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--button-bg);
    color: #fff;
    border-radius: 50%;
    flex-shrink: 0;
    .material-symbols-outlined { font-size: 20px; }
  }
  .cc-info { flex: 1; min-width: 0; }
  .cc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .cc-label {
    font-size: 11px;
    color: var(--secondary-text);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .cc-name {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 14px;
    font-weight: 700;
    color: var(--button-bg);
    padding: 2px 10px;
    background: var(--input-bg);
    border-radius: 6px;
  }
  .cc-kind-tag {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    color: #fff;
    font-weight: 600;
  }
  &.kind-Tar .cc-kind-tag { background: #6a78d4; }
  &.kind-Var .cc-kind-tag { background: #5cb2a3; }
  &.kind-Sar .cc-kind-tag { background: #e68a4c; }
  &.kind-Timeline .cc-kind-tag { background: #d97757; }
  &.kind-Rag .cc-kind-tag { background: #8b5cf6; }
  &.kind-RagSim .cc-kind-tag { background: #6366f1; }
  &.kind-RagHybrid .cc-kind-tag { background: #d946ef; }
  &.kind-Tool .cc-kind-tag { background: #0ea5e9; }
  &.kind-Toolbox .cc-kind-tag { background: linear-gradient(135deg, #14b8a6, #22c55e); }
  &.kind-Emoji .cc-kind-tag { background: linear-gradient(135deg, #facc15, #f59e0b); }
  &.kind-Diary .cc-kind-tag { background: linear-gradient(135deg, #a855f7, #8b5cf6); }
  &.kind-Agent .cc-kind-tag { background: #d4748e; }
  &.kind-Sys .cc-kind-tag { background: #888; }

  .cc-registry-hint {
    .cc-desc {
      display: flex; align-items: center; gap: 6px;
      .material-symbols-outlined { font-size: 16px; color: #f59e0b; }
    }
    .cc-plugin-key {
      background: rgba(0, 0, 0, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: 'JetBrains Mono', Consolas, monospace;
    }
    .cc-commands {
      margin: 4px 0 0;
      font-size: 11px;
      color: var(--secondary-text);
      font-style: italic;
    }
    .cc-install-btn {
      margin-top: 10px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: linear-gradient(135deg, #f59e0b, #f97316);
      color: #fff;
      border: none;
      border-radius: var(--radius-pill);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3);
      transition: all 0.12s;
      &:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
      &:disabled {
        opacity: 0.75;
        cursor: progress;
        .material-symbols-outlined { animation: spinRot 1s linear infinite; }
      }
      .material-symbols-outlined { font-size: 16px; }
    }
  }

  .cc-desc {
    margin: 0 0 4px;
    font-size: 12.5px;
    color: var(--primary-text);
    line-height: 1.5;
  }
  .cc-preview {
    margin: 0;
    font-size: 11.5px;
    font-family: monospace;
    color: var(--secondary-text);
    background: var(--input-bg);
    padding: 6px 10px;
    border-radius: 4px;
    word-break: break-all;
    max-height: 80px;
    overflow-y: auto;
  }
  .cc-unknown {
    margin: 0;
    font-size: 12px;
    color: var(--highlight-text, #d95555);
  }
  .cc-delete {
    background: transparent;
    border: 1px solid rgba(217, 85, 85, 0.3);
    color: #d95555;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    .material-symbols-outlined { font-size: 16px; }
    &:hover { background: rgba(217, 85, 85, 0.1); }
  }
}

@keyframes spinRot {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.picker-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--secondary-text);
  span {
    padding: 4px 14px;
    background: var(--accent-bg);
    border-radius: var(--radius-pill);
    letter-spacing: 0.5px;
  }
}
.picker-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.picker-search {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 13px;
  outline: none;
  background: var(--input-bg);
  color: var(--primary-text);
  &:focus { border-color: var(--button-bg); }
}
.picker-stat {
  font-size: 11px;
  color: var(--secondary-text);
  font-family: monospace;
}
.cat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}
.cat-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: 11.5px;
  color: var(--secondary-text);
  transition: all 0.12s;
  &:hover { color: var(--primary-text); border-color: var(--button-bg); }
  &.active { color: #fff; background: var(--button-bg); border-color: var(--button-bg); }
  .material-symbols-outlined { font-size: 14px; }
  .cnt {
    margin-left: 4px;
    padding: 0 6px;
    background: rgba(255, 255, 255, 0.25);
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
  }
  &:not(.active) .cnt { background: var(--accent-bg); color: var(--button-bg); }
}
.picker-loading, .picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--secondary-text);
  .material-symbols-outlined { font-size: 32px; opacity: 0.5; }
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding: 4px 2px;
  flex: 1;
}
.ph-card {
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.12s;
  position: relative;
  &:hover {
    border-color: var(--button-bg);
    background: var(--accent-bg);
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(228, 104, 156, 0.12);
  }
  &.is-current {
    border: 2px solid var(--button-bg);
    background: var(--accent-bg);
    box-shadow: 0 0 0 4px rgba(228, 104, 156, 0.15);
    &::before {
      content: '当前';
      position: absolute;
      top: -8px;
      right: 10px;
      padding: 1px 8px;
      background: var(--button-bg);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      border-radius: 8px;
    }
  }
  .ph-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .ph-name {
    flex: 1;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    color: var(--button-bg);
    font-weight: 600;
    word-break: break-all;
  }
  .ph-tag {
    font-size: 10px;
    color: var(--secondary-text);
    background: var(--tertiary-bg);
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .ph-desc, .ph-preview {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--secondary-text);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ph-preview {
    color: var(--primary-text);
    background: var(--tertiary-bg);
    padding: 4px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
  }
}
.spin { animation: pe-spin 1s linear infinite; }
@keyframes pe-spin { to { transform: rotate(360deg); } }
</style>
