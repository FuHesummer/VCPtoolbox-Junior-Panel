<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  scanSource, diffConfig, matchPlugins, executeMigration,
  autoPlan,
  listBackups, getStatus, cancel, createBackup,
  formatBytes, sourceTypeLabel,
  uploadSource, listUploads, deleteUpload,
  getWebdavConfig, testWebdav, listWebdavBackups, downloadFromWebdav,
  type ScanResult, type ConfigDiff, type PluginMatch,
  type MigrationPlan, type SseLogEvent, type BackupItem,
  type DailynoteDecision, type KnowledgeDecision, type PluginInstallDecision,
  type UploadedItem, type WebdavConfig, type WebdavItem,
} from '@/api/migration'

type Step = 1 | 2 | 3 | 4 | 5
type SourceMode = 'dir' | 'upload' | 'webdav'

const step = ref<Step>(1)
const sourceMode = ref<SourceMode>('dir')
const sourcePath = ref('')
const sourceLabel = ref('')        // 给用户看的源描述（文件名或目录名）
const scanning = ref(false)
const scanResult = ref<ScanResult | null>(null)

// 上传模式
const uploading = ref(false)
const uploadProgress = ref(0)
const selectedFile = ref<File | null>(null)
const uploadedItems = ref<UploadedItem[]>([])

// 坚果云模式
const webdavConfig = ref<WebdavConfig | null>(null)
const webdavTesting = ref(false)
const webdavTestResult = ref<{ ok: boolean; error?: string } | null>(null)
const webdavItems = ref<WebdavItem[]>([])
const webdavLoading = ref(false)
const webdavDownloading = ref(false)

// Step 2 — 选择状态
const selectedAgents = ref<Set<string>>(new Set())
const dailynoteDecisions = ref<Map<string, DailynoteDecision>>(new Map())
const knowledgeDecisions = ref<Map<string, KnowledgeDecision>>(new Map())
const selectedTvs = ref<Set<string>>(new Set())
const selectedImages = ref<Set<string>>(new Set())
const pluginMatch = ref<PluginMatch | null>(null)
const pluginDecisions = ref<Map<string, PluginInstallDecision>>(new Map())
const copyVectors = ref(false)

// 🪄 智能推荐
const autoPlanning = ref(false)

// Step 3 — config merge
const configDiff = ref<ConfigDiff | null>(null)
const configAddDecisions = ref<Record<string, boolean>>({})
const configConflictDecisions = ref<Record<string, 'use_upstream' | 'use_junior' | { custom: string }>>({})

// Step 4/5 — 执行
const executing = ref(false)
const logLines = ref<SseLogEvent[]>([])
const jobId = ref<string | null>(null)
const doneSummary = ref<Record<string, unknown> | null>(null)
const abortHandle = ref<{ abort: () => void } | null>(null)

// 备份历史
const backups = ref<BackupItem[]>([])

const tab = ref<'agents' | 'dailynote' | 'tvs' | 'images' | 'plugins'>('agents')

const runningStatus = ref<{ running: boolean; jobId?: string }>({ running: false })
let statusTimer: number | null = null

onMounted(async () => {
  await refreshStatus()
  await refreshBackups()
  await refreshUploads()
  await refreshWebdavConfig()
  statusTimer = window.setInterval(refreshStatus, 5000)
})
onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
  abortHandle.value?.abort()
})

async function refreshStatus() {
  try { runningStatus.value = await getStatus() } catch {}
}
async function refreshBackups() {
  try { backups.value = await listBackups() } catch {}
}
async function refreshUploads() {
  try { uploadedItems.value = await listUploads() } catch {}
}
async function refreshWebdavConfig() {
  try { webdavConfig.value = await getWebdavConfig() } catch {}
}

// ======== 上传 VCPBackUp zip ========

function onFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
}

async function doUpload() {
  if (!selectedFile.value) return
  uploading.value = true
  uploadProgress.value = 0
  try {
    const resp = await uploadSource(selectedFile.value)
    sourcePath.value = resp.sourcePath
    sourceLabel.value = resp.filename
    selectedFile.value = null
    await refreshUploads()
    // 上传后自动 scan
    await doScan()
  } catch (e) {
    alert(`上传失败: ${(e as Error).message}`)
  } finally {
    uploading.value = false
    uploadProgress.value = 0
  }
}

function usePrevUpload(item: UploadedItem) {
  sourcePath.value = item.absPath
  sourceLabel.value = item.filename
  doScan()
}

async function doDeleteUpload(item: UploadedItem) {
  if (!confirm(`删除上传的 ${item.filename}？`)) return
  await deleteUpload(item.filename)
  await refreshUploads()
}

// ======== 坚果云 WebDAV ========

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

async function doDownloadWebdav(item: WebdavItem) {
  webdavDownloading.value = true
  try {
    const r = await downloadFromWebdav(item.filename)
    sourcePath.value = r.sourcePath
    sourceLabel.value = item.filename
    await refreshUploads()
    await doScan()
  } catch (e) {
    alert(`下载失败: ${(e as Error).message}`)
  } finally {
    webdavDownloading.value = false
  }
}

function switchMode(mode: SourceMode) {
  sourceMode.value = mode
  scanResult.value = null
  sourcePath.value = ''
  sourceLabel.value = ''
  if (mode === 'webdav' && webdavItems.value.length === 0 && webdavConfig.value?.enabled) {
    refreshWebdavList()
  }
}

// ======== Step 1: Scan ========

async function doScan() {
  const sp = sourcePath.value.trim()
  if (!sp) return
  scanning.value = true
  scanResult.value = null
  try {
    const result = await scanSource(sp)
    scanResult.value = result
    if (!result.valid) return

    // 默认全选
    selectedAgents.value = new Set(result.agents.map(a => a.name))
    selectedTvs.value = new Set(result.tvs.map(t => t.name))
    selectedImages.value = new Set(result.images.map(i => i.name))
    const dnMap = new Map<string, DailynoteDecision>()
    for (const dn of result.dailynotes) {
      dnMap.set(dn.name, {
        sourceName: dn.name,
        targetType: dn.suggest,
        publicDirName: dn.suggest === 'public' ? `公共${dn.name}` : undefined,
        agentName: dn.suggest === 'personal' ? (result.agents[0]?.name || '') : undefined,
      })
    }
    dailynoteDecisions.value = dnMap

    // 默认 knowledge 分流（Agent 同名 → personal，其余 → public）
    const kMap = new Map<string, KnowledgeDecision>()
    const agentNames = new Set(result.agents.map(a => a.name))
    for (const k of (result.knowledge || [])) {
      if (agentNames.has(k.name)) {
        kMap.set(k.name, { sourceName: k.name, targetType: 'personal', agentName: k.name, publicDirName: k.name })
      } else {
        kMap.set(k.name, { sourceName: k.name, targetType: 'public', publicDirName: k.name })
      }
    }
    knowledgeDecisions.value = kMap

    // 调 match-plugins
    try {
      pluginMatch.value = await matchPlugins(result.plugins)
      const pm = new Map<string, PluginInstallDecision>()
      for (const p of pluginMatch.value.installable) {
        pm.set(p.name, {
          name: p.name,
          source: p.source,
          mergeConfig: p.hasUpstreamConfig,
          copyVectorStore: false,
          enable: p.upstreamEnabled,
        })
      }
      pluginDecisions.value = pm
    } catch (e) {
      console.warn('match-plugins failed', e)
    }

    step.value = 2
  } finally {
    scanning.value = false
  }
}

