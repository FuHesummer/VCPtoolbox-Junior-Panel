<template>
  <div class="pair-list-field">
    <div class="pair-header">
      <div class="pair-header-left">
        <span v-if="label" class="pair-label">{{ label }}</span>
        <p v-if="description" class="pair-desc">{{ description }}</p>
      </div>
      <button type="button" class="add-btn" @click="addPair">+ 添加规则</button>
    </div>

    <div v-if="modelValue.length" class="pair-cards">
      <div v-for="(pair, i) in modelValue" :key="i" class="pair-card">
        <span class="pair-index">#{{ i + 1 }}</span>
        <div class="pair-inputs">
          <div class="pair-input-group">
            <label class="pair-input-label">{{ keyLabel ?? 'Key' }}</label>
            <input
              type="text"
              :value="pair.key"
              :placeholder="keyPlaceholder ?? ''"
              @input="updateKey(i, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="pair-input-group">
            <label class="pair-input-label">{{ valueLabel ?? 'Value' }}</label>
            <input
              type="text"
              :value="pair.value"
              :placeholder="valuePlaceholder ?? ''"
              @input="updateValue(i, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <button type="button" class="delete-btn" @click="removePair(i)" title="Delete">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>

    <div v-else class="pair-empty">No rules defined</div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: Array<{ key: string; value: string }>
  keyLabel?: string
  valueLabel?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  label?: string
  description?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Array<{ key: string; value: string }>]
}>()

function addPair() {
  emit('update:modelValue', [...props.modelValue, { key: '', value: '' }])
}

function removePair(index: number) {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

function updateKey(index: number, key: string) {
  const next = props.modelValue.map((p, i) => (i === index ? { ...p, key } : p))
  emit('update:modelValue', next)
}

function updateValue(index: number, value: string) {
  const next = props.modelValue.map((p, i) => (i === index ? { ...p, value } : p))
  emit('update:modelValue', next)
}
</script>

<style lang="scss" scoped>
.pair-list-field {
  padding: 14px 16px;
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.pair-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.pair-header-left {
  flex: 1;
  min-width: 0;
}

.pair-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--primary-text);
}

.pair-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.5;
}

.add-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--highlight-text);
  background: transparent;
  border: 1px solid var(--highlight-text);
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: var(--highlight-text);
    color: #fff;
  }
}

.pair-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pair-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--accent-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}

.pair-index {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--secondary-text);
  font-family: 'JetBrains Mono', Consolas, monospace;
  padding-top: 22px;
}

.pair-inputs {
  flex: 1;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.pair-input-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  input {
    width: 100%;
  }
}

.pair-input-label {
  font-size: 11px;
  color: var(--secondary-text);
}

.delete-btn {
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 4px;
  color: var(--secondary-text);
  cursor: pointer;
  border-radius: var(--radius-sm);
  margin-top: 18px;
  transition: color 0.15s, background 0.15s;

  &:hover {
    color: #e05050;
    background: rgba(224, 80, 80, 0.08);
  }

  .material-symbols-outlined {
    font-size: 18px;
    display: block;
  }
}

.pair-empty {
  text-align: center;
  padding: 16px;
  font-size: 13px;
  color: var(--secondary-text);
}
</style>
