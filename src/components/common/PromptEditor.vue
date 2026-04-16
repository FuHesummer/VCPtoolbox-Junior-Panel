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
import { getPlaceholders, type PlaceholderItem, type PlaceholderType } from '@/api/config'

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
type VarKind = 'Tar' | 'Var' | 'Sar' | 'Agent' | 'Sys'

function classify(name: string): VarKind {
  if (name.startsWith('Tar')) return 'Tar'
  if (name.startsWith('Var')) return 'Var'
  if (name.startsWith('Sar')) return 'Sar'
  if (name.startsWith('Agent') || /^(Maid|User)/.test(name)) return 'Agent'
  return 'Sys'
}

const KIND_LABEL: Record<VarKind, string> = {
  Tar: '系统级', Var: '通用', Sar: '模型条件', Agent: 'Agent', Sys: '内置',
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

function getVarTooltip(name: string): string {
  const p = placeholderMap.value.get(name)
  if (!p) return `${name}（${KIND_LABEL[classify(name)]}变量） — 点击替换 / 拖拽移动`
  const desc = p.description ? `\n${p.description}` : ''
  const preview = p.preview ? `\n→ ${p.preview.slice(0, 100)}${p.preview.length > 100 ? '...' : ''}` : ''
  return `${p.name}${desc}${preview}\n\n点击替换 / 拖拽移动 / Delete 删除`
}

// ============ 文本 ↔ HTML 转换 ============
function makeChipHtml(name: string): string {
  const k = classify(name)
  const tooltip = getVarTooltip(name)
  return `<span class="var-chip kind-${k}" contenteditable="false" draggable="true" data-var="${escapeHtml(name)}" title="${escapeHtml(tooltip)}">${escapeHtml(name)}</span>`
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
      const re = /\{\{([A-Za-z_][\w]*)\}\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        out += escapeHtml(line.substring(lastIdx, m.index))
        out += makeChipHtml(m[1])
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
        const name = el.dataset.var || el.textContent || ''
        out += `{{${name}}}`
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
    if (/\{\{[A-Za-z_][\w]*\}\}/.test(html)) {
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

function onEditorClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('var-chip')) {
    e.preventDefault()
    editingChipEl.value = target
    editingChipName.value = target.dataset.var || target.textContent || ''
    openPicker(true)
  }
}

// 当前点击 chip 对应的占位符元数据
const currentChipPlaceholder = computed(() => {
  if (!editingChipName.value) return null
  return placeholderMap.value.get(editingChipName.value) || null
})
const currentChipKind = computed(() => editingChipName.value ? classify(editingChipName.value) : 'Sys')

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
})

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
            <div v-if="currentChipPlaceholder">
              <p v-if="currentChipPlaceholder.description" class="cc-desc">{{ currentChipPlaceholder.description }}</p>
              <p v-if="currentChipPlaceholder.preview" class="cc-preview">→ {{ currentChipPlaceholder.preview }}</p>
            </div>
            <p v-else class="cc-unknown">⚠️ 此变量未在系统占位符列表中识别（可能拼写错误或来自未启用插件）</p>
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
  &.kind-Agent { background: rgba(212, 116, 142, 0.18); color: #b25a76; border: 1px solid rgba(212, 116, 142, 0.4); }
  &.kind-Sys { background: rgba(136, 136, 136, 0.18); color: #555; border: 1px solid rgba(136, 136, 136, 0.4); }
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
  &.kind-Agent .cc-kind-tag { background: #d4748e; }
  &.kind-Sys .cc-kind-tag { background: #888; }
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