// 🪄 智能推荐：一键生成完整默认 plan 并直接跳 Step 4 预览
async function doAutoPlan() {
  const sp = sourcePath.value.trim()
  if (!sp) return
  autoPlanning.value = true
  try {
    const result = await autoPlan(sp)
    scanResult.value = result.scan
    pluginMatch.value = result.match

    // 把 autoPlan 返回填充到 decisions（之后 plan computed 会自动汇总）
    selectedAgents.value = new Set(result.plan.agents || [])
    selectedTvs.value = new Set(result.plan.tvs || [])
    selectedImages.value = new Set(result.plan.images || [])

    const dnMap = new Map<string, DailynoteDecision>()
    for (const d of (result.plan.dailynotes || [])) dnMap.set(d.sourceName, d)
    dailynoteDecisions.value = dnMap

    const kMap = new Map<string, KnowledgeDecision>()
    for (const k of (result.plan.knowledge || [])) kMap.set(k.sourceName, k)
    knowledgeDecisions.value = kMap

    const pm = new Map<string, PluginInstallDecision>()
    for (const p of (result.plan.plugins || [])) pm.set(p.name, p)
    pluginDecisions.value = pm

    copyVectors.value = result.plan.copyVectors || false

    // 跳到 Step 4 预览（config merge 可跳过，除非用户点 Step 3 手动处理）
    step.value = 4
  } catch (e) {
    alert(`智能推荐失败: ${(e as Error).message}`)
  } finally {
    autoPlanning.value = false
  }
}

// ======== Step 3: Config diff ========

async function goToConfig() {
  const d = await diffConfig(sourcePath.value)
  configDiff.value = d
  if (d.available) {
    // 默认：add 全部勾选，冲突默认保留 junior（更安全）
    const addDec: Record<string, boolean> = {}
    for (const a of d.addedFromSource) addDec[a.key] = true
    configAddDecisions.value = addDec

    const conflictDec: Record<string, 'use_upstream' | 'use_junior' | { custom: string }> = {}
    for (const c of d.conflicts) conflictDec[c.key] = 'use_junior'
    configConflictDecisions.value = conflictDec
  }
  step.value = 3
}

// ======== Step 4: Preview ========

const plan = computed<MigrationPlan>(() => ({
  sourcePath: sourcePath.value,
  doBackup: true,
  agents: [...selectedAgents.value],
  dailynotes: [...dailynoteDecisions.value.values()],
  knowledge: [...knowledgeDecisions.value.values()],
  tvs: [...selectedTvs.value],
  images: [...selectedImages.value],
  plugins: [...pluginDecisions.value.values()],
  configMerge: configDiff.value?.available ? {
    add: configAddDecisions.value,
    conflicts: configConflictDecisions.value,
  } : undefined,
  copyVectors: copyVectors.value,
}))

const planSummary = computed(() => {
  const p = plan.value
  return [
    { label: 'Agents', value: (p.agents || []).length },
    { label: 'Dailynote', value: (p.dailynotes || []).filter(d => d.targetType !== 'skip').length },
    { label: 'Knowledge', value: (p.knowledge || []).filter(k => k.targetType !== 'skip').length },
    { label: 'TVS', value: (p.tvs || []).length },
    { label: 'Images', value: (p.images || []).length },
    { label: 'Plugins', value: (p.plugins || []).length },
    {
      label: 'Config',
      value: p.configMerge
        ? (Object.values(p.configMerge.add).filter(Boolean).length + Object.keys(p.configMerge.conflicts).length)
        : 0,
    },
  ]
})

// ======== Step 5: Execute ========

function doExecute() {
  if (runningStatus.value.running) {
    alert('已有迁移任务在运行，不能重复启动')
    return
  }
  executing.value = true
  logLines.value = []
  jobId.value = null
  doneSummary.value = null
  step.value = 5

  abortHandle.value = executeMigration(plan.value, {
    onOpen: id => { jobId.value = id },
    onLog: evt => {
      logLines.value.push(evt)
      if (logLines.value.length > 2000) logLines.value = logLines.value.slice(-1500)
    },
    onDone: summary => {
      doneSummary.value = summary as unknown as Record<string, unknown>
      executing.value = false
      refreshStatus()
      refreshBackups()
    },
    onFatal: err => {
      logLines.value.push({ level: 'error', stage: 'fatal', message: err, ts: new Date().toISOString() })
      executing.value = false
      refreshStatus()
    },
  })
}

async function doCancel() {
  if (!jobId.value) return
  if (!confirm('取消迁移任务？当前步骤完成后将停止。')) return
  try {
    await cancel(jobId.value)
    logLines.value.push({ level: 'warn', stage: 'cancel', message: '取消请求已发送', ts: new Date().toISOString() })
  } catch (e) { console.warn(e) }
}

async function manualBackup() {
  await createBackup('manual')
  await refreshBackups()
}

// ======== helpers ========

