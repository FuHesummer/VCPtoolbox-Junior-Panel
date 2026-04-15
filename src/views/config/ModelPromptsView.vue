<template>
  <div class="page model-prompts">
    <PageHeader
      title="模型提示词"
      subtitle="SarModel / SarPrompt · 为不同 AI 模型定制专属系统提示词"
      icon="tune"
    >
      <template #actions>
        <button class="btn btn-ghost" @click="load" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
          刷新
        </button>
        <button class="btn btn-ghost" @click="addNew">
          <span class="material-symbols-outlined">add</span>
          新增
        </button>
        <button class="btn" @click="save(false)" :disabled="saving || !dirty">
          <span class="material-symbols-outlined">{{ saving ? 'hourglass_top' : 'save' }}</span>
          保存
        </button>
        <button class="btn btn-danger" @click="save(true)" :disabled="saving || !dirty" title="保存并重启主服务（新配置立即生效）">
          <span class="material-symbols-outlined">restart_alt</span>
          保存 + 重启
        </button>
      </template>
    </PageHeader>

    <div class="content">
      <details class="help" open>
        <summary>这是什么？怎么用？</summary>
        <div class="help-body">
          <p>
            <strong>SarModel / SarPrompt</strong> 机制：在 Agent 的 system prompt 里写
            <code v-pre>{{SarPromptN}}</code> 占位符，
            运行时若当前模型在 <code>SarModelN</code> 列表内 → 占位符替换为 <code>SarPromptN</code> 内容；
            不匹配 → 替换为空。
          </p>
          <h4>典型用法</h4>
          <ul>
            <li>
              <strong>深度推理模式</strong>：为支持思考链的模型（如 Gemini 2.5）追加推理指令
            </li>
            <li>
              <strong>语音场景</strong>：为 TTS 链路的模型追加"考虑谐音字/错别字"指令
            </li>
            <li>
              <strong>模型专属魔法词</strong>：如 <code>[KING FALL MODE]</code> 等激活某个高级模式
            </li>
          </ul>
          <h4>说明</h4>
          <ul>
            <li>Index（N）必须 ≥ 1，且唯一</li>
            <li>模型 ID 按 Agent 调用时传入的 <code>model</code> 字段匹配（大小写不敏感）</li>
            <li>Prompt 支持 <code>.txt</code> 结尾引用 TVStxt 文件（会读取文件内容替代）</li>
            <li>保存后需<strong>重启主服务</strong>才能生效（点击"保存 + 重启"可一键完成）</li>
            <li>Prompt 内的英文双引号会自动转义为中文引号（避免破坏 config.env 解析）</li>
          </ul>
        </div>
      </details>

      <EmptyState v-if="loading && items.length === 0" icon="hourglass_top" message="加载中..." />

      <div v-else-if="error" class="error-card">
        {{ error }}
      </div>

      <div v-else-if="items.length === 0" class="empty-hint">
        暂无模型专属指令。点击右上角 <strong>新增</strong> 按钮添加第一条。
      </div>

      <article v-for="(item, i) in items" :key="item._uid" class="sar-card">
        <header class="sc-head">
          <div class="sc-idx">
            <label>Index</label>
            <input type="number" v-model.number="item.index" min="1" @input="markDirty" />
            <span class="sc-placeholder-hint">
              占位符 <code>{{ placeholderFor(item.index) }}</code>
            </span>
          </div>
          <div class="sc-actions">
            <button class="icon-btn" @click="duplicate(i)" title="复制一条">
              <span class="material-symbols-outlined">content_copy</span>
            </button>
            <button class="icon-btn danger" @click="remove(i)" title="删除此项">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </header>

        <div class="sc-field">
          <label>模型列表</label>
          <div class="chips">
            <span v-for="(m, mi) in item.models" :key="mi" class="chip">
              {{ m }}
              <button class="chip-x" @click="removeModel(item, mi)" type="button">×</button>
            </span>
          </div>
          <div class="chip-input-row">
            <input
              type="text"
              :value="modelInputs[item._uid] || ''"
              @input="(e) => updateModelInput(item._uid, (e.target as HTMLInputElement).value)"
              @keydown.enter.prevent="commitModels(item)"
              @blur="commitModels(item)"
              placeholder="回车添加，支持逗号批量（例：gemini-2.5-pro,grok-3-beta）"
            />
            <button class="btn btn-small" type="button" @click="commitModels(item)">+</button>
          </div>
        </div>

        <div class="sc-field">
          <label>Prompt 内容</label>
          <textarea
            v-model="item.prompt"
            @input="markDirty"
            rows="5"
            placeholder="匹配上述模型时追加的系统提示词。支持 .txt 引用 TVStxt 文件"
          ></textarea>
          <div class="sc-length">
            <span>{{ item.prompt.length }} 字</span>
            <span v-if="item.prompt.trim().toLowerCase().endsWith('.txt')" class="ref-badge">
              <span class="material-symbols-outlined">description</span>
              引用 TVStxt 文件
            </span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { listSarPrompts, saveSarPrompts, type SarPromptItem } from '@/api/sarPrompts'
