<template>
  <div class="collapsible-section" :class="{ open }">
    <button type="button" class="section-header" @click="open = !open">
      <span class="section-title">
        <span v-if="icon" class="material-symbols-outlined section-icon">{{ icon }}</span>
        <span>{{ title }}</span>
      </span>
      <span class="material-symbols-outlined arrow">expand_more</span>
    </button>
    <Transition name="collapse">
      <div v-show="open" class="section-body">
        <div class="section-content">
          <slot />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  title: string
  icon?: string
  defaultOpen?: boolean
}>()

const open = ref(props.defaultOpen ?? false)
</script>

<style lang="scss" scoped>
.collapsible-section {
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color 0.15s;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--primary-text);
  transition: background 0.15s;

  &:hover {
    background: var(--accent-bg);
  }
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.section-icon {
  font-size: 20px;
  color: var(--highlight-text);
}

.arrow {
  font-size: 20px;
  color: var(--secondary-text);
  transition: transform 0.25s ease;

  .open & {
    transform: rotate(180deg);
  }
}

.section-body {
  overflow: hidden;
}

.section-content {
  padding: 0 16px 16px;
}

.collapse-enter-active,
.collapse-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease;
  max-height: 2000px;
}

.collapse-enter-from,
.collapse-leave-to {
  max-height: 0;
  opacity: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  max-height: 2000px;
  opacity: 1;
}
</style>
