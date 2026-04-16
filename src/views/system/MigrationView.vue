<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  scanSource, diffConfig, matchPlugins, executeMigration,
  listBackups, getStatus, cancel, createBackup,
  formatBytes,
  type ScanResult, type ConfigDiff, type PluginMatch,
  type MigrationPlan, type SseLogEvent, type BackupItem,
  type DailynoteDecision, type PluginInstallDecision,
} from '@/api/migration'

type Step = 1 | 2 | 3 | 4 | 5

const step = ref<Step>(1)
const sourcePath = ref('')
const scanning = ref(false)
const scanResult = ref<ScanResult | null>(null)

// Step 2 — 选择状态
const selectedAgents = ref<Set<string>>(new Set())
const dailynoteDecisions = ref<Map<string, DailynoteDecision>>(new Map())
const selectedTvs = ref<Set<string>>(new Set())
const selectedImages = ref<Set<string>>(new Set())
const pluginMatch = ref<PluginMatch | null>(null)
const pluginDecisions = ref<Map<string, PluginInstallDecision>>(new Map())
const copyVectors = ref(true)

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

// ======== Step 1: Scan ========

async function doScan() {
  if (!sourcePath.value.trim()) return
  scanning.value = true
  scanResult.value = null
  try {
    const result = await scanSource(sourcePath.value.trim())
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

    // 调 match-plugins
    try {
      pluginMatch.value = await matchPlugins(result.plugins)
      const pm = new Map<string, PluginInstallDecision>()
      for (const p of pluginMatch.value.installable) {
        pm.set(p.name, {
          name: p.name,
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
    if (pm) m.set(name, { name, mergeConfig: pm.hasUpstreamConfig, copyVectorStore: false, enable: pm.upstreamEnabled })
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
      <h2>1. 选择上游 VCPToolBox 根目录</h2>
      <p class="hint">
        输入上游项目的本地绝对路径，例如 <code>D:\path\to\VCPToolBox</code>。
        系统将验证目录合法性（需包含 Plugin.js / Agent / TVStxt）。
      </p>
      <div class="path-input">
        <input v-model="sourcePath" placeholder="上游 VCPToolBox 根目录绝对路径" @keyup.enter="doScan" />
        <button class="btn btn-primary" @click="doScan" :disabled="scanning || !sourcePath.trim()">
          {{ scanning ? '扫描中...' : '扫描' }}
        </button>
      </div>

      <div v-if="scanResult && !scanResult.valid" class="alert alert-error">
        ❌ {{ scanResult.reason }}
      </div>

      <!-- 备份历史 -->
      <div v-if="backups.length > 0" class="backup-list">
        <h3>已有备份</h3>
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
            <h3>✅ 可从 Junior 插件仓库安装 ({{ pluginMatch.installable.length }})</h3>
            <div class="plugin-list">
              <div v-for="p in pluginMatch.installable" :key="p.name" class="plugin-row"
                :class="{ selected: pluginDecisions.has(p.name) }">
                <label class="plugin-toggle">
                  <input type="checkbox" :checked="pluginDecisions.has(p.name)" @change="togglePlugin(p.name)" />
                  <strong>{{ p.name }}</strong>
                </label>
                <div class="muted">上游 {{ formatBytes(p.upstreamSize) }} / 仓库 {{ formatBytes(p.repoSize) }}</div>
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

          <div v-if="pluginMatch.notInRepo.length > 0" class="sub-section">
            <h3>⚠️ Junior 不兼容 ({{ pluginMatch.notInRepo.length }})</h3>
            <p class="muted small">这些上游插件在 Junior 插件仓库中没有对应版本，跳过。</p>
            <div class="chip-list">
              <span v-for="n in pluginMatch.notInRepo" :key="n.name" class="chip warn" :title="n.reason">{{ n.name }}</span>
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
.migration-view {
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}
.mig-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  .title-block {
    display: flex; gap: 1rem; align-items: center;
    .icon { font-size: 2.5rem; color: var(--color-primary, #e91e63); }
    h1 { margin: 0; font-size: 1.5rem; }
    .sub { margin: 0; color: var(--color-text-muted, #888); font-size: 0.9rem; }
  }
  .actions { display: flex; gap: 0.5rem; }
}
.stepper {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  padding: 0.5rem;
  background: var(--color-surface, #fff);
  border-radius: 8px;
  .step {
    flex: 1;
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: 1px solid var(--color-border, #eee);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    &:hover:not(:disabled) { background: var(--color-hover, #fafafa); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
    &.active { background: var(--color-primary-bg, #fce4ec); border-color: var(--color-primary, #e91e63); }
    &.done { color: var(--color-success, #4caf50); }
    .num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%;
      background: var(--color-primary, #e91e63); color: white;
      font-size: 0.8rem; font-weight: bold;
    }
    &.done .num { background: var(--color-success, #4caf50); }
    .label { font-size: 0.9rem; }
  }
}
.panel {
  background: var(--color-surface, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  h2 { margin-top: 0; }
  .hint { color: var(--color-text-muted, #888); margin-bottom: 1rem; }
  code { background: var(--color-code-bg, #f5f5f5); padding: 2px 6px; border-radius: 3px; font-size: 0.85em; }
}
.path-input {
  display: flex; gap: 0.5rem;
  input { flex: 1; padding: 0.6rem; border: 1px solid var(--color-border, #ddd); border-radius: 4px; font-family: monospace; }
}
.btn {
  padding: 0.5rem 1rem;
  border: none; border-radius: 4px;
  cursor: pointer; font-size: 0.9rem;
  display: inline-flex; align-items: center; gap: 0.3rem;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.large { padding: 0.8rem 1.5rem; font-size: 1rem; }
  &.btn-primary { background: var(--color-primary, #e91e63); color: white; }
  &.btn-secondary { background: var(--color-surface-alt, #f5f5f5); }
  &.btn-danger { background: #e53935; color: white; }
}
.btn-tiny {
  padding: 2px 8px; font-size: 0.8rem;
  border: 1px solid var(--color-border, #ddd);
  background: var(--color-surface, #fff);
  border-radius: 3px; cursor: pointer;
  &:hover { background: var(--color-hover, #fafafa); }
}
.alert {
  padding: 0.8rem 1rem;
  border-radius: 4px;
  margin: 1rem 0;
  display: flex; gap: 0.5rem; align-items: center;
  background: var(--color-warn-bg, #fff3e0);
  border-left: 4px solid var(--color-warn, #ff9800);
  &.alert-error { background: #ffebee; border-left-color: #c62828; }
  &.alert-warn { background: #fff8e1; border-left-color: #f57c00; }
}
.backup-list {
  margin-top: 1.5rem;
  h3 { font-size: 0.95rem; margin-bottom: 0.5rem; }
  ul { padding: 0; list-style: none; }
  li { padding: 0.3rem 0; font-size: 0.85rem; display: flex; gap: 0.4rem; align-items: center; }
  .muted { color: #888; }
}
.tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border, #eee);
  .tab {
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 0.9rem;
    &.active { color: var(--color-primary, #e91e63); border-bottom-color: currentColor; font-weight: 600; }
    .count {
      margin-left: 0.3rem;
      padding: 1px 6px;
      background: var(--color-surface-alt, #f5f5f5);
      border-radius: 10px;
      font-size: 0.75rem;
    }
  }
}
.tab-panel { min-height: 200px; }
.tab-header {
  display: flex; gap: 0.5rem; align-items: center;
  margin-bottom: 0.8rem;
  .muted { color: #888; font-size: 0.85rem; margin-left: auto; }
}
.grid {
  display: grid;
  gap: 0.5rem;
  &.grid-2 { grid-template-columns: repeat(2, 1fr); }
  &.grid-3 { grid-template-columns: repeat(3, 1fr); }
}
.card {
  display: flex; gap: 0.6rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border, #eee);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: var(--color-hover, #fafafa); }
  &.selected { background: var(--color-primary-bg, #fce4ec); border-color: var(--color-primary, #e91e63); }
  input[type=checkbox] { margin-top: 3px; }
  strong { font-size: 0.9rem; }
  .muted { font-size: 0.75rem; color: #888; }
  .path-hint { font-size: 0.7rem; color: #aaa; font-family: monospace; }
}
.dailynote-list {
  display: flex; flex-direction: column; gap: 0.3rem;
  .dn-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1.5fr;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
    border-bottom: 1px solid var(--color-border, #eee);
    .dn-main strong { font-size: 0.9rem; }
    .dn-main .muted { font-size: 0.75rem; color: #888; }
    select, input {
      padding: 0.3rem 0.5rem;
      border: 1px solid var(--color-border, #ddd);
      border-radius: 4px;
      font-size: 0.85rem;
    }
  }
}
.plugin-list { display: flex; flex-direction: column; gap: 0.3rem; }
.plugin-row {
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border, #eee);
  border-radius: 6px;
  &.selected { background: var(--color-primary-bg, #fce4ec); border-color: var(--color-primary, #e91e63); }
  .plugin-toggle { display: flex; gap: 0.4rem; align-items: center; }
  .muted { font-size: 0.75rem; color: #888; margin-top: 2px; }
  .plugin-opts {
    display: flex; gap: 1rem; flex-wrap: wrap;
    margin-top: 0.4rem; font-size: 0.85rem;
    padding-top: 0.4rem; border-top: 1px dashed #eee;
  }
}
.chip-list { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.4rem; }
.chip {
  padding: 3px 10px;
  background: var(--color-surface-alt, #f5f5f5);
  border-radius: 12px;
  font-size: 0.8rem;
  &.warn { background: #fff3e0; color: #e65100; cursor: help; }
}
.sub-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border, #eee);
  h3 { font-size: 0.95rem; margin: 0 0 0.5rem 0; }
  .small { font-size: 0.8rem; }
}
.cfg-table, .cfg-conflicts {
  display: flex; flex-direction: column; gap: 0.3rem;
  .cfg-row, .conflict-row {
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--color-border, #eee);
    border-radius: 4px;
  }
  code { background: transparent; font-weight: 600; color: var(--color-primary, #e91e63); }
  .val { font-family: monospace; color: #666; font-size: 0.85rem; }
  .val.source { margin-top: 3px; }
}
.conflict-row {
  .conflict-vals {
    display: flex; flex-direction: column; gap: 0.3rem;
    margin-top: 0.4rem;
    label {
      padding: 0.3rem 0.5rem;
      border-radius: 3px;
      &.selected { background: var(--color-primary-bg, #fce4ec); }
    }
  }
}
.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.8rem;
  margin: 1rem 0;
  .summary-card {
    padding: 1rem;
    background: var(--color-surface-alt, #f5f5f5);
    border-radius: 6px;
    text-align: center;
    .summary-num { font-size: 1.8rem; font-weight: bold; color: var(--color-primary, #e91e63); }
    .summary-label { font-size: 0.85rem; color: #666; }
  }
}
.step-nav {
  display: flex; justify-content: space-between;
  margin-top: 1.5rem; padding-top: 1rem;
  border-top: 1px solid var(--color-border, #eee);
}
.log-panel {
  background: #0f0f0f; color: #e0e0e0;
  padding: 1rem; border-radius: 4px;
  font-family: monospace; font-size: 0.8rem;
  max-height: 500px; overflow-y: auto;
  .log-line {
    padding: 2px 0;
    .ts { color: #888; margin-right: 0.5rem; }
    .stage { color: #64b5f6; margin-right: 0.5rem; }
    &.error .msg { color: #ef5350; }
    &.warn .msg { color: #ffa726; }
    &.info .msg { color: #81c784; }
    &.done .msg { color: #4caf50; font-weight: bold; }
  }
}
.done-summary {
  margin-top: 1rem;
  padding: 1rem;
  background: var(--color-surface-alt, #f5f5f5);
  border-radius: 4px;
  h3 { margin-top: 0; }
  pre { max-height: 300px; overflow: auto; font-size: 0.8rem; }
}
</style>
