<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  listBackups, createBackup, formatBytes,
  listExports, deleteExport, downloadExportUrl, exportBackup,
  getWebdavConfig, testWebdav, listWebdavBackups, removeWebdavFile, uploadToWebdav,
  getSchedule, setSchedule, triggerSchedule, getScheduleHistory,
  type BackupItem, type ExportItem, type WebdavConfig, type WebdavItem,
  type BackupScheduleConfig, type BackupScheduleHistory,
} from '@/api/migration'

type Tab = 'local' | 'exports' | 'webdav' | 'schedule'
const tab = ref<Tab>('exports')

// 本地 Junior 快照备份（data/migration-backup/）
const localBackups = ref<BackupItem[]>([])
const creatingBackup = ref(false)

// VCPBackUp 导出包（data/migration-export/）
const exports = ref<ExportItem[]>([])
const exporting = ref(false)
const exportOpts = ref({ asFull: false, uploadToWebdav: false })
const uploadingToWebdav = ref<string | null>(null)

// WebDAV
const webdavConfig = ref<WebdavConfig | null>(null)
const webdavTesting = ref(false)
const webdavTestResult = ref<{ ok: boolean; error?: string } | null>(null)
const webdavItems = ref<WebdavItem[]>([])
const webdavLoading = ref(false)

// Schedule
const schedule = ref<BackupScheduleConfig | null>(null)
const scheduleForm = ref<Partial<BackupScheduleConfig>>({})
const savingSchedule = ref(false)
const triggering = ref(false)
const scheduleHistory = ref<BackupScheduleHistory[]>([])

onMounted(async () => {
  await Promise.all([
    refreshLocal(),
    refreshExports(),
    refreshWebdavConfig(),
    refreshSchedule(),
    refreshScheduleHistory(),
  ])
})

async function refreshLocal() {
  try { localBackups.value = await listBackups() } catch {}
}
async function refreshExports() {
  try { exports.value = await listExports() } catch {}
}
async function refreshWebdavConfig() {
  try { webdavConfig.value = await getWebdavConfig() } catch {}
}
async function refreshSchedule() {
  try {
    schedule.value = await getSchedule()
    scheduleForm.value = { ...schedule.value }
  } catch {}
}
async function refreshScheduleHistory() {
  try { scheduleHistory.value = await getScheduleHistory() } catch {}
}

// ========== Actions ==========

async function doCreateBackup() {
  creatingBackup.value = true
  try {
    await createBackup('manual')
    await refreshLocal()
  } catch (e) {
    alert('备份失败：' + (e as Error).message)
  } finally {
    creatingBackup.value = false
  }
}

async function doExportBackup() {
  exporting.value = true
  try {
    const r = await exportBackup(exportOpts.value)
    await refreshExports()
    if (r.upload?.ok) alert('已导出并上传到坚果云')
    else alert('导出完成：' + r.server.name)
  } catch (e) {
    alert('导出失败：' + (e as Error).message)
  } finally {
    exporting.value = false
  }
}

async function doDeleteExport(name: string) {
  if (!confirm(`删除 ${name}？`)) return
  await deleteExport(name)
  await refreshExports()
}

async function doUploadExportToWebdav(item: ExportItem) {
  uploadingToWebdav.value = item.name
  try {
    await uploadToWebdav(item.absPath, item.name)
    alert('上传成功')
    if (tab.value === 'webdav') await refreshWebdavList()
  } catch (e) {
    alert('上传失败：' + (e as Error).message)
  } finally {
    uploadingToWebdav.value = null
  }
}

// WebDAV
async function doTestWebdav() {
  webdavTesting.value = true
  try {
    const r = await testWebdav()
    webdavTestResult.value = { ok: r.ok, error: r.error }
    if (r.ok) await refreshWebdavList()
  } finally {
    webdavTesting.value = false
  }
}
async function refreshWebdavList() {
  webdavLoading.value = true
  try {
    webdavItems.value = await listWebdavBackups()
  } catch (e) {
    webdavTestResult.value = { ok: false, error: (e as Error).message }
  } finally {
    webdavLoading.value = false
  }
}
async function doDeleteWebdav(item: WebdavItem) {
  if (!confirm(`从坚果云删除 ${item.filename}？`)) return
  try {
    await removeWebdavFile(item.filename)
    await refreshWebdavList()
  } catch (e) {
    alert('删除失败：' + (e as Error).message)
  }
}

