<template>
  <div class="model-select-field" :class="{ dirty }" ref="fieldRef">
    <div v-if="label" class="model-header">
      <span class="model-label">{{ label }}</span>
      <code v-if="envKey" class="model-key">{{ envKey }}</code>
    </div>
    <p v-if="description" class="model-desc">{{ description }}</p>

    <div class="model-input-row">
      <input
        type="text"
        class="model-text-input"
        :value="modelValue"
        :placeholder="placeholder ?? ''"
        :disabled="disabled"
        @input="onInput"
      />
      <button
        type="button"
        class="pick-btn"
        :class="{ active: popoverOpen }"
        :disabled="disabled"
        @click="togglePopover"
        title="选择模型"
      >
        <span class="material-symbols-outlined">list</span>
        <span class="pick-btn-text">选择</span>
      </button>
    </div>

    <span v-if="error && !popoverOpen" class="model-error">{{ error }}</span>
  </div>

  <!-- Glass popover (Teleport to body for centered positioning) -->
  <Teleport to="body">
    <Transition name="popover-backdrop">
      <div v-if="popoverOpen" class="model-popover-backdrop" @click.self="closePopover">
        <Transition name="popover">
          <div v-if="popoverOpen" class="model-popover" ref="popoverRef">
            <div class="popover-header">
              <span class="material-symbols-outlined">smart_toy</span>
              <span>选择模型</span>
          <button
            type="button"
            class="header-btn refresh-btn"
            :class="{ spinning: loading }"
            :disabled="loading"
            @click.stop="fetchModels"
            title="刷新模型列表"
          >
            <span class="material-symbols-outlined">refresh</span>
          </button>
          <button type="button" class="header-btn popover-close" @click="closePopover">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="popover-search">
          <span class="material-symbols-outlined">search</span>
          <input
            ref="searchInputRef"
            type="text"
            v-model="searchQuery"
            placeholder="搜索模型..."
            @keydown.escape="closePopover"
          />
        </div>

        <div v-if="loading" class="popover-state">
          <span class="material-symbols-outlined spin-icon">progress_activity</span>
          <span>正在加载模型...</span>
        </div>

        <div v-else-if="error" class="popover-state error">
          <span class="material-symbols-outlined">error</span>
          <span>{{ error }}</span>
        </div>

        <div v-else-if="filteredCategories.length === 0" class="popover-state">
          <span class="material-symbols-outlined">search_off</span>
          <span>{{ searchQuery ? '没有匹配的模型' : '上游 API 未返回模型' }}</span>
        </div>

        <div v-else class="popover-body">
          <div
            v-for="cat in filteredCategories"
            :key="cat.name"
            class="category-group"
          >
            <button
              type="button"
              class="category-header"
              @click="toggleCategory(cat.name)"
            >
              <span class="material-symbols-outlined caret">
                {{ collapsedCategories.has(cat.name) ? 'chevron_right' : 'expand_more' }}
              </span>
              <span class="category-name">{{ cat.name }}</span>
              <span class="category-count">{{ cat.models.length }}</span>
            </button>
            <div v-if="!collapsedCategories.has(cat.name)" class="category-chips">
              <button
                v-for="m in cat.models"
                :key="m"
                type="button"
                class="model-chip"
                :class="{ active: m === modelValue }"
                @click="selectModel(m)"
              >
                <span class="model-chip-name">{{ m }}</span>
                <span v-if="m === modelValue" class="material-symbols-outlined chip-check">check_circle</span>
              </button>
            </div>
          </div>
        </div>

            <div class="popover-footer">
              <span class="count-text">{{ totalFilteredCount }} / {{ models.length }} 个模型</span>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

