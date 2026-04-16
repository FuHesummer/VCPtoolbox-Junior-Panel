<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { RagPlaceholder, MetaPlaceholder } from '@/utils/ragParser'
import { parseRagRaw, serializeRag, serializeMeta } from '@/utils/ragParser'

type EditorFormat = 'rag' | 'rag_sim' | 'rag_hybrid'

const props = defineProps<{
  modelValue: boolean       // v-model:visible
  initialType: EditorFormat // 入口 format：rag（[[]]）/ rag_sim（<<>>）/ rag_hybrid（《《》》）
  initialRaw: string        // 原始字符串（不含两侧符号）
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: { format: EditorFormat; raw: string }): void
  (e: 'delete'): void
}>()

// ============ 状态 ============
// editor UI 的四个 tab：rag / rag_sim / rag_hybrid / meta
// - rag / rag_sim / rag_hybrid 共用 ragState（结构相同，只是序列化符号不同）
// - meta 独立 metaState
const currentType = ref<'rag' | 'rag_sim' | 'rag_hybrid' | 'meta'>('rag')
const ragState = ref<RagPlaceholder>({
  type: 'rag', name: '', time: false, group: false, rerank: false,
  tagMemo: { enabled: false, weight: null, geodesic: false },
})
const metaState = ref<MetaPlaceholder>({
  type: 'meta', chain: 'default', group: false, auto: false, autoThreshold: null,
})

// TagMemo weight 模式（radio）
const tagMemoMode = ref<'dynamic' | 'fixed'>('dynamic')

// 可选来源
const thinkingChains = ref<string[]>(['default'])

// 日记本分组（照 agent 管理 / 日记管理）
interface DiaryGroup { label: string; items: { name: string; hint?: string }[] }
const diaryGroups = ref<DiaryGroup[]>([])
const suggestedDiaryNames = computed<string[]>(() => {
  const names = new Set<string>()
  for (const g of diaryGroups.value) for (const it of g.items) names.add(it.name)
  return [...names]
})

// 原始模式（高级）
const showRawMode = ref(false)
const rawText = ref('')

// ============ 初始化 ============
function initFromProps() {
  // 三种 RAG 格式共用同一个 parser（name + 修饰符结构相同）
  const parsed = parseRagRaw(props.initialRaw)
  if (parsed.type === 'meta') {
    currentType.value = 'meta'
    metaState.value = parsed
  } else {
    // 保留入口格式（rag / rag_sim / rag_hybrid）
    currentType.value = props.initialType
    ragState.value = parsed
    tagMemoMode.value = parsed.tagMemo.weight !== null ? 'fixed' : 'dynamic'
  }
  rawText.value = props.initialRaw
}

watch(() => props.modelValue, v => { if (v) initFromProps() })
onMounted(() => {
  if (props.modelValue) initFromProps()
  loadThinkingChains()
  loadSuggestedDiaries()
})