function toggleAgent(name: string) {
  const s = new Set(selectedAgents.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedAgents.value = s
}
function toggleAllAgents(v: boolean) {
  selectedAgents.value = v && scanResult.value
    ? new Set(scanResult.value.agents.map(a => a.name))
    : new Set()
}
function toggleTvs(name: string) {
  const s = new Set(selectedTvs.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedTvs.value = s
}
function toggleAllTvs(v: boolean) {
  selectedTvs.value = v && scanResult.value
    ? new Set(scanResult.value.tvs.map(t => t.name))
    : new Set()
}
function toggleImage(name: string) {
  const s = new Set(selectedImages.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedImages.value = s
}
function updateDailynote(name: string, patch: Partial<DailynoteDecision>) {
  const cur = dailynoteDecisions.value.get(name)
  if (!cur) return
  const m = new Map(dailynoteDecisions.value)
  m.set(name, { ...cur, ...patch })
  dailynoteDecisions.value = m
}
function updatePlugin(name: string, patch: Partial<PluginInstallDecision>) {
  const cur = pluginDecisions.value.get(name)
  if (!cur) return
  const m = new Map(pluginDecisions.value)
  m.set(name, { ...cur, ...patch })
  pluginDecisions.value = m
}
function togglePlugin(name: string) {
  const m = new Map(pluginDecisions.value)
  if (m.has(name)) m.delete(name)
  else {
    const pm = pluginMatch.value?.installable.find(p => p.name === name)
    if (pm) m.set(name, {
      name,
      source: pm.source,
      mergeConfig: pm.hasUpstreamConfig,
      copyVectorStore: false,
      enable: pm.upstreamEnabled,
    })
  }
  pluginDecisions.value = m
}

function stepLabel(n: Step): string {
  return { 1: '选择源目录', 2: '勾选数据', 3: '配置合并', 4: '预览确认', 5: '执行迁移' }[n]
}
</script>

<template>
  <div class="migration-view">
    <!-- 头部 -->
    <header class="mig-header">
      <div class="title-block">
        <span class="material-symbols-outlined icon">swap_horiz</span>
        <div>
          <h1>上游 VCPToolBox 迁移</h1>
          <p class="sub">一键将上游目录结构的数据迁移到 Junior</p>
        </div>
      </div>
      <div class="actions">
        <button v-if="runningStatus.running" class="btn btn-danger" @click="doCancel">
          <span class="material-symbols-outlined">stop</span> 取消运行中任务
        </button>
        <button class="btn btn-secondary" @click="manualBackup" :disabled="executing">
          <span class="material-symbols-outlined">backup</span> 手动备份
        </button>
      </div>
    </header>

    <!-- 进度条 -->
    <nav class="stepper">
      <button v-for="n in [1,2,3,4,5] as Step[]" :key="n"
        class="step" :class="{ active: step === n, done: step > n }"
        :disabled="n > step && !scanResult?.valid"
        @click="step = n">
        <span class="num">{{ n }}</span>
        <span class="label">{{ stepLabel(n) }}</span>
      </button>
    </nav>

    <!-- Step 1: 选源 -->
    <section v-if="step === 1" class="panel">
      <h2>1. 选择迁移源</h2>
      <p class="hint">
        支持三种源：本地 VCPToolBox 目录、上传的 VCPBackUp zip 包、或从坚果云直接拉取。
      </p>

      <!-- 源模式切换器 -->
      <div class="source-mode-tabs">
        <button class="mode-tab" :class="{ active: sourceMode === 'dir' }" @click="switchMode('dir')">
          <span class="material-symbols-outlined">folder</span>
          <div class="mode-text">
            <strong>本地目录</strong>
            <small>已解压的 VCPToolBox 根目录</small>
          </div>
        </button>
        <button class="mode-tab" :class="{ active: sourceMode === 'upload' }" @click="switchMode('upload')">
          <span class="material-symbols-outlined">upload_file</span>
          <div class="mode-text">
            <strong>上传 VCPBackUp 包</strong>
            <small>VCPServer_Backup_*.zip 或 VCP_Full_Backup.zip</small>
          </div>
        </button>
        <button class="mode-tab" :class="{ active: sourceMode === 'webdav' }" @click="switchMode('webdav')">
          <span class="material-symbols-outlined">cloud_download</span>
          <div class="mode-text">
            <strong>从坚果云拉取</strong>
            <small>WebDAV 自动同步</small>
          </div>
        </button>
      </div>

      <!-- 本地目录模式 -->
      <div v-if="sourceMode === 'dir'" class="mode-panel">
        <p class="hint">输入已解压的 VCPToolBox 根目录绝对路径，例如 <code>D:\path\to\VCPToolBox</code>。</p>
        <div class="path-input">
          <input v-model="sourcePath" placeholder="上游 VCPToolBox 根目录绝对路径" @keyup.enter="doScan" />
          <button class="btn btn-primary" @click="doScan" :disabled="scanning || !sourcePath.trim()">
            {{ scanning ? '扫描中...' : '扫描' }}
          </button>
        </div>
      </div>

      <!-- 上传模式 -->
      <div v-if="sourceMode === 'upload'" class="mode-panel">
        <p class="hint">从上游 <a href="https://github.com/lioensky/VCPBcakUpDEV" target="_blank">VCPBackUp</a> 产出的 zip 可直接上传，系统自动识别格式并解压。</p>
        <div class="upload-zone">
          <input type="file" accept=".zip" id="vcpbackup-file" @change="onFilePick" :disabled="uploading" />
          <label for="vcpbackup-file" class="upload-dropzone" :class="{ disabled: uploading }">
            <span class="material-symbols-outlined big">cloud_upload</span>
            <div>
              <strong v-if="selectedFile">{{ selectedFile.name }}</strong>
              <strong v-else>点击选择 zip 文件</strong>
              <small v-if="selectedFile">{{ formatBytes(selectedFile.size) }}</small>
              <small v-else>支持 VCPServer_Backup_*.zip / VCP_Full_Backup*.zip</small>
            </div>
          </label>
          <button class="btn btn-primary" @click="doUpload" :disabled="!selectedFile || uploading">
            <span class="material-symbols-outlined">upload</span>
            {{ uploading ? '上传中...' : '上传并扫描' }}
          </button>
        </div>

        <div v-if="uploadedItems.length > 0" class="prev-uploads">
          <h3>最近上传</h3>
          <div v-for="it in uploadedItems.slice(0, 5)" :key="it.filename" class="upload-row">
            <div class="upload-main">
              <span class="material-symbols-outlined">archive</span>
              <strong>{{ it.filename }}</strong>
              <span class="muted">{{ formatBytes(it.size) }} · {{ new Date(it.createdAt).toLocaleString() }}</span>
            </div>
            <div class="upload-actions">
              <button class="btn-tiny" @click="usePrevUpload(it)">复用扫描</button>
              <button class="btn-tiny danger" @click="doDeleteUpload(it)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- WebDAV 模式 -->
      <div v-if="sourceMode === 'webdav'" class="mode-panel">
        <div v-if="!webdavConfig?.enabled" class="alert alert-warn">
          <span class="material-symbols-outlined">warning</span>
          坚果云同步未启用。请在 <code>config.env</code> 设置 <code>JianguoyunDEV=true</code> 及账号密码，然后重启服务。
        </div>
        <div v-else>
          <div class="webdav-status">
            <div class="webdav-config-info">
              <span>📡 {{ webdavConfig.url }}{{ webdavConfig.basePath }}</span>
              <span class="muted">账号 {{ webdavConfig.userConfigured ? '✓' : '✗' }} · 密码 {{ webdavConfig.passwordConfigured ? '✓' : '✗' }}</span>
            </div>
            <div class="webdav-actions">
              <button class="btn-tiny" @click="doTestWebdav" :disabled="webdavTesting">
                {{ webdavTesting ? '测试中...' : '测试连接' }}
              </button>
              <button class="btn-tiny" @click="refreshWebdavList" :disabled="webdavLoading">
                {{ webdavLoading ? '加载中...' : '刷新列表' }}
              </button>
            </div>
          </div>

          <div v-if="webdavTestResult" class="alert" :class="webdavTestResult.ok ? 'alert-success' : 'alert-error'">
            {{ webdavTestResult.ok ? '✅ 连接成功' : `❌ ${webdavTestResult.error}` }}
          </div>

          <div v-if="webdavItems.length > 0" class="webdav-list">
            <h3>远程备份</h3>
            <div v-for="it in webdavItems" :key="it.filename" class="webdav-row">
              <div class="webdav-main">
                <span class="material-symbols-outlined">backup</span>
                <strong>{{ it.filename }}</strong>
                <span class="muted">{{ formatBytes(it.size) }} · {{ it.lastModified || '未知时间' }}</span>
              </div>
              <button class="btn btn-primary btn-small"
                @click="doDownloadWebdav(it)"
                :disabled="webdavDownloading || scanning">
                <span class="material-symbols-outlined">download</span>
                下载并扫描
              </button>
            </div>
          </div>
          <div v-else-if="!webdavLoading" class="muted">暂无远程备份，可先导出并上传（备份管理页）</div>
        </div>
      </div>

      <!-- 扫描结果提示 -->
      <div v-if="scanning" class="alert">
        <span class="material-symbols-outlined">hourglass_top</span>
        正在扫描源<span v-if="sourceLabel">（{{ sourceLabel }}）</span>...
      </div>
      <div v-if="scanResult && !scanResult.valid" class="alert alert-error">
        ❌ {{ scanResult.reason }}
      </div>
      <div v-if="scanResult?.valid && scanResult.sourceType" class="alert alert-success">
        ✅ 已识别 {{ sourceTypeLabel(scanResult.sourceType) }}<span v-if="sourceLabel">（{{ sourceLabel }}）</span>
        · Agents {{ scanResult.summary.agents }} · 日记 {{ scanResult.summary.dailynotes }}
        <span v-if="scanResult.summary.knowledge"> · 知识 {{ scanResult.summary.knowledge }}</span>
        · 插件 {{ scanResult.summary.plugins }}
      </div>

      <!-- 🪄 智能推荐按钮：扫描通过即可一键生成 -->
      <div v-if="scanResult?.valid" class="auto-plan-cta">
        <div class="cta-text">
          <span class="material-symbols-outlined big">auto_awesome</span>
          <div>
            <strong>🪄 智能推荐：一键生成默认迁移方案</strong>
            <small>Agent 全迁 · 日记/知识按 Agent 同名自动分流 · 插件本地优先远程兜底 · 配置不改（可回 Step 3 手动处理）</small>
          </div>
        </div>
        <button class="btn btn-primary btn-large" @click="doAutoPlan" :disabled="autoPlanning">
          {{ autoPlanning ? '生成中...' : '🪄 智能推荐（直接跳预览）' }}
        </button>
      </div>

      <!-- 备份历史 -->
      <div v-if="backups.length > 0" class="backup-list">
        <h3>已有 Junior 备份（用于回滚）</h3>
        <ul>
          <li v-for="b in backups.slice(0, 5)" :key="b.name">
            <span class="material-symbols-outlined">archive</span>
            {{ b.name }}
            <span class="muted">({{ b.sizeHuman }}, {{ new Date(b.createdAt).toLocaleString() }})</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Step 2: 勾选数据 -->
    <section v-if="step === 2 && scanResult?.valid" class="panel">
      <h2>2. 勾选要迁移的数据</h2>
      <div class="tabs">
        <button v-for="t in (['agents','dailynote','tvs','images','plugins'] as const)" :key="t"
          class="tab" :class="{ active: tab === t }" @click="tab = t">
          {{ { agents:'Agents', dailynote:'日记', tvs:'TVS', images:'图片', plugins:'插件' }[t] }}
          <span class="count">{{ scanResult.summary[t === 'agents' ? 'agents' : t === 'dailynote' ? 'dailynotes' : t === 'tvs' ? 'tvs' : t === 'images' ? 'images' : 'plugins'] }}</span>
        </button>
      </div>

      <!-- Agents Tab -->
      <div v-show="tab === 'agents'" class="tab-panel">
        <div class="tab-header">
          <button class="btn-tiny" @click="toggleAllAgents(true)">全选</button>
          <button class="btn-tiny" @click="toggleAllAgents(false)">全不选</button>
          <span class="muted">已选 {{ selectedAgents.size }} / {{ scanResult.agents.length }}</span>
        </div>
        <div class="grid grid-3">
          <label v-for="a in scanResult.agents" :key="a.name" class="card" :class="{ selected: selectedAgents.has(a.name) }">
            <input type="checkbox" :checked="selectedAgents.has(a.name)" @change="toggleAgent(a.name)" />
            <div>
              <strong>{{ a.name }}</strong>
              <div class="muted">{{ formatBytes(a.size) }}</div>
              <div class="path-hint">→ Agent/{{ a.name }}/{{ a.name }}.txt</div>
            </div>
          </label>
        </div>
      </div>

      <!-- Dailynote Tab -->
      <div v-show="tab === 'dailynote'" class="tab-panel">
        <p class="hint">每个上游日记子目录可选迁移到「个人日记（某 Agent）」或「公共知识库」，或跳过。</p>
        <div class="dailynote-list">
          <div v-for="dn in scanResult.dailynotes" :key="dn.name" class="dn-row">
            <div class="dn-main">
              <strong>{{ dn.name }}</strong>
              <div class="muted">{{ dn.fileCount }} 文件, {{ formatBytes(dn.size) }}</div>
            </div>
            <select :value="dailynoteDecisions.get(dn.name)?.targetType"
              @change="e => updateDailynote(dn.name, { targetType: (e.target as HTMLSelectElement).value as 'personal' | 'public' | 'skip' })">
              <option value="personal">→ 个人日记</option>
              <option value="public">→ 公共知识</option>
              <option value="skip">跳过</option>
            </select>
            <template v-if="dailynoteDecisions.get(dn.name)?.targetType === 'personal'">
              <select :value="dailynoteDecisions.get(dn.name)?.agentName"
                @change="e => updateDailynote(dn.name, { agentName: (e.target as HTMLSelectElement).value })">
                <option v-for="a in scanResult.agents" :key="a.name" :value="a.name">{{ a.name }}</option>
              </select>
            </template>
            <template v-if="dailynoteDecisions.get(dn.name)?.targetType === 'public'">
              <input :value="dailynoteDecisions.get(dn.name)?.publicDirName"
                @input="e => updateDailynote(dn.name, { publicDirName: (e.target as HTMLInputElement).value })"
                placeholder="knowledge/ 下的目录名" />
            </template>
          </div>
        </div>
      </div>

      <!-- TVS Tab -->
      <div v-show="tab === 'tvs'" class="tab-panel">
        <div class="tab-header">
          <button class="btn-tiny" @click="toggleAllTvs(true)">全选</button>
          <button class="btn-tiny" @click="toggleAllTvs(false)">全不选</button>
          <span class="muted">已选 {{ selectedTvs.size }} / {{ scanResult.tvs.length }}</span>
        </div>
        <div class="grid grid-2">
          <label v-for="t in scanResult.tvs" :key="t.name" class="card" :class="{ selected: selectedTvs.has(t.name) }">
            <input type="checkbox" :checked="selectedTvs.has(t.name)" @change="toggleTvs(t.name)" />
            <div>
              <strong>{{ t.name }}</strong>
              <div class="muted">{{ formatBytes(t.size) }}</div>
            </div>
          </label>
        </div>
      </div>

      <!-- Images Tab -->
      <div v-show="tab === 'images'" class="tab-panel">
        <div class="tab-header">
          <span class="muted">已选 {{ selectedImages.size }} / {{ scanResult.images.length }}</span>
        </div>
        <div class="grid grid-2">
          <label v-for="img in scanResult.images" :key="img.name" class="card" :class="{ selected: selectedImages.has(img.name) }">
            <input type="checkbox" :checked="selectedImages.has(img.name)" @change="toggleImage(img.name)" />
            <div>
              <strong>{{ img.name }}</strong>
              <div class="muted">{{ img.fileCount }} 文件, {{ formatBytes(img.size) }}</div>
            </div>
          </label>
        </div>
      </div>

      <!-- Plugins Tab -->
      <div v-show="tab === 'plugins'" class="tab-panel">
        <div v-if="!pluginMatch" class="muted">插件匹配中...</div>
        <div v-else>
          <div v-if="pluginMatch.installable.length > 0" class="sub-section">
            <h3>✅ 可自动安装 ({{ pluginMatch.installable.length }})</h3>
            <p class="muted small">
              本地仓库：{{ pluginMatch.installable.filter(p => p.source === 'localRepo').length }} 个 ·
              远程商店：{{ pluginMatch.installable.filter(p => p.source === 'remoteStore').length }} 个
            </p>
            <div class="plugin-list">
              <div v-for="p in pluginMatch.installable" :key="p.name" class="plugin-row"
                :class="{ selected: pluginDecisions.has(p.name) }">
                <label class="plugin-toggle">
                  <input type="checkbox" :checked="pluginDecisions.has(p.name)" @change="togglePlugin(p.name)" />
                  <strong>{{ p.name }}</strong>
                  <span class="source-badge" :class="p.source">
                    {{ p.source === 'localRepo' ? '📁 本地' : '🌐 远程' }}
                  </span>
                </label>
                <div class="muted">
                  上游 {{ formatBytes(p.upstreamSize) }}
                  <span v-if="p.source === 'localRepo' && p.repoSize"> / 本地 {{ formatBytes(p.repoSize) }}</span>
                  <span v-if="p.source === 'remoteStore' && p.remoteVersion"> / 远程 v{{ p.remoteVersion }}</span>
                </div>
                <div v-if="p.source === 'remoteStore' && p.remoteDescription" class="muted small">
                  {{ p.remoteDescription }}
                </div>
                <div v-if="pluginDecisions.has(p.name)" class="plugin-opts">
                  <label><input type="checkbox"
                    :checked="pluginDecisions.get(p.name)?.mergeConfig"
                    :disabled="!p.hasUpstreamConfig"
                    @change="e => updatePlugin(p.name, { mergeConfig: (e.target as HTMLInputElement).checked })" />
                    合并上游 config.env</label>
                  <label><input type="checkbox"
                    :checked="pluginDecisions.get(p.name)?.copyVectorStore"
                    @change="e => updatePlugin(p.name, { copyVectorStore: (e.target as HTMLInputElement).checked })" />
                    迁移向量数据</label>
                  <label><input type="checkbox"
                    :checked="pluginDecisions.get(p.name)?.enable"
                    @change="e => updatePlugin(p.name, { enable: (e.target as HTMLInputElement).checked })" />
                    启用</label>
                </div>
              </div>
            </div>
          </div>

          <div v-if="pluginMatch.builtin.length > 0" class="sub-section">
            <h3>🔷 Junior 内置核心 ({{ pluginMatch.builtin.length }})</h3>
            <p class="muted small">这些插件 Junior 本体已内置，不需要从上游迁移。</p>
            <div class="chip-list">
              <span v-for="b in pluginMatch.builtin" :key="b.name" class="chip">{{ b.name }}</span>
            </div>
          </div>

          <div v-if="pluginMatch.notAvailable.length > 0" class="sub-section">
            <h3>⚠️ 本体/本地/远程均无 ({{ pluginMatch.notAvailable.length }})</h3>
            <p class="muted small">这些上游插件在 Junior 的任何来源都没有，自动跳过。</p>
            <div class="chip-list">
              <span v-for="n in pluginMatch.notAvailable" :key="n.name" class="chip warn" :title="n.reason">{{ n.name }}</span>
            </div>
          </div>
        </div>

        <div class="sub-section" style="margin-top: 1rem">
          <label><input type="checkbox" v-model="copyVectors" /> 迁移独立向量索引（modules/VectorStore 等）</label>
        </div>
      </div>

      <div class="step-nav">
        <button class="btn btn-secondary" @click="step = 1">← 上一步</button>
        <button class="btn btn-primary" @click="goToConfig">下一步: 配置合并 →</button>
      </div>
    </section>

    <!-- Step 3: Config merge -->
    <section v-if="step === 3" class="panel">
      <h2>3. config.env 字段合并</h2>
      <div v-if="!configDiff?.available" class="alert">上游 config.env 不可用或跳过</div>
      <div v-else>
        <p class="hint">基于 <code>{{ configDiff.juniorSource }}</code>。冲突字段默认保留 Junior 值（更安全）。</p>

        <div v-if="configDiff.addedFromSource.length > 0" class="sub-section">
          <h3>➕ 从上游新增 ({{ configDiff.addedFromSource.length }})</h3>
          <div class="cfg-table">
            <div v-for="item in configDiff.addedFromSource" :key="item.key" class="cfg-row">
              <label>
                <input type="checkbox" v-model="configAddDecisions[item.key]" />
                <code>{{ item.key }}</code>
              </label>
              <div class="val source">{{ item.sourceValue || '(空)' }}</div>
            </div>
          </div>
        </div>

        <div v-if="configDiff.conflicts.length > 0" class="sub-section">
          <h3>⚡ 冲突（{{ configDiff.conflicts.length }}）</h3>
          <div class="cfg-conflicts">
            <div v-for="c in configDiff.conflicts" :key="c.key" class="conflict-row">
              <code>{{ c.key }}</code>
              <div class="conflict-vals">
                <label :class="{ selected: configConflictDecisions[c.key] === 'use_junior' }">
                  <input type="radio" :value="'use_junior'" v-model="configConflictDecisions[c.key]" />
                  保留 Junior: <span class="val">{{ c.juniorValue || '(空)' }}</span>
                </label>
                <label :class="{ selected: configConflictDecisions[c.key] === 'use_upstream' }">
                  <input type="radio" :value="'use_upstream'" v-model="configConflictDecisions[c.key]" />
                  使用上游: <span class="val">{{ c.sourceValue || '(空)' }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="muted small">
          相同值 {{ configDiff.sameValue.length }} 个（自动跳过），仅 Junior 独有 {{ configDiff.juniorOnly.length }} 个（保留）。
        </div>
      </div>

      <div class="step-nav">
        <button class="btn btn-secondary" @click="step = 2">← 上一步</button>
        <button class="btn btn-primary" @click="step = 4">下一步: 预览 →</button>
      </div>
    </section>

    <!-- Step 4: 预览 -->
    <section v-if="step === 4" class="panel">
      <h2>4. 执行计划预览</h2>
      <div class="summary-cards">
        <div v-for="s in planSummary" :key="s.label" class="summary-card">
          <div class="summary-num">{{ s.value }}</div>
          <div class="summary-label">{{ s.label }}</div>
        </div>
      </div>

      <div class="alert alert-warn">
        <span class="material-symbols-outlined">warning</span>
        迁移将**覆盖**同名 Agent/日记/TVS/image。开始前会自动 zip 备份 Junior 当前状态到
        <code>data/migration-backup/</code>。
      </div>

      <div class="step-nav">
        <button class="btn btn-secondary" @click="step = 3">← 上一步</button>
        <button class="btn btn-primary large" @click="doExecute" :disabled="runningStatus.running">
          <span class="material-symbols-outlined">play_arrow</span>
          开始迁移
        </button>
      </div>
    </section>

    <!-- Step 5: 执行日志 -->
    <section v-if="step === 5" class="panel">
      <h2>5. {{ executing ? '执行中...' : (doneSummary ? '完成' : '...') }}</h2>
      <div class="log-panel">
        <div v-for="(l, idx) in logLines" :key="idx" class="log-line" :class="l.level">
          <span class="ts">{{ l.ts.slice(11, 19) }}</span>
          <span class="stage">[{{ l.stage }}]</span>
          <span class="msg">{{ l.message }}</span>
        </div>
      </div>
      <div v-if="doneSummary" class="done-summary">
        <h3>执行结果</h3>
        <pre>{{ JSON.stringify(doneSummary, null, 2) }}</pre>
        <button class="btn btn-primary" @click="step = 1; scanResult = null;">再次迁移</button>
      </div>
      <div v-if="executing" class="step-nav">
        <button class="btn btn-danger" @click="doCancel">取消</button>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
// ============================================================
// 🌸 Junior 玫粉主题 · 玻璃态 MigrationView
// ============================================================
.migration-view {
  padding: 20px 24px 24px;
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

// —— 标题栏 ——
.mig-header {
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

// —— 进度条 ——
.stepper {
  display: flex;
  gap: 8px;
  padding: 10px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);

  .step {
    flex: 1;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.2s ease;
    color: var(--secondary-text);
    font-weight: 500;

    &:hover:not(:disabled) {
      background: var(--accent-bg);
      color: var(--primary-text);
    }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
    &.active {
      background: linear-gradient(135deg, rgba(212,116,142,0.14), rgba(212,116,142,0.05));
      border-color: rgba(212,116,142,0.35);
      color: var(--primary-text);
      box-shadow: 0 2px 8px rgba(212,116,142,0.12);
    }
    &.done { color: var(--memory-color); }

    .num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 50%;
      background: linear-gradient(135deg, #d4748e, #c4647e);
      color: #fff;
      font-size: 12px; font-weight: 700;
      box-shadow: 0 2px 6px rgba(212,116,142,0.3);
    }
    &.done .num { background: linear-gradient(135deg, #6dbb8a, #5aa878); box-shadow: 0 2px 6px rgba(109,187,138,0.3); }
    &:not(.active):not(.done) .num { background: rgba(138,116,144,0.22); color: var(--secondary-text); box-shadow: none; }
    .label { font-size: 13px; }
  }
}

.panel {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);

  h2 { margin: 0 0 6px; font-size: 17px; font-weight: 600; color: var(--primary-text); }
  .hint { color: var(--secondary-text); font-size: 13px; margin: 0 0 14px; line-height: 1.6; }
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

.path-input {
  display: flex; gap: 8px;
  input {
    flex: 1;
    padding: 9px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    color: var(--primary-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    transition: border-color 0.15s, box-shadow 0.15s;
    &:focus { outline: none; border-color: var(--button-bg); box-shadow: 0 0 0 3px rgba(212,116,142,0.15); }
  }
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
  white-space: nowrap;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.large { padding: 10px 20px; font-size: 14px; }

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
  &.btn-danger {
    background: linear-gradient(135deg, #d95555, var(--danger-hover-bg));
    color: #fff;
    box-shadow: 0 2px 8px rgba(217,85,85,0.25);
    &:hover:not(:disabled) { transform: translateY(-1px); }
  }
}

.btn-tiny {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  background: rgba(255,255,255,0.6);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--primary-text);
  display: inline-flex; align-items: center; gap: 4px;
  transition: all 0.15s;
  .material-symbols-outlined { font-size: 14px; }
  &:hover:not(:disabled) { background: var(--accent-bg); border-color: rgba(212,116,142,0.35); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

// —— 提示条 ——
.alert {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  margin: 12px 0;
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

// ========= 源模式选择器 =========
.source-mode-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 4px 0 14px;

  .mode-tab {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(255,255,255,0.4);
    border: 1.5px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
    color: var(--primary-text);

    &:hover {
      background: var(--accent-bg);
      border-color: rgba(212,116,142,0.35);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(212,116,142,0.1);
    }
    &.active {
      border-color: var(--button-bg);
      background: linear-gradient(135deg, rgba(212,116,142,0.12), rgba(212,116,142,0.04));
      box-shadow: 0 2px 10px rgba(212,116,142,0.18);
    }

    .material-symbols-outlined {
      font-size: 28px;
      color: var(--highlight-text);
      background: rgba(212,116,142,0.1);
      padding: 6px;
      border-radius: var(--radius-sm);
    }
    .mode-text { display: flex; flex-direction: column; gap: 2px; }
    strong { font-size: 13px; font-weight: 600; }
    small { font-size: 11.5px; color: var(--secondary-text); }
  }
}
.mode-panel { margin-top: 8px; }

// ========= 上传 UI =========
.upload-zone {
  display: flex;
  flex-direction: column;
  gap: 10px;
  input[type=file] { display: none; }

  .upload-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 34px 20px;
    border: 2px dashed var(--border-color);
    border-radius: var(--radius-lg);
    background: rgba(255,255,255,0.35);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover:not(.disabled) {
      border-color: var(--button-bg);
      background: var(--accent-bg);
      transform: translateY(-2px);
    }
    &.disabled { opacity: 0.5; cursor: not-allowed; }

    .material-symbols-outlined.big {
      font-size: 44px;
      color: var(--highlight-text);
      background: rgba(212,116,142,0.1);
      padding: 10px;
      border-radius: 50%;
    }
    div { text-align: center; }
    strong { display: block; font-size: 14px; color: var(--primary-text); }
    small { display: block; color: var(--secondary-text); font-size: 12px; margin-top: 4px; }
  }
}

.prev-uploads {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
  h3 { font-size: 13px; margin: 0 0 8px; color: var(--primary-text); font-weight: 600; }

  .upload-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.4);
    margin-bottom: 5px;
    transition: background 0.15s;
    &:hover { background: var(--accent-bg); }

    .upload-main {
      display: flex; gap: 8px; align-items: center;
      .material-symbols-outlined { color: var(--highlight-text); }
      strong { font-size: 13px; color: var(--primary-text); }
      .muted { font-size: 11.5px; color: var(--secondary-text); margin-left: 6px; }
    }
    .upload-actions { display: flex; gap: 6px; }
  }
}

// ========= WebDAV UI =========
.webdav-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(255,255,255,0.5);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 10px;

  .webdav-config-info {
    display: flex; flex-direction: column; gap: 2px;
    span { font-size: 13px; color: var(--primary-text); }
    .muted { font-size: 11.5px; color: var(--secondary-text); }
  }
  .webdav-actions { display: flex; gap: 6px; }
}

.webdav-list {
  h3 { font-size: 13px; margin: 0 0 8px; color: var(--primary-text); font-weight: 600; }
  .webdav-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 9px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.4);
    margin-bottom: 5px;
    transition: background 0.15s;
    &:hover { background: var(--accent-bg); }

    .webdav-main {
      display: flex; gap: 8px; align-items: center;
      .material-symbols-outlined { color: var(--highlight-text); }
      strong { font-size: 13px; color: var(--primary-text); }
      .muted { font-size: 11.5px; color: var(--secondary-text); margin-left: 6px; }
    }
  }
}

.btn.btn-small { padding: 5px 12px; font-size: 12px; }
.btn-tiny.danger {
  color: var(--danger-color);
  border-color: rgba(217,85,85,0.25);
  background: rgba(217,85,85,0.06);
  &:hover:not(:disabled) { background: rgba(217,85,85,0.12); border-color: rgba(217,85,85,0.45); }
}

.backup-list {
  margin-top: 16px;
  h3 { font-size: 14px; margin: 0 0 8px; color: var(--primary-text); font-weight: 600; }
  ul { padding: 0; list-style: none; margin: 0; }
  li {
    padding: 7px 10px;
    font-size: 12.5px;
    display: flex; gap: 8px; align-items: center;
    border-radius: var(--radius-sm);
    &:hover { background: var(--accent-bg); }
    .material-symbols-outlined { font-size: 16px; color: var(--highlight-text); }
  }
  .muted { color: var(--secondary-text); }
}

// —— 内部 tabs（agents/dailynote/tvs/plugins） ——
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  padding: 4px;
  background: rgba(255,255,255,0.4);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);

  .tab {
    padding: 7px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--secondary-text);
    font-weight: 500;
    transition: all 0.15s;
    display: inline-flex; align-items: center; gap: 4px;

    &:hover:not(.active) { background: var(--accent-bg); color: var(--primary-text); }
    &.active {
      background: linear-gradient(135deg, var(--button-bg), var(--button-hover-bg));
      color: #fff;
      box-shadow: 0 2px 6px rgba(212,116,142,0.28);
    }
    .count {
      margin-left: 4px;
      padding: 1px 7px;
      background: rgba(255,255,255,0.4);
      border-radius: var(--radius-pill);
      font-size: 11px;
      font-weight: 600;
    }
    &:not(.active) .count { background: rgba(138,116,144,0.15); color: var(--secondary-text); }
  }
}

.tab-panel { min-height: 220px; }

.tab-header {
  display: flex; gap: 8px; align-items: center;
  margin-bottom: 10px;
  .muted { color: var(--secondary-text); font-size: 13px; margin-left: auto; }
}

.grid {
  display: grid; gap: 8px;
  &.grid-2 { grid-template-columns: repeat(2, 1fr); }
  &.grid-3 { grid-template-columns: repeat(3, 1fr); }
}

// —— 选择卡片（Agent / TVS / 图片）——
.card {
  display: flex; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: rgba(255,255,255,0.4);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover { background: var(--accent-bg); border-color: rgba(212,116,142,0.3); }
  &.selected {
    background: linear-gradient(135deg, rgba(212,116,142,0.12), rgba(212,116,142,0.04));
    border-color: var(--button-bg);
    box-shadow: 0 2px 8px rgba(212,116,142,0.15);
  }
  input[type=checkbox] {
    margin-top: 3px;
    accent-color: var(--button-bg);
  }
  strong { font-size: 13px; color: var(--primary-text); }
  .muted { font-size: 11.5px; color: var(--secondary-text); }
  .path-hint { font-size: 11px; color: var(--secondary-text); font-family: ui-monospace, monospace; opacity: 0.75; }
}

// —— 日记分流行 ——
.dailynote-list {
  display: flex; flex-direction: column; gap: 4px;
  .dn-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1.5fr;
    gap: 10px;
    align-items: center;
    padding: 9px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.35);
    transition: background 0.15s;
    &:hover { background: var(--accent-bg); }
    .dn-main strong { font-size: 13px; color: var(--primary-text); }
    .dn-main .muted { font-size: 11.5px; color: var(--secondary-text); }
    select, input {
      padding: 6px 10px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--input-bg);
      color: var(--primary-text);
      font-size: 12.5px;
      transition: border-color 0.15s;
      &:focus { outline: none; border-color: var(--button-bg); }
    }
  }
}

