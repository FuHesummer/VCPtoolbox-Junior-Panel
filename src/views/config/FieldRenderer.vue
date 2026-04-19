<template>
  <!-- ============================================================
       FieldRenderer: renders a single ConfigField based on its type.
       Used exclusively by GlobalConfigView to avoid messy v-if chains
       in the parent template.
       ============================================================ -->

  <!-- slider -->
  <SliderField
    v-if="field.type === 'slider'"
    :label="field.label"
    :description="field.description"
    :model-value="numericValue"
    :min="field.min ?? 0"
    :max="field.max ?? 100"
    :step="field.step ?? 1"
    :unit="field.unit"
    @update:model-value="(v: number) => emit('update', String(v))"
  />

  <!-- tag-input -->
  <TagInput
    v-else-if="field.type === 'tag-input'"
    :label="field.label"
    :description="field.description"
    :model-value="tagsArray"
    :placeholder="field.placeholder ?? '输入后按回车添加'"
    @update:model-value="(v: string[]) => emit('updateTags', v)"
  />

  <!-- model-select -->
  <ModelSelect
    v-else-if="field.type === 'model-select'"
    :label="field.label"
    :description="field.description"
    :env-key="field.key"
    :dirty="dirty"
    :model-value="value || field.defaultValue || ''"
    :placeholder="field.placeholder"
    @update:model-value="(v: string) => emit('update', v)"
  />

  <!-- dynamic-pairs -->
  <DynamicPairList
    v-else-if="field.type === 'dynamic-pairs'"
    :label="field.label"
    :description="field.description"
    :model-value="dynamicPairs"
    key-label="检测词"
    value-label="替换文本"
    key-placeholder="要检测的文本"
    value-placeholder="替换为..."
    @update:model-value="(v: PairItem[]) => emit('updatePairs', v)"
  />

  <!-- prompt-editor -->
  <div v-else-if="field.type === 'prompt-editor'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <PromptEditor
      :model-value="value"
      :rows="22"
      :placeholder="field.placeholder"
      @update:model-value="(v: string) => emit('update', v)"
    />
  </div>

  <!-- boolean -->
  <div v-else-if="field.type === 'boolean'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <label class="bool-toggle">
      <input
        type="checkbox"
        :checked="value.toLowerCase() === 'true'"
        @change="emit('update', ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
      />
      <span class="bool-track"><span class="bool-thumb" /></span>
      <span class="bool-label">{{ value.toLowerCase() === 'true' ? '启用' : '禁用' }}</span>
    </label>
  </div>

  <!-- password -->
  <div v-else-if="field.type === 'password'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <div class="password-wrap">
      <input
        :type="passwordVisible ? 'text' : 'password'"
        :value="value"
        :placeholder="field.placeholder"
        autocomplete="off"
        data-1p-ignore
        data-lpignore="true"
        @input="emit('update', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="toggle-pass" @click="emit('togglePassword')">
        <span class="material-symbols-outlined">{{ passwordVisible ? 'visibility_off' : 'visibility' }}</span>
      </button>
    </div>
  </div>

  <!-- textarea -->
  <div v-else-if="field.type === 'textarea'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <textarea
      :value="value"
      :rows="Math.min(10, Math.max(3, (value || '').split('\n').length + 1))"
      :placeholder="field.placeholder"
      @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
    />
  </div>

  <!-- integer -->
  <div v-else-if="field.type === 'integer'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <div class="input-with-unit">
      <input
        type="number"
        step="1"
        :value="value"
        :placeholder="field.placeholder"
        @input="emit('update', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="field.unit" class="unit-label">{{ field.unit }}</span>
    </div>
  </div>

  <!-- select -->
  <div v-else-if="field.type === 'select'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <select
      :value="value || field.defaultValue || ''"
      @change="emit('update', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
  </div>

  <!-- tvs-file-select -->
  <div v-else-if="field.type === 'tvs-file-select'" class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <select
      :value="value || ''"
      @change="emit('update', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">(未选择)</option>
      <option v-for="f in tvsFiles" :key="f" :value="f">{{ f }}</option>
    </select>
  </div>

  <!-- folder-select (rendered as tag-input for now) -->
  <TagInput
    v-else-if="field.type === 'folder-select'"
    :label="field.label"
    :description="field.description"
    :model-value="tagsArray"
    :placeholder="field.placeholder ?? '输入路径后按回车'"
    @update:model-value="(v: string[]) => emit('updateTags', v)"
  />

  <!-- text / url / fallback -->
  <div v-else class="field-wrap" :class="{ dirty }">
    <div class="field-label-row">
      <label class="field-label">{{ field.label }}</label>
      <code class="field-key">{{ field.key }}</code>
    </div>
    <p v-if="field.description" class="field-desc">{{ field.description }}</p>
    <input
      :type="field.type === 'url' ? 'url' : 'text'"
      :value="value"
      :placeholder="field.placeholder"
      @input="emit('update', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConfigField } from '@/config/configSchema'

