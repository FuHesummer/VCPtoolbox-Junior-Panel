<template>
  <div class="tag-input-field">
    <div v-if="label" class="tag-header">
      <span class="tag-label">{{ label }}</span>
    </div>
    <p v-if="description" class="tag-desc">{{ description }}</p>

    <div class="tag-chips" v-if="modelValue.length">
      <span v-for="(tag, i) in modelValue" :key="i" class="chip">
        <span class="chip-text">{{ tag }}</span>
        <button type="button" class="chip-remove" @click="remove(i)">&times;</button>
      </span>
    </div>

    <div class="tag-input-wrap">
      <input
        ref="inputRef"
        type="text"
        class="tag-text-input"
        :placeholder="placeholder ?? ''"
        :list="suggestions?.length ? listId : undefined"
        v-model="draft"
        @keydown.enter.prevent="addDraft"
        @keydown.,="onCommaKey"
        @paste="onPaste"
      />
      <datalist v-if="suggestions?.length" :id="listId">
        <option v-for="s in filteredSuggestions" :key="s" :value="s" />
      </datalist>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  modelValue: string[]
  placeholder?: string
  label?: string
  description?: string
  suggestions?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const listId = `tag-list-${Math.random().toString(36).slice(2, 8)}`

const filteredSuggestions = computed(() => {
  if (!props.suggestions) return []
  const lower = draft.value.toLowerCase()
  return props.suggestions.filter(
    s => !props.modelValue.includes(s) && s.toLowerCase().includes(lower)
  )
})

function addTag(raw: string) {
  const tag = raw.trim()
  if (tag && !props.modelValue.includes(tag)) {
    emit('update:modelValue', [...props.modelValue, tag])
  }
}

function addDraft() {
  addTag(draft.value)
  draft.value = ''
}

function remove(index: number) {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

function onCommaKey(e: KeyboardEvent) {
  e.preventDefault()
  addDraft()
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain')
  if (!text) return
  if (!text.includes(',')) return
  e.preventDefault()
  const parts = text.split(',').map(s => s.trim()).filter(Boolean)
  const unique = [...props.modelValue]
  for (const p of parts) {
    if (!unique.includes(p)) unique.push(p)
  }
  emit('update:modelValue', unique)
  draft.value = ''
}
</script>

<style lang="scss" scoped>
.tag-input-field {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.6);
    border-color: rgba(212, 116, 142, 0.2);
  }
}

.tag-header {
  margin-bottom: 4px;
}

.tag-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);
  letter-spacing: 0.2px;
}

.tag-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 0;

  &:empty { margin-bottom: 0; }
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 12px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--primary-text);
  line-height: 1.5;
  font-family: 'JetBrains Mono', Consolas, monospace;
  backdrop-filter: blur(4px);
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.85);
    border-color: rgba(212, 116, 142, 0.4);
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(212, 116, 142, 0.1);
  }

  .chip-text {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-remove {
    background: transparent;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0;
    margin-left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;

    &:hover {
      color: #fff;
      background: rgba(217, 85, 85, 0.75);
    }
  }
}

.tag-input-wrap {
  position: relative;
}

.tag-text-input {
  width: 100%;
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
</style>