.plugin-list { display: flex; flex-direction: column; gap: 5px; }
.plugin-row {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: rgba(255,255,255,0.4);
  transition: all 0.15s;
  &:hover { background: var(--accent-bg); }
  &.selected {
    background: linear-gradient(135deg, rgba(212,116,142,0.12), rgba(212,116,142,0.04));
    border-color: var(--button-bg);
    box-shadow: 0 2px 8px rgba(212,116,142,0.15);
  }
  .plugin-toggle {
    display: flex; gap: 8px; align-items: center;
    color: var(--primary-text); font-size: 13px;
    input[type=checkbox] { accent-color: var(--button-bg); }
  }
  .muted { font-size: 11.5px; color: var(--secondary-text); margin-top: 3px; }
  .plugin-opts {
    display: flex; gap: 14px; flex-wrap: wrap;
    margin-top: 6px; font-size: 12.5px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);
  }
}

.source-badge {
  display: inline-block;
  padding: 2px 9px;
  font-size: 11px;
  border-radius: var(--radius-pill);
  font-weight: 600;
  margin-left: 6px;
  letter-spacing: 0.3px;
  &.localRepo { background: rgba(109,187,138,0.15); color: #3e7d55; border: 1px solid rgba(109,187,138,0.3); }
  &.remoteStore { background: rgba(100,181,246,0.15); color: #1565c0; border: 1px solid rgba(100,181,246,0.3); }
}

// 🪄 智能推荐大按钮
.auto-plan-cta {
  margin-top: 14px;
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(212,116,142,0.14) 0%, rgba(248,187,208,0.25) 100%);
  border: 1.5px solid rgba(212,116,142,0.35);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  box-shadow: 0 4px 16px rgba(212,116,142,0.1);
  position: relative;
  overflow: hidden;
  &::before {
    content: '';
    position: absolute;
    top: -50%; right: -50%;
    width: 200px; height: 200px;
    background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
    pointer-events: none;
  }
  .cta-text {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 240px;
    position: relative; z-index: 1;
    .material-symbols-outlined.big {
      font-size: 36px;
      color: var(--highlight-text);
      background: rgba(255,255,255,0.5);
      padding: 8px;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(212,116,142,0.2);
    }
    strong { display: block; margin-bottom: 3px; color: #7a3349; font-size: 15px; font-weight: 600; }
    small { color: #8a5365; font-size: 12.5px; line-height: 1.6; }
  }
}

.btn-large {
  padding: 11px 22px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(212,116,142,0.35);
  position: relative; z-index: 1;
}

.chip-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.chip {
  padding: 3px 10px;
  background: rgba(212,116,142,0.1);
  border: 1px solid rgba(212,116,142,0.2);
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  color: var(--highlight-text);
  font-weight: 500;
  &.warn {
    background: rgba(255,152,0,0.12);
    border-color: rgba(255,152,0,0.3);
    color: #c55a00;
    cursor: help;
  }
}

.sub-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
  h3 { font-size: 14px; margin: 0 0 8px; color: var(--primary-text); font-weight: 600; }
  .small { font-size: 12px; }
}

.cfg-table, .cfg-conflicts {
  display: flex; flex-direction: column; gap: 5px;
  .cfg-row, .conflict-row {
    padding: 9px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.4);
  }
  code {
    background: transparent;
    font-weight: 600;
    color: var(--highlight-text);
  }
  .val { font-family: ui-monospace, monospace; color: var(--secondary-text); font-size: 12.5px; }
  .val.source { margin-top: 4px; }
}

.conflict-row {
  .conflict-vals {
    display: flex; flex-direction: column; gap: 5px;
    margin-top: 6px;
    label {
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s;
      font-size: 13px;
      &:hover { background: var(--accent-bg); }
      &.selected {
        background: linear-gradient(135deg, rgba(212,116,142,0.14), rgba(212,116,142,0.05));
        border: 1px solid rgba(212,116,142,0.3);
      }
    }
  }
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin: 14px 0;
  .summary-card {
    padding: 16px 14px;
    background: linear-gradient(135deg, rgba(255,255,255,0.5), rgba(212,116,142,0.04));
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    text-align: center;
    transition: transform 0.15s, box-shadow 0.15s;
    &:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(212,116,142,0.15); }
    .summary-num {
      font-size: 28px; font-weight: 700;
      background: linear-gradient(135deg, var(--button-bg), var(--button-hover-bg));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      line-height: 1.1;
    }
    .summary-label { font-size: 12.5px; color: var(--secondary-text); margin-top: 4px; }
  }
}