// Schedule
async function doSaveSchedule() {
  savingSchedule.value = true
  try {
    const r = await setSchedule(scheduleForm.value)
    schedule.value = r.config
    scheduleForm.value = { ...r.config }
    if (r.applied?.error) alert('已保存，但调度失败：' + r.applied.error)
    else alert('已保存' + (r.applied.scheduled ? `（下次运行 ${r.applied.nextInvocation || ''}）` : '（未启用）'))
  } catch (e) {
    alert('保存失败：' + (e as Error).message)
  } finally {
    savingSchedule.value = false
  }
}
async function doTriggerSchedule() {
  triggering.value = true
  try {
    const r = await triggerSchedule()
    await refreshExports()
    await refreshScheduleHistory()
    if (r.status === 'error') alert('执行失败：' + r.error)
  } catch (e) {
    alert('触发失败：' + (e as Error).message)
  } finally {
    triggering.value = false
  }
}
function formatTs(s?: string): string {
  if (!s) return '-'
  try { return new Date(s).toLocaleString() } catch { return s }
}
</script>

<template>
  <div class="backup-view">
    <header class="bk-header">
      <div class="title-block">
        <span class="material-symbols-outlined icon">backup</span>
        <div>
          <h1>备份管理</h1>
          <p class="sub">Junior 快照备份 · VCPBackUp 兼容导出 · 坚果云 WebDAV · 定时任务</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-secondary" @click="doCreateBackup" :disabled="creatingBackup">
          <span class="material-symbols-outlined">photo_camera</span>
          {{ creatingBackup ? '备份中...' : 'Junior 快照' }}
        </button>
      </div>
    </header>

    <!-- Tabs -->
    <nav class="tabs">
      <button class="tab" :class="{ active: tab === 'exports' }" @click="tab = 'exports'">
        <span class="material-symbols-outlined">ios_share</span>
        VCPBackUp 导出 <span class="chip">{{ exports.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'local' }" @click="tab = 'local'">
        <span class="material-symbols-outlined">archive</span>
        本地快照 <span class="chip">{{ localBackups.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'webdav' }" @click="tab = 'webdav'">
        <span class="material-symbols-outlined">cloud</span>
        坚果云
      </button>
      <button class="tab" :class="{ active: tab === 'schedule' }" @click="tab = 'schedule'">
        <span class="material-symbols-outlined">schedule</span>
        定时任务
      </button>
    </nav>

    <!-- VCPBackUp 导出（默认 tab）=============== -->
    <section v-if="tab === 'exports'" class="panel">
      <div class="panel-head">
        <div>
          <h2>导出 VCPBackUp 兼容包</h2>
          <p class="hint">产物与上游 <a href="https://github.com/lioensky/VCPBcakUpDEV" target="_blank">VCPBackUp</a> 格式一致（扁平 .txt/.md/.env/.json 过滤版），可用于迁移到其他 VCP 实例。</p>
        </div>
        <div class="export-actions">
          <label class="opt-inline"><input type="checkbox" v-model="exportOpts.asFull" /> 合成 Full 包</label>
          <label class="opt-inline">
            <input type="checkbox" v-model="exportOpts.uploadToWebdav" :disabled="!webdavConfig?.enabled" />
            导出后上传坚果云
          </label>
          <button class="btn btn-primary" @click="doExportBackup" :disabled="exporting">
            <span class="material-symbols-outlined">ios_share</span>
            {{ exporting ? '导出中...' : '立即导出' }}
          </button>
        </div>
      </div>

      <div v-if="exports.length === 0" class="empty">暂无导出包，点击上方「立即导出」生成</div>
      <div v-else class="item-list">
        <div v-for="it in exports" :key="it.name" class="item-row">
          <div class="item-main">
            <span class="material-symbols-outlined" :class="it.type === 'full' ? 'full-icon' : 'server-icon'">
              {{ it.type === 'full' ? 'inventory_2' : 'archive' }}
            </span>
            <div>
              <strong>{{ it.name }}</strong>
              <div class="muted">{{ it.sizeHuman }} · {{ formatTs(it.createdAt) }} · {{ it.type === 'full' ? '全家桶包' : 'Server 包' }}</div>
            </div>
          </div>
          <div class="item-actions">
            <a :href="downloadExportUrl(it.name)" class="btn-tiny" download>
              <span class="material-symbols-outlined">download</span> 下载
            </a>
            <button class="btn-tiny"
              v-if="webdavConfig?.enabled"
              :disabled="uploadingToWebdav === it.name"
              @click="doUploadExportToWebdav(it)">
              <span class="material-symbols-outlined">cloud_upload</span>
              {{ uploadingToWebdav === it.name ? '上传中...' : '传坚果云' }}
            </button>
            <button class="btn-tiny danger" @click="doDeleteExport(it.name)">
              <span class="material-symbols-outlined">delete</span> 删除
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 本地快照 =============== -->
    <section v-if="tab === 'local'" class="panel">
      <div class="panel-head">
        <div>
          <h2>Junior 本地快照</h2>
          <p class="hint">迁移前自动备份 + 手动备份，位于 <code>data/migration-backup/</code>，最近保留 10 份。</p>
        </div>
      </div>
      <div v-if="localBackups.length === 0" class="empty">暂无快照</div>
      <div v-else class="item-list">
        <div v-for="b in localBackups" :key="b.name" class="item-row">
          <div class="item-main">
            <span class="material-symbols-outlined">photo_camera</span>
            <div>
              <strong>{{ b.name }}</strong>
              <div class="muted">{{ b.sizeHuman }} · {{ formatTs(b.createdAt) }}</div>
              <div class="path-hint">{{ b.relPath }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 坚果云 =============== -->
    <section v-if="tab === 'webdav'" class="panel">
      <div class="panel-head">
        <div>
          <h2>坚果云 WebDAV</h2>
          <p class="hint">与上游 VCPBackUp 共用 <code>JianguoyunDEV*</code> 配置，在 <code>config.env</code> 修改后重启生效。</p>
        </div>
        <button class="btn btn-secondary" @click="doTestWebdav" :disabled="webdavTesting">
          <span class="material-symbols-outlined">wifi_find</span>
          {{ webdavTesting ? '测试中...' : '测试连接' }}
        </button>
      </div>

      <div v-if="!webdavConfig?.enabled" class="alert alert-warn">
        <span class="material-symbols-outlined">warning</span>
        坚果云同步未启用（<code>JianguoyunDEV=false</code>）
      </div>
      <div v-else class="webdav-info-grid">
        <div class="info-cell">
          <label>服务器</label>
          <span>{{ webdavConfig.url }}</span>
        </div>
        <div class="info-cell">
          <label>备份目录</label>
          <span><code>{{ webdavConfig.basePath }}</code></span>
        </div>
        <div class="info-cell">
          <label>账号</label>
          <span>{{ webdavConfig.userConfigured ? '✓ 已配置' : '✗ 未配置' }}</span>
        </div>
        <div class="info-cell">
          <label>密码</label>
          <span>{{ webdavConfig.passwordConfigured ? '✓ 已配置' : '✗ 未配置' }}</span>
        </div>
      </div>

      <div v-if="webdavTestResult" class="alert" :class="webdavTestResult.ok ? 'alert-success' : 'alert-error'">
        {{ webdavTestResult.ok ? '✅ 连接成功' : `❌ ${webdavTestResult.error}` }}
      </div>

      <div v-if="webdavConfig?.enabled" class="panel-head" style="margin-top:1rem">
        <h3 style="margin:0">远程备份</h3>
        <button class="btn-tiny" @click="refreshWebdavList" :disabled="webdavLoading">
          <span class="material-symbols-outlined">refresh</span>
          {{ webdavLoading ? '刷新中...' : '刷新' }}
        </button>
      </div>
      <div v-if="webdavItems.length === 0 && webdavConfig?.enabled && !webdavLoading" class="empty">远程目录为空</div>
      <div v-else-if="webdavItems.length > 0" class="item-list">
        <div v-for="it in webdavItems" :key="it.filename" class="item-row">
          <div class="item-main">
            <span class="material-symbols-outlined">cloud_done</span>
            <div>
              <strong>{{ it.filename }}</strong>
              <div class="muted">{{ formatBytes(it.size) }} · {{ it.lastModified || '未知时间' }}</div>
            </div>
          </div>
          <div class="item-actions">
            <button class="btn-tiny danger" @click="doDeleteWebdav(it)">
              <span class="material-symbols-outlined">delete</span> 删除
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 定时任务 =============== -->
    <section v-if="tab === 'schedule'" class="panel">
      <div class="panel-head">
        <div>
          <h2>定时自动备份</h2>
          <p class="hint">基于 node-schedule 的 cron 调度，自动执行「导出 VCPBackUp → 可选上传坚果云 → 滚动清理旧包」。</p>
        </div>
        <button class="btn btn-secondary" @click="doTriggerSchedule" :disabled="triggering">
          <span class="material-symbols-outlined">play_arrow</span>
          {{ triggering ? '执行中...' : '立即运行' }}
        </button>
      </div>

      <div v-if="schedule" class="schedule-form">
        <label class="form-row toggle">
          <span>启用定时任务</span>
          <input type="checkbox" v-model="scheduleForm.enabled" />
        </label>

        <label class="form-row">
          <span>cron 表达式</span>
          <input v-model="scheduleForm.cron" placeholder="0 3 * * * （每天凌晨 3 点）" />
        </label>

        <div class="form-row-grid">
          <label class="form-row">
            <span>保留最新份数</span>
            <input type="number" v-model.number="scheduleForm.keepCount" min="1" max="100" />
          </label>
          <label class="form-row">
            <span>保留天数（0=不限）</span>
            <input type="number" v-model.number="scheduleForm.keepDays" min="0" max="365" />
          </label>
        </div>

        <label class="form-row toggle">
          <span>上传到坚果云</span>
          <input type="checkbox" v-model="scheduleForm.uploadToWebdav" :disabled="!webdavConfig?.enabled" />
        </label>

        <label class="form-row toggle">
          <span>合成 Full 包上传（更贴近 VCPBackUp 格式）</span>
          <input type="checkbox" v-model="scheduleForm.uploadAsFull" :disabled="!scheduleForm.uploadToWebdav" />
        </label>

        <div class="schedule-info">
          <div><strong>当前状态：</strong>{{ schedule.active ? '✅ 正在运行' : '⏸ 未启用' }}</div>
          <div v-if="schedule.nextInvocation"><strong>下次运行：</strong>{{ formatTs(schedule.nextInvocation) }}</div>
          <div v-if="schedule.lastRun">
            <strong>上次：</strong>{{ formatTs(schedule.lastRun) }}
            <span class="muted">（{{ schedule.lastStatus === 'success' ? '成功' : (schedule.lastStatus === 'error' ? '失败' : '-') }}）</span>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" @click="doSaveSchedule" :disabled="savingSchedule">
            <span class="material-symbols-outlined">save</span>
            {{ savingSchedule ? '保存中...' : '保存并应用' }}
          </button>
        </div>
      </div>

      <!-- 历史 -->
      <div v-if="scheduleHistory.length > 0" class="history-list">
        <h3>执行历史</h3>
        <div v-for="(h, idx) in scheduleHistory.slice(0, 10)" :key="idx" class="history-row" :class="h.status">
          <div class="history-main">
            <span class="material-symbols-outlined">{{ h.status === 'success' ? 'check_circle' : 'error' }}</span>
            <div>
              <strong>{{ formatTs(h.startedAt) }}</strong>
              <div class="muted">{{ h.trigger }} · {{ h.status }}{{ h.error ? ' · ' + h.error : '' }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
// ============================================================
// 🌸 Junior 玫粉主题 · 玻璃态 BackupView
// ============================================================
.backup-view {
  padding: 20px 24px 24px;
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

// —— 标题栏 ——
.bk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);

  .title-block {
    display: flex; gap: 14px; align-items: center;
    .icon {
      font-size: 34px;
      color: var(--highlight-text);
      background: linear-gradient(135deg, rgba(212,116,142,0.15), rgba(212,116,142,0.04));
      padding: 8px;
      border-radius: var(--radius-md);
    }
    h1 { margin: 0; font-size: 20px; font-weight: 600; color: var(--primary-text); letter-spacing: 0.3px; }
    .sub { margin: 3px 0 0; color: var(--secondary-text); font-size: 13px; }
  }
  .actions { display: flex; gap: 8px; }
}

// —— 顶部 Tabs ——
.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);

  .tab {
    padding: 9px 16px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    display: inline-flex; align-items: center; gap: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--secondary-text);
    font-weight: 500;
    transition: all 0.15s ease;
    .material-symbols-outlined { font-size: 18px; }

    &:hover:not(.active) {
      background: var(--accent-bg);
      color: var(--primary-text);
    }
    &.active {
      background: linear-gradient(135deg, var(--button-bg), var(--button-hover-bg));
      color: #fff;
      box-shadow: 0 2px 8px rgba(212,116,142,0.3);
    }

    .chip {
      margin-left: 2px;
      padding: 1px 8px;
      background: rgba(255,255,255,0.35);
      border-radius: var(--radius-pill);
      font-size: 11px;
      font-weight: 600;
    }
    &:not(.active) .chip { background: rgba(138,116,144,0.15); color: var(--secondary-text); }
  }
}

