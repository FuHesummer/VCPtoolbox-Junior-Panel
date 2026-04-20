<template>
  <TopBar />
  <div class="container">
    <Transition name="overlay">
      <div v-if="ui.sidebarOpen" class="sidebar-overlay" @click="ui.closeSidebar()" />
    </Transition>
    <SideBar :class="{ open: ui.sidebarOpen }" />
    <main class="content">
      <router-view v-slot="{ Component }">
        <Transition name="route" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '@/components/layout/TopBar.vue'
import SideBar from '@/components/layout/SideBar.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const route = useRoute()

watch(() => route.path, () => ui.closeSidebar())
</script>

<style lang="scss" scoped>
.container {
  display: flex;
  height: calc(100vh - var(--topbar-height));
  gap: var(--content-padding);
  padding: var(--content-padding);
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--secondary-bg);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--card-border);
}

.sidebar-overlay {
  display: none;
}

.route-enter-active, .route-leave-active { transition: opacity 0.18s ease; }
.route-enter-from, .route-leave-to { opacity: 0; }

@media (max-width: 768px) {
  .container {
    gap: 0;
    padding: var(--content-padding);
  }

  .content {
    border-radius: var(--card-radius);
  }

  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 199;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }

  .overlay-enter-active, .overlay-leave-active { transition: opacity 0.25s ease; }
  .overlay-enter-from, .overlay-leave-to { opacity: 0; }
}
</style>