defineProps<{
  modelValue: string
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean
  envKey?: string
  dirty?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const models = ref<string[]>([])
const loading = ref(false)
const error = ref('')
const popoverOpen = ref(false)
const searchQuery = ref('')
const collapsedCategories = ref(new Set<string>())

const fieldRef = ref<HTMLElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

const KNOWN_PREFIXES = [
  'gemini', 'gpt', 'claude', 'deepseek', 'qwen', 'glm',
  'hunyuan', 'doubao', 'ernie', 'spark', 'moonshot', 'yi',
  'llama', 'mistral', 'phi', 'command', 'o1', 'o3', 'o4',
  'text', 'dall', 'whisper', 'tts', 'chatgpt', 'grok',
  'baai', 'bge', 'jina', 'cohere',
]

function categorizeModel(name: string): string {
  const lower = name.toLowerCase()
  for (const prefix of KNOWN_PREFIXES) {
    if (lower.startsWith(prefix)) return prefix
  }
  const seg = lower.split(/[-/]/)[0]
  if (seg && KNOWN_PREFIXES.includes(seg)) return seg
  return '其他'
}

interface Category {
  name: string
  models: string[]
}

const filteredCategories = computed<Category[]>(() => {
  const q = searchQuery.value.toLowerCase().trim()
  const list = q
    ? models.value.filter(m => m.toLowerCase().includes(q))
    : models.value

  const map = new Map<string, string[]>()
  for (const m of list) {
    const cat = categorizeModel(m)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(m)
  }

  const result: Category[] = []
  for (const prefix of KNOWN_PREFIXES) {
    const items = map.get(prefix)
    if (items) {
      result.push({ name: prefix, models: items })
      map.delete(prefix)
    }
  }
  for (const [name, items] of map) {
    if (name !== '其他') result.push({ name, models: items })
  }
  const other = map.get('其他')
  if (other) result.push({ name: '其他', models: other })

  return result
})

const totalFilteredCount = computed(() =>
  filteredCategories.value.reduce((n, c) => n + c.models.length, 0)
)

async function fetchModels() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/admin_api/config/models', { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    models.value = data.models ?? []
    if (data.error) error.value = data.error
  } catch (e: any) {
    error.value = e.message || '获取模型列表失败'
    models.value = []
  } finally {
    loading.value = false
  }
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function selectModel(m: string) {
  emit('update:modelValue', m)
  closePopover()
}

function togglePopover() {
  if (popoverOpen.value) closePopover()
  else openPopover()
}

function openPopover() {
  popoverOpen.value = true
  searchQuery.value = ''
  if (models.value.length === 0 && !loading.value) {
    fetchModels()
  }
  nextTick(() => searchInputRef.value?.focus())
}

function closePopover() {
  popoverOpen.value = false
  searchQuery.value = ''
}

function toggleCategory(name: string) {
  const s = new Set(collapsedCategories.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  collapsedCategories.value = s
}

function onClickOutside(e: MouseEvent) {
  if (!popoverOpen.value) return
  if (fieldRef.value && !fieldRef.value.contains(e.target as Node)) {
    closePopover()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && popoverOpen.value) closePopover()
}

onMounted(() => {
  fetchModels()
  document.addEventListener('mousedown', onClickOutside)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style lang="scss" scoped>
.model-select-field {
  position: relative;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.6);
    border-color: rgba(212, 116, 142, 0.2);
  }

  &.dirty {
    border-left: 3px solid var(--highlight-text);
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.06), rgba(255, 255, 255, 0.5));
  }
}

.model-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.model-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);
  letter-spacing: 0.2px;
}

.model-key {
  font-size: 10px;
  color: var(--secondary-text);
  background: var(--accent-bg);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 500;
}

.model-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;
}

.model-input-row {
  display: flex;
  align-items: center;
  gap: 8px;

  .model-text-input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--primary-text);
    font-size: 13px;
    transition: all 0.2s;

    &:focus {
      outline: none;
      border-color: rgba(212, 116, 142, 0.45);
      box-shadow: 0 0 0 3px rgba(212, 116, 142, 0.1);
      background: rgba(255, 255, 255, 0.75);
    }
  }
}