// —— 面板容器 ——
.panel {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);

  h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; color: var(--primary-text); }
  h3 { font-size: 14px; margin: 0; color: var(--primary-text); font-weight: 600; }
  .hint {
    color: var(--secondary-text);
    font-size: 13px;
    margin: 0 0 12px;
    line-height: 1.6;
  }
  code {
    background: var(--input-bg);
    padding: 2px 7px;
    border-radius: 5px;
    font-size: 0.85em;
    color: var(--highlight-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  a { color: var(--highlight-text); text-decoration: none; &:hover { text-decoration: underline; } }
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 14px;
  .export-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }
}

.opt-inline {
  display: flex; align-items: center; gap: 6px;
  font-size: 12.5px;
  color: var(--primary-text);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.4);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: var(--accent-bg); }
  input[type=checkbox] {
    accent-color: var(--button-bg);
    cursor: pointer;
  }
}

// —— 空状态 ——
.empty {
  text-align: center;
  color: var(--secondary-text);
  padding: 40px 20px;
  background: rgba(255,255,255,0.35);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  font-size: 13px;
}

// —— 列表项 ——
.item-list { display: flex; flex-direction: column; gap: 6px; }
.item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: rgba(255,255,255,0.4);
  transition: all 0.15s ease;

  &:hover {
    background: var(--accent-bg);
    border-color: rgba(212,116,142,0.3);
    box-shadow: 0 2px 8px rgba(212,116,142,0.08);
  }

  .item-main {
    display: flex;
    gap: 12px;
    align-items: center;
    flex: 1;
    min-width: 0;
    .material-symbols-outlined {
      color: var(--highlight-text);
      font-size: 22px;
      background: rgba(212,116,142,0.08);
      padding: 6px;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
    }
    .material-symbols-outlined.full-icon {
      color: #ff9740;
      background: rgba(255,151,64,0.1);
    }
    .material-symbols-outlined.server-icon {
      color: #5aa878;
      background: rgba(109,187,138,0.12);
    }
    strong { font-size: 13.5px; color: var(--primary-text); display: block; }
    .muted { font-size: 11.5px; color: var(--secondary-text); margin-top: 2px; }
    .path-hint {
      font-size: 11px;
      color: var(--secondary-text);
      font-family: ui-monospace, monospace;
      margin-top: 3px;
      opacity: 0.75;
    }
  }
  .item-actions { display: flex; gap: 5px; flex-shrink: 0; }
}