// ============ API 加载 ============
async function loadThinkingChains() {
  try {
    const res = await fetch('/admin_api/thinking-chains', { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    const chains = data?.chains && typeof data.chains === 'object' ? Object.keys(data.chains) : []
    if (chains.length) thinkingChains.value = chains
  } catch (_) { /* 静默 */ }
}

async function loadSuggestedDiaries() {
  // 从 agent 管理 / 日记管理共用的端点取日记本清单
  // 后端 /admin_api/dailynotes/folders 返回 { agents, public, thinking }
  try {
    const res = await fetch('/admin_api/dailynotes/folders', { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    const groups: DiaryGroup[] = []

    // 1. Agent 个人日记本（{Agent}日记本）+ 知识本（{Agent}的知识日记本）
    const agentItems: { name: string; hint?: string }[] = []
    for (const ag of (data.agents || [])) {
      for (const nb of (ag.notebooks || [])) {
        // RAGDiaryPlugin 约定：diary → `{Name}日记本`，knowledge → `{Name}的知识日记本`
        if (nb.type === 'diary') {
          agentItems.push({ name: `${ag.name}日记本`, hint: `Agent ${ag.name} · 日记` })
        } else if (nb.type === 'knowledge') {
          agentItems.push({ name: `${ag.name}的知识日记本`, hint: `Agent ${ag.name} · 知识` })
        }
      }
    }
    if (agentItems.length) groups.push({ label: '🧑 Agent 日记 / 知识', items: agentItems })

    // 2. 公共日记本（knowledge/ 下的公共目录）
    const publicItems: { name: string; hint?: string }[] = []
    for (const p of (data.public || [])) {
      publicItems.push({ name: p, hint: '公共知识库' })
    }
    if (publicItems.length) groups.push({ label: '📚 公共知识库', items: publicItems })

    // 3. 思维簇（thinking/ 下以"簇"结尾的目录）
    const thinkingItems: { name: string; hint?: string }[] = []
    for (const t of (data.thinking || [])) {
      const nm = t.displayName || t.folderName
      if (nm) thinkingItems.push({ name: nm.split('/').pop() || nm, hint: '思维簇' })
    }
    if (thinkingItems.length) groups.push({ label: '🧠 思维簇', items: thinkingItems })

    diaryGroups.value = groups
  } catch (_) { /* 静默失败：用户可自由输入 */ }
}

// 三种 RAG 格式的左右符号
const BRACKETS: Record<'rag' | 'rag_sim' | 'rag_hybrid' | 'meta', [string, string]> = {
  rag: ['[[', ']]'],
  rag_sim: ['<<', '>>'],
  rag_hybrid: ['《《', '》》'],
  meta: ['[[', ']]'],
}

// ============ 预览（实时序列化） ============
const previewText = computed(() => {
  const [L, R] = BRACKETS[currentType.value]
  if (showRawMode.value) return `${L}${rawText.value}${R}`
  if (currentType.value === 'meta') return `${L}${serializeMeta(metaState.value)}${R}`
  return `${L}${serializeRag(ragState.value)}${R}`
})

// ============ 交互 ============
function close() { emit('update:modelValue', false) }

function save() {
  let raw = ''
  // 元思考始终保存为 rag 格式（[[...]]）
  let finalFormat: EditorFormat = currentType.value === 'meta' ? 'rag' : currentType.value

  if (showRawMode.value) {
    raw = rawText.value.trim()
  } else if (currentType.value === 'meta') {
    raw = serializeMeta(metaState.value)
  } else {
    if (!ragState.value.name.trim()) { alert('请填写日记本名称'); return }
    if (tagMemoMode.value === 'dynamic') ragState.value.tagMemo.weight = null
    raw = serializeRag(ragState.value)
  }
  emit('save', { format: finalFormat, raw })
  close()
}

function removeChip() {
  if (confirm('确定删除此占位符？')) {
    emit('delete')
    close()
  }
}

// 切换类型时同步结构（避免数据串台）
function onTypeChange() {
  // 三种 RAG 共用 ragState，互相切换不丢数据
  // meta 独立，但保留名字到 ragState
  if (currentType.value === 'meta' && !metaState.value.chain) metaState.value.chain = 'default'
}

// TagMemo weight 输入
const tagMemoWeightInput = computed({
  get: () => ragState.value.tagMemo.weight ?? 0.65,
  set: (v: number) => { ragState.value.tagMemo.weight = isNaN(v) ? 0.65 : v },
})
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="rag-editor-backdrop" @click.self="close">
      <div class="rag-editor">
        <header class="rag-editor-head">
          <h3>
            <span class="material-symbols-outlined">edit_note</span>
            占位符编辑器
          </h3>
          <div class="rag-editor-head-actions">
            <button class="btn-toggle" :class="{ active: showRawMode }" @click="showRawMode = !showRawMode" title="切换到原始字符串编辑">
              <span class="material-symbols-outlined">code</span>
              {{ showRawMode ? '结构化' : '原始' }}
            </button>
            <button class="btn-close" @click="close">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </header>

        <section class="rag-editor-body">
          <!-- ========== 类型切换 ========== -->
          <div class="field">
            <label>检索类型</label>
            <div class="type-tabs four">
              <button class="type-tab" :class="{ active: currentType === 'rag' }" @click="currentType = 'rag'; onTypeChange()">
                <span class="material-symbols-outlined">search</span>
                <span class="tt-label">无条件</span>
                <code class="tt-sym">[[ ]]</code>
              </button>
              <button class="type-tab" :class="{ active: currentType === 'rag_sim' }" @click="currentType = 'rag_sim'; onTypeChange()">
                <span class="material-symbols-outlined">compare</span>
                <span class="tt-label">相似度</span>
                <code class="tt-sym">&lt;&lt; &gt;&gt;</code>
              </button>
              <button class="type-tab" :class="{ active: currentType === 'rag_hybrid' }" @click="currentType = 'rag_hybrid'; onTypeChange()">
                <span class="material-symbols-outlined">blur_on</span>
                <span class="tt-label">混合阈值</span>
                <code class="tt-sym">《《 》》</code>
              </button>
              <button class="type-tab" :class="{ active: currentType === 'meta' }" @click="currentType = 'meta'; onTypeChange()">
                <span class="material-symbols-outlined">psychology</span>
                <span class="tt-label">元思考</span>
                <code class="tt-sym">[[VCP元思考]]</code>
              </button>
            </div>
            <p class="hint type-hint" v-if="currentType === 'rag'">每次请求都无条件触发检索</p>
            <p class="hint type-hint" v-else-if="currentType === 'rag_sim'">按 rag_tags.json 的相似度阈值决定是否触发</p>
            <p class="hint type-hint" v-else-if="currentType === 'rag_hybrid'">混合阈值 + 聚合检索（V8 新模式）</p>
          </div>

          <!-- ========== 原始模式 ========== -->
          <div v-if="showRawMode" class="field">
            <label>原始字符串（高级）</label>
            <textarea v-model="rawText" class="input-raw" placeholder="直接编辑原文" rows="3" />
            <p class="hint">
              高级模式：直接编辑占位符内容（不含两侧 <code>[[ ]]</code> 或 <code>&lt;&lt; &gt;&gt;</code>）。保存后按当前类型重新加两侧符号。
            </p>
          </div>

          <!-- ========== RAG 三种格式（rag / rag_sim / rag_hybrid）共用 ========== -->
          <template v-else-if="currentType === 'rag' || currentType === 'rag_sim' || currentType === 'rag_hybrid'">
            <div class="field">
              <label>日记本名称</label>
              <input
                v-model="ragState.name"
                class="input"
                list="diary-names"
                placeholder="点下方快速选择 或 手动输入"
              />
              <datalist id="diary-names">
                <option v-for="n in suggestedDiaryNames" :key="n" :value="n" />
              </datalist>
              <div v-if="diaryGroups.length" class="quick-picker">
                <div v-for="g in diaryGroups" :key="g.label" class="qp-group">
                  <div class="qp-label">{{ g.label }}</div>
                  <div class="qp-chips">
                    <button
                      v-for="it in g.items"
                      :key="it.name"
                      class="qp-chip"
                      :class="{ active: ragState.name === it.name }"
                      :title="it.hint"
                      @click="ragState.name = it.name"
                    >{{ it.name }}</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="field">
              <label>基础修饰符</label>
              <div class="mods">
                <label class="mod-item">
                  <input type="checkbox" v-model="ragState.time" />
                  <span class="mod-name">Time</span>
                  <span class="mod-desc">时间衰减（按上下文的时间表达式排序）</span>
                </label>
                <label class="mod-item">
                  <input type="checkbox" v-model="ragState.group" />
                  <span class="mod-name">Group</span>
                  <span class="mod-desc">语义分组（命中时整组展开）</span>
                </label>
                <label class="mod-item">
                  <input type="checkbox" v-model="ragState.rerank" />
                  <span class="mod-name">Rerank</span>
                  <span class="mod-desc">RRF 倒数秩融合精排</span>
                </label>
              </div>
            </div>

            <div class="field">
              <label>
                <input type="checkbox" v-model="ragState.tagMemo.enabled" style="margin-right: 6px;" />
                TagMemo（V8 标签路径记忆）
              </label>
              <div v-if="ragState.tagMemo.enabled" class="tagmemo-sub">
                <div class="radio-row">
                  <label>
                    <input type="radio" v-model="tagMemoMode" value="dynamic" />
                    动态权重（无数字）
                  </label>
                  <label>
                    <input type="radio" v-model="tagMemoMode" value="fixed" />
                    固定权重
                  </label>
                  <input
                    v-if="tagMemoMode === 'fixed'"
                    type="number" step="0.05" min="0" max="1"
                    v-model.number="tagMemoWeightInput"
                    class="input-weight"
                  />
                </div>
                <label class="mod-item" style="margin-top: 8px;">
                  <input type="checkbox" v-model="ragState.tagMemo.geodesic" />
                  <span class="mod-name">+ 测地线重排</span>
                  <span class="mod-desc">V8 测地线动态权重（用 <code>TagMemo+</code> 表示）</span>
                </label>
              </div>
            </div>
          </template>

          <!-- ========== RAG 相似度 <<>> 和 混合阈值 《《》》：共用 rag 模板（内部已在上面 rag 分支） ========== -->

          <!-- ========== VCP 元思考 ========== -->

          <template v-else-if="currentType === 'meta'">
            <div class="field">
              <label>思考链</label>
              <select v-model="metaState.chain" class="input">
                <option v-for="c in thinkingChains" :key="c" :value="c">{{ c }}</option>
              </select>
              <p class="hint">
                来自「思维链编辑」页面。如需新增链，请先去
                <a href="/AdminPanel/thinking-chains" target="_blank">思维链编辑</a> 添加。
              </p>
            </div>

            <div class="field">
              <label>修饰符</label>
              <div class="mods">
                <label class="mod-item">
                  <input type="checkbox" v-model="metaState.auto" />
                  <span class="mod-name">Auto</span>
                  <span class="mod-desc">自动模式（插件按阈值自动切链）</span>
                </label>
                <div v-if="metaState.auto" class="auto-threshold">
                  <label>Auto 阈值:</label>
                  <input
                    type="number" step="0.05" min="0" max="1"
                    :value="metaState.autoThreshold ?? ''"
                    @input="(e) => { const v = parseFloat((e.target as HTMLInputElement).value); metaState.autoThreshold = isNaN(v) ? null : v }"
                    class="input-weight"
                    placeholder="默认 0.65"
                  />
                  <span class="hint">留空=默认 0.65</span>
                </div>
                <label class="mod-item">
                  <input type="checkbox" v-model="metaState.group" />
                  <span class="mod-name">Group</span>
                  <span class="mod-desc">语义分组</span>
                </label>
              </div>
            </div>
          </template>

          <!-- ========== 预览 ========== -->
          <div class="field preview-field">
            <label>预览</label>
            <code class="preview">{{ previewText }}</code>
          </div>
        </section>

        <footer class="rag-editor-foot">
          <button class="btn btn-ghost btn-danger" @click="removeChip">
            <span class="material-symbols-outlined">delete</span>
            删除
          </button>
          <div style="flex:1"></div>
          <button class="btn btn-ghost" @click="close">取消</button>
          <button class="btn btn-primary" @click="save">
            <span class="material-symbols-outlined">save</span>
            保存
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.rag-editor-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; backdrop-filter: blur(3px);
}
.rag-editor {
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 12px; width: min(620px, 92vw); max-height: 88vh;
  display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.rag-editor-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; border-bottom: 1px solid var(--border-color);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(139, 92, 246, 0.03));
  h3 { margin: 0; font-size: 1rem; color: var(--primary-text); display: flex; gap: 8px; align-items: center; font-weight: 600;
    .material-symbols-outlined { font-size: 20px; color: #8b5cf6; }
  }
  .rag-editor-head-actions { display: flex; gap: 6px; }
  .btn-toggle {
    padding: 5px 10px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 6px; color: var(--secondary-text); cursor: pointer;
    display: inline-flex; gap: 4px; align-items: center; font-size: 0.78rem;
    .material-symbols-outlined { font-size: 15px; }
    &:hover { background: var(--accent-bg); }
    &.active { background: rgba(139, 92, 246, 0.12); color: #8b5cf6; border-color: #8b5cf6; }
  }
  .btn-close {
    width: 28px; height: 28px; padding: 0; background: transparent; border: none;
    border-radius: 6px; cursor: pointer; color: var(--secondary-text);
    display: inline-flex; align-items: center; justify-content: center;
    .material-symbols-outlined { font-size: 20px; }
    &:hover { background: var(--accent-bg); color: var(--primary-text); }
  }
}
.rag-editor-body {
  padding: 16px 18px; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 16px;
}
.field {
  display: flex; flex-direction: column; gap: 6px;
  > label { font-size: 0.82rem; color: var(--secondary-text); font-weight: 600; display: flex; align-items: center; }
  .hint { font-size: 0.72rem; color: var(--secondary-text); margin: 0; opacity: 0.85; line-height: 1.5; }
  .hint code { background: var(--background-color); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 0.88em; }
}
.input, .input-raw {
  padding: 7px 10px; background: var(--background-color); border: 1px solid var(--border-color);
  border-radius: 6px; color: var(--primary-text); font-size: 0.85rem; font-family: inherit;
  &:focus { outline: none; border-color: #8b5cf6; }
}
.input-raw { font-family: 'JetBrains Mono', monospace; resize: vertical; }
.input-weight { width: 80px; padding: 5px 8px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 5px; color: var(--primary-text); font-size: 0.82rem; font-family: inherit; }

.type-tabs {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
}
.type-tab {
  padding: 10px 8px; background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-family: inherit;
  color: var(--secondary-text); display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: all 0.15s;
  .material-symbols-outlined { font-size: 20px; }
  &:hover { border-color: #8b5cf6; }
  &.active { background: rgba(139, 92, 246, 0.1); border-color: #8b5cf6; color: #8b5cf6; font-weight: 600; }
}

.quick-picker {
  margin-top: 6px; padding: 10px; background: var(--background-color);
  border: 1px solid var(--border-color); border-radius: 8px;
  display: flex; flex-direction: column; gap: 10px; max-height: 200px; overflow-y: auto;
}
.qp-group { display: flex; flex-direction: column; gap: 5px; }
.qp-label { font-size: 0.72rem; color: var(--secondary-text); font-weight: 600; letter-spacing: 0.3px; }
.qp-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.qp-chip {
  padding: 4px 9px; background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 14px; color: var(--primary-text); cursor: pointer; font-size: 0.76rem;
  font-family: inherit; transition: all 0.12s;
  &:hover { background: rgba(139, 92, 246, 0.08); border-color: #8b5cf6; color: #8b5cf6; transform: translateY(-1px); }
  &.active { background: #8b5cf6; border-color: #8b5cf6; color: #fff; font-weight: 500; }
}

.mods { display: flex; flex-direction: column; gap: 6px; }
.mod-item {
  display: grid; grid-template-columns: 20px auto 1fr; gap: 6px; align-items: center;
  padding: 6px 10px; background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 6px; cursor: pointer; font-size: 0.82rem;
  &:hover { border-color: #8b5cf6; }
  .mod-name { color: var(--primary-text); font-weight: 500; }
  .mod-desc { color: var(--secondary-text); font-size: 0.74rem; }
  code { background: var(--background-color); padding: 0 4px; border-radius: 3px; font-family: monospace; font-size: 0.85em; }
}

.tagmemo-sub {
  margin-top: 8px; padding: 10px 12px; background: rgba(139, 92, 246, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 8px;
  display: flex; flex-direction: column; gap: 6px;
  .radio-row { display: flex; gap: 14px; align-items: center; font-size: 0.82rem;
    label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
  }
}

.auto-threshold {
  display: flex; gap: 8px; align-items: center; padding: 6px 10px;
  background: rgba(99, 102, 241, 0.04); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px;
  margin-left: 24px; font-size: 0.78rem;
  label { color: var(--secondary-text); font-weight: 500; }
  .hint { color: var(--secondary-text); font-size: 0.72rem; opacity: 0.85; }
}

.preview-field { margin-top: 4px; }
.preview {
  display: block; padding: 10px 14px; background: var(--background-color);
  border: 1px solid var(--border-color); border-radius: 6px; color: #6d3fc5;
  font-family: 'JetBrains Mono', monospace; font-size: 0.82rem;
  word-break: break-all; white-space: pre-wrap;
}

.rag-editor-foot {
  display: flex; gap: 8px; align-items: center;
  padding: 12px 18px; border-top: 1px solid var(--border-color); background: var(--background-color);
}
.btn {
  padding: 7px 14px; border-radius: 6px; font-size: 0.83rem; font-weight: 500;
  cursor: pointer; display: inline-flex; gap: 4px; align-items: center; font-family: inherit;
  transition: all 0.15s;
  .material-symbols-outlined { font-size: 17px; }
  &:hover { transform: translateY(-1px); filter: brightness(1.08); }
  &:disabled { opacity: 0.5; cursor: not-allowed; transform: none; filter: none; }
}
.btn-primary { background: #8b5cf6; border: 1px solid #8b5cf6; color: #fff; }
.btn-ghost { background: transparent; border: 1px solid var(--border-color); color: var(--primary-text); }
.btn-ghost:hover { background: var(--accent-bg); }
.btn-danger { color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
.btn-danger:hover { background: rgba(239, 68, 68, 0.08); border-color: #ef4444; }
</style>