import { useUiStore } from '@/stores/ui'

interface EditableItem extends SarPromptItem {
  _uid: string
}

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const items = ref<EditableItem[]>([])
const dirty = ref(false)
const modelInputs = reactive<Record<string, string>>({})

const ui = useUiStore()

let uidCounter = 0
function newUid() { return `sar-${Date.now()}-${++uidCounter}` }

function placeholderFor(idx: number) {
  return `{{SarPrompt${idx || 'N'}}}`
}

function markDirty() {
  dirty.value = true
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const resp = await listSarPrompts()
    if (!resp.success) throw new Error('加载失败')
    items.value = resp.items.map(it => ({ ...it, _uid: newUid() }))
    dirty.value = false
  } catch (e: any) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function addNew() {
  const nextIdx = items.value.length > 0
    ? Math.max(...items.value.map(i => i.index)) + 1
    : 1
  items.value.push({
    index: nextIdx,
    models: [],
    prompt: '',
    _uid: newUid(),
  })
  markDirty()
}

function duplicate(i: number) {
  const src = items.value[i]
  const nextIdx = Math.max(...items.value.map(it => it.index)) + 1
  items.value.splice(i + 1, 0, {
    index: nextIdx,
    models: [...src.models],
    prompt: src.prompt,
    _uid: newUid(),
  })
  markDirty()
}

function remove(i: number) {
  if (!confirm(`确定删除第 ${items.value[i].index} 条？此操作不可撤销（保存前）。`)) return
  items.value.splice(i, 1)
  markDirty()
}

function removeModel(item: EditableItem, mi: number) {
  item.models.splice(mi, 1)
  markDirty()
}

function updateModelInput(uid: string, val: string) {
  modelInputs[uid] = val
}

function commitModels(item: EditableItem) {
  const raw = modelInputs[item._uid] || ''
  const parts = raw.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return
  for (const p of parts) {
    if (!item.models.includes(p)) item.models.push(p)
  }
  modelInputs[item._uid] = ''
  markDirty()
}

function validate(): string | null {
  const seen = new Set<number>()
  for (const it of items.value) {
    if (!Number.isFinite(it.index) || it.index < 1) {
      return `Index 必须是 ≥ 1 的整数（有非法值）`
    }
    if (seen.has(it.index)) {
      return `Index ${it.index} 重复`
    }
    seen.add(it.index)
    if (it.models.length === 0) {
      return `Index ${it.index} 的模型列表为空`
    }
    if (!it.prompt.trim()) {
      return `Index ${it.index} 的 Prompt 为空`
    }
  }
  return null
}

