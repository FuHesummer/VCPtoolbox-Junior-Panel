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
.backup-view {
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}
.bk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  .title-block {
    display: flex; gap: 1rem; align-items: center;
    .icon { font-size: 2.5rem; color: var(--color-primary, #e91e63); }
    h1 { margin: 0; font-size: 1.5rem; }
    .sub { margin: 0; color: var(--color-text-muted, #888); font-size: 0.85rem; }
  }
  .actions { display: flex; gap: 0.5rem; }
}
.tabs {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border, #eee);
  .tab {
    padding: 0.6rem 1rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    display: flex; align-items: center; gap: 0.4rem;
    cursor: pointer;
    font-size: 0.9rem;
    &.active {
      color: var(--color-primary, #e91e63);
      border-bottom-color: currentColor;
      font-weight: 600;
    }
    .chip {
      padding: 1px 8px;
      background: var(--color-surface-alt, #f5f5f5);
      border-radius: 10px;
      font-size: 0.75rem;
      color: var(--color-text, #333);
    }
  }
}
.panel {
  background: var(--color-surface, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  h2 { margin: 0 0 0.3rem 0; font-size: 1.1rem; }
  h3 { font-size: 0.95rem; margin: 0; }
  .hint { color: var(--color-text-muted, #888); font-size: 0.85rem; margin: 0 0 0.5rem 0; }
  code { background: var(--color-code-bg, #f5f5f5); padding: 1px 5px; border-radius: 3px; font-size: 0.82em; }
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
  .export-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
}
.opt-inline {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.85rem;
}
.empty {
  text-align: center;
  color: var(--color-text-muted, #888);
  padding: 2rem;
  background: var(--color-surface-alt, #f9f9f9);
  border-radius: 6px;
}
.item-list { display: flex; flex-direction: column; gap: 0.4rem; }
.item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.7rem 1rem;
  border: 1px solid var(--color-border, #eee);
  border-radius: 6px;
  .item-main {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex: 1;
    min-width: 0;
    .material-symbols-outlined { color: #888; }
    .material-symbols-outlined.full-icon { color: #ff6f00; }
    .material-symbols-outlined.server-icon { color: #2e7d32; }
    strong { font-size: 0.88rem; }
    .muted { font-size: 0.75rem; color: #888; }
    .path-hint { font-size: 0.7rem; color: #aaa; font-family: monospace; margin-top: 2px; }
  }
  .item-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
}
.btn {
  padding: 0.5rem 1rem;
  border: none; border-radius: 4px;
  cursor: pointer; font-size: 0.9rem;
  display: inline-flex; align-items: center; gap: 0.3rem;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.btn-primary { background: var(--color-primary, #e91e63); color: white; }
  &.btn-secondary { background: var(--color-surface-alt, #f5f5f5); color: var(--color-text, #333); }
}
.btn-tiny {
  padding: 4px 10px;
  font-size: 0.78rem;
  border: 1px solid var(--color-border, #ddd);
  background: var(--color-surface, #fff);
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--color-text, #333);
  text-decoration: none;
  .material-symbols-outlined { font-size: 1rem; }
  &:hover:not(:disabled) { background: var(--color-hover, #fafafa); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.danger { color: #c62828; border-color: #ffcdd2; &:hover:not(:disabled) { background: #ffebee; } }
}
.alert {
  padding: 0.7rem 1rem;
  border-radius: 4px;
  margin: 0.8rem 0;
  display: flex; gap: 0.4rem; align-items: center;
  background: var(--color-warn-bg, #fff3e0);
  border-left: 4px solid var(--color-warn, #ff9800);
  &.alert-error { background: #ffebee; border-left-color: #c62828; }
  &.alert-warn { background: #fff8e1; border-left-color: #f57c00; }
  &.alert-success { background: #e8f5e9; border-left-color: #2e7d32; }
}
.webdav-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.6rem;
  padding: 0.8rem;
  background: var(--color-surface-alt, #f9f9f9);
  border-radius: 6px;
  .info-cell {
    display: flex; flex-direction: column;
    label { font-size: 0.75rem; color: #888; }
    span { font-size: 0.88rem; }
  }
}
.schedule-form {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  max-width: 600px;
  .form-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    span { font-size: 0.85rem; color: #555; }
    input {
      padding: 0.5rem 0.7rem;
      border: 1px solid var(--color-border, #ddd);
      border-radius: 4px;
      font-family: monospace;
    }
    &.toggle {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0.8rem;
      background: var(--color-surface-alt, #f9f9f9);
      border-radius: 4px;
    }
  }
  .form-row-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .schedule-info {
    padding: 0.7rem 0.9rem;
    background: var(--color-surface-alt, #f9f9f9);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    .muted { color: #888; font-size: 0.8rem; }
  }
  .form-actions { display: flex; justify-content: flex-end; margin-top: 0.5rem; }
}
.history-list {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border, #eee);
  h3 { margin-bottom: 0.5rem; }
  .history-row {
    display: flex;
    padding: 0.5rem 0.8rem;
    border-left: 3px solid transparent;
    margin-bottom: 0.3rem;
    &.success { border-left-color: #4caf50; background: #f1f8e9; }
    &.error { border-left-color: #c62828; background: #ffebee; }
    .history-main {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      .material-symbols-outlined {
        color: #888;
      }
      strong { font-size: 0.88rem; }
      .muted { font-size: 0.75rem; color: #888; }
    }
  }
}
</style>