.pick-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--secondary-text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.85);
    border-color: rgba(212, 116, 142, 0.35);
    color: var(--highlight-text);
  }

  &.active {
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.14), rgba(212, 116, 142, 0.04));
    border-color: rgba(212, 116, 142, 0.45);
    color: var(--highlight-text);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .material-symbols-outlined { font-size: 16px; }
}

.model-error {
  display: block;
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--danger-color, #d95555);
  background: rgba(217, 85, 85, 0.06);
  border-left: 2px solid rgba(217, 85, 85, 0.3);
  border-radius: var(--radius-sm);
}

// -- Centered glass popover with backdrop --
.model-popover-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(30, 24, 32, 0.25);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.model-popover {
  width: 100%;
  max-width: 640px;
  max-height: calc(100vh - 80px);
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22), 0 6px 16px rgba(212, 116, 142, 0.15);
  backdrop-filter: var(--glass-blur);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.popover-backdrop-enter-active, .popover-backdrop-leave-active {
  transition: opacity 0.2s ease;
}
.popover-backdrop-enter-from, .popover-backdrop-leave-to {
  opacity: 0;
}

.popover-enter-active, .popover-leave-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.popover-enter-from, .popover-leave-to {
  opacity: 0;
  transform: scale(0.94) translateY(-8px);
}

.popover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.12), rgba(212, 116, 142, 0.03));
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);

  > .material-symbols-outlined { font-size: 18px; color: var(--highlight-text); }

  .header-btn {
    background: transparent;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover:not(:disabled) { color: var(--primary-text); background: rgba(255, 255, 255, 0.5); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
    .material-symbols-outlined { font-size: 16px; }
  }

  .refresh-btn { margin-left: auto; }
  .refresh-btn.spinning .material-symbols-outlined { animation: spin 0.8s linear infinite; }
}

@keyframes spin { to { transform: rotate(360deg); } }

.popover-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.3);

  > .material-symbols-outlined {
    font-size: 18px;
    color: var(--secondary-text);
  }

  input {
    flex: 1;
    border: none;
    background: transparent;
    outline: none;
    font-size: 13px;
    color: var(--primary-text);
    padding: 0;
    min-width: 0;
    &::placeholder { color: var(--secondary-text); }
  }
}

.popover-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 20px;
  color: var(--secondary-text);
  font-size: 13px;

  .material-symbols-outlined {
    font-size: 40px;
    opacity: 0.4;
  }

  .spin-icon { animation: spin 1s linear infinite; opacity: 0.8; }

  &.error {
    color: var(--danger-color, #d95555);
    .material-symbols-outlined { opacity: 0.7; }
  }
}

.popover-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}

.category-group + .category-group { margin-top: 10px; }

.category-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.15s;
  margin-bottom: 6px;

  &:hover { background: rgba(212, 116, 142, 0.06); }

  .caret {
    font-size: 18px;
    color: var(--highlight-text);
    flex-shrink: 0;
    transition: transform 0.2s;
  }

  .category-name {
    font-size: 11px;
    font-weight: 700;
    color: var(--highlight-text);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .category-count {
    font-size: 10px;
    color: var(--secondary-text);
    background: var(--accent-bg);
    padding: 1px 8px;
    border-radius: var(--radius-pill);
    margin-left: auto;
    font-weight: 600;
  }
}

// -- Each model = a glass bubble chip --
.category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 4px 4px 28px;
}

.model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  color: var(--primary-text);
  font-size: 12px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(4px);
  max-width: 100%;

  .model-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
  }

  .chip-check {
    font-size: 16px;
    color: var(--highlight-text);
    flex-shrink: 0;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.85);
    border-color: rgba(212, 116, 142, 0.4);
    color: var(--primary-text);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(212, 116, 142, 0.12);
  }

  &.active {
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.15), rgba(212, 116, 142, 0.05));
    border-color: rgba(212, 116, 142, 0.5);
    color: var(--highlight-text);
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(212, 116, 142, 0.2);
  }
}

.popover-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.3);

  .count-text {
    font-size: 11px;
    color: var(--secondary-text);
    font-family: 'JetBrains Mono', Consolas, monospace;
  }
}
</style>