// —— 按钮 ——
.btn {
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.15s ease;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.btn-primary {
    background: linear-gradient(135deg, var(--button-bg), var(--button-hover-bg));
    color: #fff;
    box-shadow: 0 2px 8px rgba(212,116,142,0.25);
    &:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(212,116,142,0.35); }
  }
  &.btn-secondary {
    background: rgba(255,255,255,0.7);
    border-color: var(--border-color);
    color: var(--primary-text);
    &:hover:not(:disabled) { background: var(--accent-bg); border-color: rgba(212,116,142,0.35); }
  }
}

.btn-tiny {
  padding: 5px 11px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  background: rgba(255,255,255,0.55);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--primary-text);
  text-decoration: none;
  transition: all 0.15s;
  .material-symbols-outlined { font-size: 14px; }

  &:hover:not(:disabled) { background: var(--accent-bg); border-color: rgba(212,116,142,0.35); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.danger {
    color: var(--danger-color);
    border-color: rgba(217,85,85,0.25);
    background: rgba(217,85,85,0.06);
    &:hover:not(:disabled) { background: rgba(217,85,85,0.12); border-color: rgba(217,85,85,0.45); }
  }
}

// —— 提示条 ——
.alert {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  margin: 10px 0;
  display: flex; gap: 8px; align-items: center;
  font-size: 13px;
  line-height: 1.5;
  background: rgba(255,243,224,0.65);
  border: 1px solid rgba(255,152,0,0.25);
  border-left: 3px solid #ff9800;
  color: #7a5a1e;
  backdrop-filter: blur(8px);

  &.alert-error { background: rgba(255,235,238,0.7); border-color: rgba(217,85,85,0.3); border-left-color: var(--danger-color); color: #a64040; }
  &.alert-warn { background: rgba(255,248,225,0.7); border-color: rgba(245,124,0,0.3); border-left-color: #f57c00; }
  &.alert-success { background: rgba(232,245,233,0.7); border-color: rgba(109,187,138,0.3); border-left-color: var(--memory-color); color: #2e6a42; }
  .material-symbols-outlined { font-size: 20px; flex-shrink: 0; }
}

// —— WebDAV 信息网格 ——
.webdav-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(255,255,255,0.5), rgba(212,116,142,0.03));
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);

  .info-cell {
    display: flex; flex-direction: column; gap: 3px;
    label {
      font-size: 11px;
      color: var(--secondary-text);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    span { font-size: 13px; color: var(--primary-text); }
  }
}

// —— 定时任务表单 ——
.schedule-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 640px;

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    span {
      font-size: 13px;
      color: var(--primary-text);
      font-weight: 500;
    }
    input {
      padding: 8px 11px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--input-bg);
      color: var(--primary-text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      transition: border-color 0.15s, box-shadow 0.15s;
      &:focus { outline: none; border-color: var(--button-bg); box-shadow: 0 0 0 3px rgba(212,116,142,0.15); }
    }
    input[type=checkbox] {
      accent-color: var(--button-bg);
      cursor: pointer;
      width: 16px; height: 16px;
    }
    &.toggle {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: rgba(255,255,255,0.45);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      transition: background 0.15s;
      &:hover { background: var(--accent-bg); }
    }
  }

  .form-row-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .schedule-info {
    padding: 12px 14px;
    background: linear-gradient(135deg, rgba(109,187,138,0.08), rgba(109,187,138,0.02));
    border: 1px solid rgba(109,187,138,0.2);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--primary-text);
    strong { color: var(--primary-text); font-weight: 600; }
    .muted { color: var(--secondary-text); font-size: 12px; }
  }

  .form-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
}

// —— 执行历史 ——
.history-list {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
  h3 { margin: 0 0 10px; color: var(--primary-text); font-weight: 600; }

  .history-row {
    display: flex;
    padding: 9px 12px;
    margin-bottom: 5px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: rgba(255,255,255,0.35);
    border-left-width: 3px;

    &.success {
      border-left-color: var(--memory-color);
      background: linear-gradient(90deg, rgba(109,187,138,0.08), rgba(109,187,138,0.02));
    }
    &.error {
      border-left-color: var(--danger-color);
      background: linear-gradient(90deg, rgba(217,85,85,0.08), rgba(217,85,85,0.02));
    }

    .history-main {
      display: flex; gap: 8px; align-items: center;
      .material-symbols-outlined {
        color: var(--secondary-text);
        font-size: 20px;
      }
      strong { font-size: 13px; color: var(--primary-text); }
      .muted { font-size: 11.5px; color: var(--secondary-text); }
    }
    &.success .material-symbols-outlined { color: var(--memory-color); }
    &.error .material-symbols-outlined { color: var(--danger-color); }
  }
}
</style>