.step-nav {
  display: flex; justify-content: space-between; gap: 8px;
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--border-color);
}

// —— 执行日志 ——
.log-panel {
  background: linear-gradient(180deg, #1a1224 0%, #0f0a18 100%);
  color: #e8d5f0;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(212,116,142,0.2);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 500px;
  overflow-y: auto;
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.3);

  &::-webkit-scrollbar { width: 8px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(212,116,142,0.3); border-radius: 4px; }

  .log-line {
    padding: 2px 0;
    .ts { color: rgba(232,213,240,0.4); margin-right: 8px; font-size: 11px; }
    .stage { color: #c9a0d4; margin-right: 8px; font-weight: 600; }
    &.error .msg { color: #ff8a9b; }
    &.warn .msg { color: #ffb570; }
    &.info .msg { color: #b0e0b8; }
    &.done .msg { color: #6dbb8a; font-weight: 600; }
  }
}

.done-summary {
  margin-top: 14px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(109,187,138,0.08), rgba(109,187,138,0.02));
  border: 1px solid rgba(109,187,138,0.25);
  border-radius: var(--radius-md);

  h3 { margin: 0 0 8px; color: var(--primary-text); font-size: 14px; font-weight: 600; }
  pre {
    max-height: 300px;
    overflow: auto;
    font-size: 11.5px;
    background: rgba(255,255,255,0.5);
    padding: 10px;
    border-radius: var(--radius-sm);
    color: var(--primary-text);
    font-family: ui-monospace, monospace;
  }
}
</style>