async function save(withRestart: boolean) {
  const err = validate()
  if (err) {
    ui.showMessage(err, 'error')
    return
  }
  if (withRestart && !confirm('保存后将立即重启主服务，当前任何进行中的请求会断开。确定继续？')) {
    return
  }
  saving.value = true
  try {
    const payload: SarPromptItem[] = items.value.map(it => ({
      index: it.index,
      models: it.models,
      prompt: it.prompt,
    }))
    const resp = await saveSarPrompts(payload, withRestart)
    if (!resp.success) throw new Error('保存失败')
    ui.showMessage(resp.message || '已保存', 'success')
    dirty.value = false
    if (!withRestart) {
      await load()
    }
  } catch (e: any) {
    ui.showMessage('保存失败：' + (e.message || e), 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style lang="scss" scoped>
.model-prompts {
  .content {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
}

.help {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--button-bg, #6366f1);
  border-radius: 10px;
  padding: 14px 18px;
  font-size: 0.85rem;
  line-height: 1.7;

  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--button-bg, #6366f1);
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;

    &::-webkit-details-marker { display: none; }
    &::before {
      content: '▶';
      font-size: 0.7em;
      transition: transform 0.2s;
    }
  }

  &[open] summary::before { transform: rotate(90deg); }

  .help-body { margin-top: 8px; }
  p { margin: 8px 0; }
  h4 { margin: 12px 0 6px; font-size: 0.9rem; color: var(--primary-text); }
  code {
    background: var(--background-color);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.88em;
  }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 3px 0; }
}

.error-card {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #b91c1c;
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 0.88rem;
}

.empty-hint {
  background: var(--card-bg);
  border: 1px dashed var(--border-color);
  color: var(--secondary-text);
  padding: 20px;
  border-radius: 10px;
  text-align: center;
  font-size: 0.9rem;
}

.sar-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  }
}

.sc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px dashed var(--border-color);
  padding-bottom: 10px;
  gap: 10px;
  flex-wrap: wrap;

  .sc-idx {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;

    label {
      font-size: 0.82rem;
      color: var(--secondary-text);
      font-weight: 500;
    }

    input[type="number"] {
      width: 70px;
      padding: 6px 8px;
      background: var(--background-color);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--primary-text);
      font-size: 0.9rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .sc-placeholder-hint {
      font-size: 0.78rem;
      color: var(--secondary-text);

      code {
        background: var(--background-color);
        padding: 2px 8px;
        border-radius: 4px;
        font-family: 'JetBrains Mono', monospace;
        color: var(--button-bg, #6366f1);
        font-weight: 500;
      }
    }
  }

  .sc-actions {
    display: flex;
    gap: 4px;

    .icon-btn {
      background: transparent;
      border: none;
      padding: 5px;
      border-radius: 5px;
      cursor: pointer;
      color: var(--secondary-text);
      transition: all 0.15s;
      display: flex;
      align-items: center;

      &:hover {
        background: var(--border-color);
        color: var(--primary-text);
      }

      &.danger:hover {
        background: rgba(239, 68, 68, 0.12);
        color: #ef4444;
      }
    }
  }
}

.sc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  > label {
    font-size: 0.82rem;
    color: var(--secondary-text);
    font-weight: 500;
  }

  textarea {
    padding: 10px 12px;
    background: var(--background-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--primary-text);
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    font-size: 0.84rem;
    line-height: 1.6;
    resize: vertical;
    min-height: 100px;

    &:focus {
      outline: none;
      border-color: var(--button-bg, #6366f1);
    }
  }
}

.sc-length {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.72rem;
  color: var(--secondary-text);
  opacity: 0.8;

  .ref-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    background: rgba(99, 102, 241, 0.1);
    color: var(--button-bg, #6366f1);
    border-radius: 10px;
    font-weight: 500;

    .material-symbols-outlined { font-size: 0.95em; }
  }
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 8px;
  background: var(--background-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  min-height: 38px;
  align-items: center;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 10px;
  background: rgba(99, 102, 241, 0.12);
  color: var(--button-bg, #6366f1);
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 500;
  font-family: 'JetBrains Mono', monospace;
}

.chip-x {
  background: transparent;
  border: none;
  color: currentColor;
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.6;

  &:hover { opacity: 1; }
}

.chip-input-row {
  display: flex;
  gap: 8px;
  align-items: center;

  input[type="text"] {
    flex: 1;
    padding: 7px 10px;
    background: var(--background-color);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    color: var(--primary-text);
    font-size: 0.84rem;
    font-family: 'JetBrains Mono', monospace;

    &:focus {
      outline: none;
      border-color: var(--button-bg, #6366f1);
    }
  }
}
</style>
