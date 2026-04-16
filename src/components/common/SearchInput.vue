<script setup lang="ts">
// 搜索输入框（防密码管理器误填充）
// 防御层级：
//  1. honeypot 假 username/password input：把扩展骗去填这俩看不见的
//  2. readonly + onfocus 解锁：浏览器一开始当只读不预填，点击才解锁
//  3. autocomplete=off + 怪 name + data-lpignore + data-1p-ignore：兼容 1Password / LastPass
import { ref } from 'vue'

defineProps<{
  modelValue: string
  placeholder?: string
}>()
defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
function unlock() {
  if (inputRef.value) inputRef.value.removeAttribute('readonly')
}
</script>

<template>
  <span class="search-input-wrap">
    <!-- Honeypot：诱骗密码管理器去填这俩假框 -->
    <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" class="honeypot" />
    <input type="password" name="password" autocomplete="current-password" tabindex="-1" aria-hidden="true" class="honeypot" />
    <input
      ref="inputRef"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      type="search"
      :name="`q-filter-${Math.random().toString(36).slice(2, 9)}`"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      readonly
      @focus="unlock"
      data-form-type="other"
      data-lpignore="true"
      data-1p-ignore
      :placeholder="placeholder || '搜索...'"
      class="search"
    />
  </span>
</template>

<style lang="scss" scoped>
.search-input-wrap {
  display: inline-flex;
  position: relative;
}
.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 200px;
  border: 1px solid var(--border-color);
  background: var(--input-bg, var(--secondary-bg));
  color: var(--primary-text);
  outline: none;
  transition: border-color 0.15s;
  &:focus { border-color: var(--button-bg); }
}
.honeypot {
  position: absolute;
  left: -10000px;
  top: -10000px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  border: 0;
  padding: 0;
  margin: 0;
}
</style>
