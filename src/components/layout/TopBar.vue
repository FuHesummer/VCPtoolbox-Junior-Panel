<template>
  <header class="topbar">
    <div class="brand">
      <button class="btn-menu" @click="ui.toggleSidebar()">
        <span class="material-symbols-outlined">{{ ui.sidebarOpen ? 'close' : 'menu' }}</span>
      </button>
      <img src="/VCPLogo2.png" alt="VCP" class="logo" />
      <span class="title">VCPtoolbox-Junior</span>
    </div>
    <div class="actions">
      <button class="btn btn-ghost" @click="restart" title="重启服务">
        <span class="material-symbols-outlined">restart_alt</span>
        <span class="action-label">重启</span>
      </button>
      <button class="btn btn-ghost" @click="logout" title="登出">
        <span class="material-symbols-outlined">logout</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { apiFetch } from '@/api/client'

const router = useRouter()
const auth = useAuthStore()
const ui = useUiStore()

async function logout() {
  await auth.logout()
  router.push({ name: 'login' })
}

async function restart() {
  if (!confirm('确认重启服务器吗？所有未保存的修改将丢失。')) return
  try {
    await apiFetch('/admin_api/server/restart', { method: 'POST' })
    ui.showMessage('重启指令已发送', 'success')
  } catch {
    // apiFetch 已展示错误 toast
  }
}
</script>

<style lang="scss" scoped>
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--topbar-height);
  background: var(--card-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: var(--card-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;

  .logo {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }

  .title {
    font-weight: 600;
    color: var(--highlight-text);
    letter-spacing: 0.5px;
  }
}

.btn-menu {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--primary-text);
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;

  &:hover { background: var(--accent-bg); }
  .material-symbols-outlined { font-size: 24px; }
}

.actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .topbar {
    padding: 0 12px;
  }

  .brand {
    gap: 8px;

    .logo {
      width: 28px;
      height: 28px;
    }

    .title {
      font-size: 14px;
    }
  }

  .btn-menu {
    display: flex;
  }

  .action-label {
    display: none;
  }

  .actions .btn {
    padding: 6px 10px;
  }
}
</style>
