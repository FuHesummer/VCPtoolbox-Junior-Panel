<template>
  <div class="slider-field" :class="{ dirty }">
    <div class="slider-header">
      <label class="slider-label">{{ label }}</label>
      <div class="slider-value-block">
        <span class="slider-value-num">{{ modelValue }}</span>
        <span v-if="unit" class="slider-value-unit">{{ unit }}</span>
      </div>
    </div>
    <p v-if="description" class="slider-desc">{{ description }}</p>
    <div class="slider-track-wrap">
      <div class="slider-track-bg">
        <div class="slider-track-fill" :style="trackFillStyle"></div>
      </div>
      <input
        type="range"
        class="slider-input"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step ?? 1"
        :disabled="disabled"
        @input="onInput"
      />
      <div class="slider-bounds">
        <span class="slider-bound">{{ min }}{{ unit ?? '' }}</span>
        <span class="slider-bound">{{ max }}{{ unit ?? '' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  description?: string
  modelValue: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  dirty?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const trackFillStyle = computed(() => {
  const pct = ((props.modelValue - props.min) / (props.max - props.min)) * 100
  return { width: `${pct}%` }
})

function onInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  emit('update:modelValue', v)
}
</script>

<style lang="scss" scoped>
.slider-field {
  padding: 16px 18px;
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

.slider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.slider-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);
  letter-spacing: 0.2px;
}

.slider-value-block {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  user-select: none;
  line-height: 1;
}

.slider-value-num {
  font-size: 18px;
  font-weight: 700;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: var(--highlight-text);
  letter-spacing: 0.3px;
  font-variant-numeric: tabular-nums;
}

.slider-value-unit {
  font-size: 11px;
  font-weight: 500;
  color: var(--secondary-text);
  text-transform: lowercase;
}

.slider-desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;
}

// -- Track wrapper: 容纳背景轨道 + 填充 + 透明 range input --
.slider-track-wrap {
  position: relative;
  height: 28px; // 容纳拇指完整显示
  display: flex;
  flex-direction: column;
  justify-content: center;
}

// 玻璃态背景轨道（看起来像 input）
.slider-track-bg {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  height: 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  overflow: hidden;
  pointer-events: none;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.03);
}

// 玫粉填充层
.slider-track-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    rgba(212, 116, 142, 0.45) 0%,
    rgba(212, 116, 142, 0.3) 100%
  );
  border-radius: var(--radius-pill);
  transition: width 0.1s ease;
}

.slider-bounds {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  padding: 0 2px;
}

.slider-bound {
  font-size: 10px;
  color: var(--secondary-text);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 500;
  user-select: none;
  opacity: 0.55;
}

// 透明 range input 覆盖在背景上，只提供拇指交互
.slider-input {
  -webkit-appearance: none;
  appearance: none;
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  width: 100%;
  height: 18px;
  padding: 0;
  margin: 0;
  background: transparent;
  outline: none;
  cursor: pointer;
  z-index: 2;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  // -- Webkit 轨道隐藏（用背景 div 代替）--
  &::-webkit-slider-runnable-track {
    height: 18px;
    background: transparent;
    border: none;
  }

  // -- 玻璃态拇指 --
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: 50%;
    background: #fff;
    border: 1.5px solid rgba(212, 116, 142, 0.55);
    box-shadow:
      0 1px 3px rgba(212, 116, 142, 0.2),
      0 1px 2px rgba(0, 0, 0, 0.06);
    cursor: pointer;
    transition:
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.2s ease,
      border-color 0.15s ease;
  }

  &:hover:not(:disabled)::-webkit-slider-thumb {
    transform: scale(1.2);
    border-color: rgba(212, 116, 142, 0.85);
    box-shadow:
      0 0 0 6px rgba(212, 116, 142, 0.08),
      0 2px 6px rgba(212, 116, 142, 0.22);
  }

  &:active:not(:disabled)::-webkit-slider-thumb {
    transform: scale(1.1);
    border-color: rgba(212, 116, 142, 1);
    box-shadow:
      0 0 0 8px rgba(212, 116, 142, 0.14),
      0 1px 4px rgba(212, 116, 142, 0.28);
  }

  // -- Firefox --
  &::-moz-range-track {
    height: 18px;
    background: transparent;
    border: none;
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    border: 1.5px solid rgba(212, 116, 142, 0.55);
    box-shadow:
      0 1px 3px rgba(212, 116, 142, 0.2),
      0 1px 2px rgba(0, 0, 0, 0.06);
    cursor: pointer;
    transition:
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.2s ease,
      border-color 0.15s ease;
  }

  &:hover:not(:disabled)::-moz-range-thumb {
    transform: scale(1.2);
    border-color: rgba(212, 116, 142, 0.85);
    box-shadow:
      0 0 0 6px rgba(212, 116, 142, 0.08),
      0 2px 6px rgba(212, 116, 142, 0.22);
  }

  &:active:not(:disabled)::-moz-range-thumb {
    transform: scale(1.1);
    border-color: rgba(212, 116, 142, 1);
  }
}

// 底部预留 bounds 空间
.slider-field {
  .slider-track-wrap { margin-bottom: 16px; }
}
</style>