// -- Config field components --
import SliderField from '@/components/config/SliderField.vue'
import TagInput from '@/components/config/TagInput.vue'
import ModelSelect from '@/components/config/ModelSelect.vue'
import DynamicPairList from '@/components/config/DynamicPairList.vue'
import PromptEditor from '@/components/common/PromptEditor.vue'

type PairItem = { key: string; value: string }

const props = defineProps<{
  field: ConfigField
  value: string
  dirty: boolean
  passwordVisible: boolean
  tvsFiles: string[]
  dynamicPairs: PairItem[]
}>()

const emit = defineEmits<{
  update: [value: string]
  updatePairs: [value: PairItem[]]
  updateTags: [value: string[]]
  togglePassword: []
}>()

// Numeric value for slider fields
const numericValue = computed(() => {
  const n = parseFloat(props.value)
  if (isNaN(n)) return parseFloat(props.field.defaultValue ?? '0') || 0
  return n
})

// Tags array for tag-input / folder-select fields
const tagsArray = computed(() => {
  if (!props.value) return []
  return props.value.split(',').map(s => s.trim()).filter(Boolean)
})
</script>

<style lang="scss" scoped>
// ---------------------------------------------------------------------------
// Field wrapper (shared styling with GlobalConfigView)
// ---------------------------------------------------------------------------
.field-wrap {
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

.field-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);
  letter-spacing: 0.2px;
}

.field-key {
  font-size: 10px;
  color: var(--secondary-text);
  background: var(--accent-bg);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 500;
}

.field-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;
}

// Inputs
input[type="text"],
input[type="url"],
input[type="number"],
input[type="password"],
textarea,
select {
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

textarea {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  resize: vertical;
  line-height: 1.5;
}

// ---------------------------------------------------------------------------
// Password toggle
// ---------------------------------------------------------------------------
.password-wrap {
  position: relative;

  input { padding-right: 36px; }

  .toggle-pass {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    padding: 4px;
    color: var(--secondary-text);
    cursor: pointer;
    border-radius: var(--radius-sm);
    &:hover { color: var(--primary-text); background: var(--accent-bg); }
    .material-symbols-outlined { font-size: 18px; }
  }
}

// ---------------------------------------------------------------------------
// Boolean toggle (matches EnvField pattern)
// ---------------------------------------------------------------------------
.bool-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;

  input { display: none; }

  .bool-track {
    display: inline-block;
    width: 36px;
    height: 20px;
    background: var(--border-color);
    border-radius: 10px;
    position: relative;
    transition: background 0.2s;
  }

  .bool-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  input:checked ~ .bool-track {
    background: var(--button-bg);
    .bool-thumb { transform: translateX(16px); }
  }

  .bool-label {
    font-size: 13px;
    color: var(--primary-text);
  }
}

// ---------------------------------------------------------------------------
// Integer with unit
// ---------------------------------------------------------------------------
.input-with-unit {
  display: flex;
  align-items: center;
  gap: 6px;

  input { flex: 1; }

  .unit-label {
    font-size: 12px;
    color: var(--secondary-text);
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
