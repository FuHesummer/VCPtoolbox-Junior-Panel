<template>
  <div class="page maintenance">
    <PageHeader title="运维中心" subtitle="scripts/ 维护工具 · 白名单串行执行 · 实时日志 + 审计落盘" icon="construction">
      <template #actions>
        <button class="btn btn-ghost" @click="loadAll" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
          刷新
        </button>
      </template>
    </PageHeader>

    <div class="content">
      <!-- 帮助卡 -->
      <details class="help-card" open>
        <summary>这是什么？</summary>
        <div class="help-body">
          <p>
            <strong>运维中心</strong> 提供对 <code>scripts/</code> 维护脚本的可视化执行能力。
            所有脚本走<strong>后端白名单</strong>驱动，不接受任意命令。同一时刻只允许 <strong>1 个任务</strong>串行运行。
          </p>
          <p class="danger-note">
            <span class="material-symbols-outlined">warning</span>
            标注 <span class="danger-badge high">高风险</span> 的脚本会**中断服务**，执行前请确保你知道自己在做什么。
          </p>
          <ul>
            <li>每次执行都会落盘审计（最多保留 100 条）</li>
            <li>每条任务的完整 stdout/stderr 保留在 <code>data/maintenance-logs/</code></li>
            <li>可中途点"取消"发送 SIGTERM，3 秒后升级为 SIGKILL</li>
          </ul>
        </div>
      </details>

      <!-- 运行中任务：悬浮在顶部的状态条 -->
      <section v-if="currentJob" class="live-banner" :class="{ done: currentJob.status !== 'running' }">
        <div class="live-left">
          <span v-if="currentJob.status === 'running'" class="live-dot"></span>
          <span v-else class="material-symbols-outlined" style="color: #22c55e;">check_circle</span>
          <div class="live-info">
            <div class="live-title">
              <strong>{{ currentJob.title }}</strong>
              <span class="live-status-pill" :class="currentJob.status">{{ statusLabel(currentJob.status) }}</span>
            </div>
            <div class="live-meta">
              开始于 {{ humanTime(currentJob.startedAt) }}
              <span v-if="currentJob.finishedAt"> · 耗时 {{ formatDuration(currentJob) }}</span>
              <span v-if="currentJob.exitCode !== null"> · exit {{ currentJob.exitCode }}</span>
            </div>
          </div>
        </div>
        <div class="live-right">
          <button v-if="currentJob.status === 'running'" class="btn btn-small btn-danger" @click="cancelCurrent" :disabled="cancelling">
            <span class="material-symbols-outlined">stop_circle</span>
            {{ cancelling ? '取消中...' : '取消' }}
          </button>
          <button class="btn btn-small btn-ghost" @click="showConsole = !showConsole">
            <span class="material-symbols-outlined">{{ showConsole ? 'expand_less' : 'terminal' }}</span>
            {{ showConsole ? '收起' : '展开日志' }}
          </button>
          <button v-if="currentJob.status !== 'running'" class="btn btn-small btn-ghost" @click="dismissJob">
            <span class="material-symbols-outlined">close</span>
            关闭
          </button>
        </div>

        <pre v-if="showConsole" ref="consoleRef" class="live-console" :class="{ 'auto-scroll': autoScroll }">{{ consoleText || '(暂无输出)' }}</pre>
      </section>

      <!-- Tab 切换 -->
      <div class="tabs">
        <button class="tab-btn" :class="{ active: activeTab === 'scripts' }" @click="activeTab = 'scripts'">
          <span class="material-symbols-outlined">build_circle</span>
          脚本列表
          <span class="count" v-if="scripts.length">{{ scripts.length }}</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">
          <span class="material-symbols-outlined">history</span>
          执行历史
          <span class="count" v-if="history.length">{{ history.length }}</span>
        </button>
      </div>

      <!-- 脚本列表 -->
      <template v-if="activeTab === 'scripts'">
        <EmptyState v-if="loading && scripts.length === 0" icon="hourglass_top" message="加载脚本清单..." />
        <div v-for="cat in categoriesSorted" :key="cat.key" class="category-section">
          <h3 class="cat-title">
            <span class="material-symbols-outlined">{{ categoryIcon(cat.key) }}</span>
            {{ cat.label }}
            <span class="cat-count">{{ cat.items.length }}</span>
          </h3>
          <div class="cat-grid">
            <article
              v-for="s in cat.items"
              :key="s.id"
              class="script-card"
              :class="'danger-' + s.danger"
            >
              <header class="sc-head">
                <span class="material-symbols-outlined sc-icon">{{ s.icon }}</span>
                <div class="sc-title-block">
                  <div class="sc-title">{{ s.title }}</div>
                  <div class="sc-badges">
                    <span class="danger-badge" :class="s.danger">{{ dangerLabel(s.danger) }}</span>
                    <span v-if="s.requiresStopServer" class="stop-badge">
                      <span class="material-symbols-outlined">power_off</span>
                      需停服
                    </span>
                  </div>
                </div>
              </header>

              <p class="sc-desc">{{ s.description }}</p>

              <!-- 参数输入（仅有 args 的脚本显示） -->
              <div v-if="s.args && s.args.length" class="sc-args">
                <div v-for="a in s.args" :key="a.name" class="sc-arg-row">
                  <label>{{ a.label }}</label>
                  <input
                    v-model="scriptArgs[s.id][a.name]"
                    :placeholder="a.placeholder || ''"
                  />
                </div>
              </div>

              <footer class="sc-footer">
                <span v-if="lastRun(s.id)" class="last-run" :class="lastRun(s.id)!.status">
                  上次 {{ humanTime(lastRun(s.id)!.finishedAt) }} · {{ statusLabel(lastRun(s.id)!.status) }}
                </span>
                <span v-else class="last-run none">未执行过</span>
                <button
                  class="btn btn-small"
                  :class="s.danger === 'high' ? 'btn-danger' : ''"
                  @click="confirmRun(s)"
                  :disabled="!!currentJob"
                >
                  <span class="material-symbols-outlined">play_arrow</span>
                  {{ currentJob ? '等待中...' : '执行' }}
                </button>
              </footer>
            </article>
          </div>
        </div>
      </template>

      <!-- 历史列表 -->
      <template v-else-if="activeTab === 'history'">
        <EmptyState v-if="history.length === 0" icon="history" message="暂无执行历史" />
        <div v-else class="history-list">
          <div v-for="h in history" :key="h.id" class="history-row" @click="showHistoryDetail(h)">
            <span class="hr-dot" :class="h.status"></span>
            <div class="hr-main">
              <div class="hr-title">
                {{ h.title }}
                <span class="danger-badge" :class="h.danger">{{ dangerLabel(h.danger) }}</span>
              </div>
              <div class="hr-meta">
                <code>{{ h.cmd }}</code>
              </div>
              <div class="hr-meta">
                {{ humanTime(h.startedAt) }} · 耗时 {{ formatMs(h.durationMs) }}
                <span v-if="h.exitCode !== null"> · exit {{ h.exitCode }}</span>
                <span v-if="h.stderrLines > 0"> · {{ h.stderrLines }} 行 stderr</span>
              </div>
            </div>
            <span class="hr-status-pill" :class="h.status">{{ statusLabel(h.status) }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 确认对话框 -->
    <div v-if="confirmTarget" class="modal-backdrop" @click.self="confirmTarget = null">
      <div class="modal-box">
        <h3>
          <span class="material-symbols-outlined" :class="confirmTarget.danger">
            {{ confirmTarget.danger === 'high' ? 'dangerous' : (confirmTarget.danger === 'medium' ? 'warning' : 'play_circle') }}
          </span>
          确认执行「{{ confirmTarget.title }}」？
        </h3>
        <p>{{ confirmTarget.description }}</p>
        <div v-if="confirmTarget.requiresStopServer" class="warning-block">
          ⚠ 该脚本需要<strong>停止服务器</strong>后运行。如果服务器正在运行，执行可能失败或数据异常。
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="confirmTarget = null">取消</button>
          <button
            class="btn"
            :class="confirmTarget.danger === 'high' ? 'btn-danger' : ''"
            @click="doRun"
            :disabled="starting"
          >
            {{ starting ? '启动中...' : '确认执行' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 历史详情对话框 -->
    <div v-if="historyDetail" class="modal-backdrop" @click.self="historyDetail = null">
      <div class="modal-box modal-wide">
        <h3>
          <span class="material-symbols-outlined">receipt_long</span>
          {{ historyDetail.title }}
        </h3>
        <div class="hd-meta">
          <div><strong>状态：</strong><span class="danger-badge" :class="historyDetail.status">{{ statusLabel(historyDetail.status) }}</span></div>
          <div><strong>命令：</strong><code>{{ historyDetail.cmd }}</code></div>
          <div><strong>开始：</strong>{{ humanTime(historyDetail.startedAt) }}</div>
          <div><strong>结束：</strong>{{ humanTime(historyDetail.finishedAt) }}</div>
          <div><strong>耗时：</strong>{{ formatMs(historyDetail.durationMs) }}</div>
          <div><strong>Exit：</strong>{{ historyDetail.exitCode }}</div>
        </div>
        <pre class="hd-log">{{ historyOutput || '(加载中...)' }}</pre>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="historyDetail = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import {
  listScripts, getCurrentJob, runScript, cancelJob, getHistory, streamJob, getJob,
  type ScriptDef, type JobSummary, type HistoryRecord, type DangerLevel, type JobStatus,
} from '@/api/maintenance'

// ============ 状态 ============
const loading = ref(false)
const scripts = ref<ScriptDef[]>([])
const categories = ref<Record<string, string>>({})
const currentJob = ref<JobSummary | null>(null)
const consoleText = ref('')
const showConsole = ref(false)
const autoScroll = ref(true)
const consoleRef = ref<HTMLElement | null>(null)
const history = ref<HistoryRecord[]>([])
const scriptArgs = reactive<Record<string, Record<string, string>>>({})
const activeTab = ref<'scripts' | 'history'>('scripts')

const confirmTarget = ref<ScriptDef | null>(null)
const starting = ref(false)
const cancelling = ref(false)

const historyDetail = ref<HistoryRecord | null>(null)
const historyOutput = ref('')

let closeStream: (() => void) | null = null

// ============ 加载 ============
async function loadAll() {
  loading.value = true
  try {
    const [sc, cur, hist] = await Promise.all([
      listScripts(), getCurrentJob(), getHistory(50),
    ])
    scripts.value = sc.scripts
    categories.value = sc.categories
    history.value = hist.items
    // 预初始化 scriptArgs（v-model 要求成员路径全程存在，不能用 && 短路）
    for (const s of scripts.value) {
      if (!scriptArgs[s.id]) scriptArgs[s.id] = {}
      if (Array.isArray(s.args)) {
        for (const a of s.args) {
          if (!(a.name in scriptArgs[s.id])) scriptArgs[s.id][a.name] = ''
        }
      }
    }
    if (cur.job) {
      attachToJob(cur.job, cur.output)
    } else {
      currentJob.value = null
      consoleText.value = ''
    }
  } finally {
    loading.value = false
  }
}

function attachToJob(job: JobSummary, initialOutput = '') {
  currentJob.value = job
  consoleText.value = initialOutput || ''
  showConsole.value = true
  closeStream?.()
  if (job.status === 'running') {
    closeStream = streamJob(job.id, {
      onReplay: (text) => { consoleText.value = text; scrollConsole() },
      onChunk: (_kind, text) => { consoleText.value += text; scrollConsole() },
      onDone: (info) => {
        if (currentJob.value) {
          currentJob.value = { ...currentJob.value, status: info.status, exitCode: info.exitCode, finishedAt: info.finishedAt }
        }
        // 刷新历史
        getHistory(50).then(r => { history.value = r.items })
      },
      onError: () => { /* ignore */ },
    })
  }
}

function scrollConsole() {
  if (!autoScroll.value) return
  nextTick(() => {
    const el = consoleRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// ============ 分类分组 ============
const categoriesSorted = computed(() => {
  const order = ['index', 'db', 'diagnose', 'ops']
  const grouped: Record<string, ScriptDef[]> = {}
  for (const s of scripts.value) {
    if (!grouped[s.category]) grouped[s.category] = []
    grouped[s.category].push(s)
  }
  return order
    .filter(k => grouped[k])
    .map(k => ({ key: k, label: categories.value[k] || k, items: grouped[k] }))
    .concat(
      Object.keys(grouped)
        .filter(k => !order.includes(k))
        .map(k => ({ key: k, label: categories.value[k] || k, items: grouped[k] }))
    )
})

function categoryIcon(key: string) {
  return {
    index: 'refresh',
    db: 'database',
    diagnose: 'health_and_safety',
    ops: 'backup',
  }[key] || 'folder'
}

function dangerLabel(d: DangerLevel) {
  return { low: '低风险', medium: '中风险', high: '高风险' }[d]
}

function statusLabel(s: JobStatus) {
  return { running: '运行中', completed: '成功', failed: '失败', cancelled: '已取消' }[s] || s
}

function humanTime(iso: string | null) {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return iso }
}

function formatMs(ms: number) {
  if (!ms || ms < 0) return '--'
  if (ms < 1000) return ms + ' ms'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒'
  return Math.floor(m / 60) + ' 时 ' + (m % 60) + ' 分'
}

function formatDuration(job: JobSummary) {
  if (!job.startedAt || !job.finishedAt) return '--'
  return formatMs(new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime())
}

function lastRun(scriptId: string): HistoryRecord | undefined {
  return history.value.find(h => h.scriptId === scriptId)
}

// ============ 操作 ============
function confirmRun(s: ScriptDef) {
  confirmTarget.value = s
}

async function doRun() {
  if (!confirmTarget.value) return
  const s = confirmTarget.value
  starting.value = true
  try {
    const resp = await runScript(s.id, scriptArgs[s.id] || {})
    if (!resp.success || !resp.job) {
      throw new Error(resp.error || '启动失败')
    }
    confirmTarget.value = null
    attachToJob(resp.job)
  } catch (e: any) {
    alert('启动失败: ' + (e.message || e))
  } finally {
    starting.value = false
  }
}

async function cancelCurrent() {
  if (!currentJob.value) return
  cancelling.value = true
  try {
    await cancelJob(currentJob.value.id)
  } catch (e: any) {
    alert('取消失败: ' + (e.message || e))
  } finally {
    cancelling.value = false
  }
}

function dismissJob() {
  closeStream?.()
  currentJob.value = null
  consoleText.value = ''
  showConsole.value = false
}

async function showHistoryDetail(h: HistoryRecord) {
  historyDetail.value = h
  historyOutput.value = '(加载中...)'
  try {
    const resp = await getJob(h.id)
    historyOutput.value = resp.output || '(无输出)'
  } catch {
    historyOutput.value = '(日志加载失败)'
  }
}

// ============ 生命周期 ============
onMounted(loadAll)
onBeforeUnmount(() => { closeStream?.() })

// 切到运行中任务且模板刚展开时 auto scroll
watch(showConsole, (v) => { if (v) scrollConsole() })
</script>

<style lang="scss" scoped>
.maintenance {
  .content {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
}

.help-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--button-bg, #6366f1);
  border-radius: 10px;
  padding: 14px 18px;
  font-size: 0.85rem;
  line-height: 1.7;

  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--button-bg, #6366f1);
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;

    &::-webkit-details-marker { display: none; }
    &::before {
      content: '▶';
      font-size: 0.7em;
      transition: transform 0.2s;
    }
  }

  &[open] summary::before { transform: rotate(90deg); }

  .help-body { margin-top: 8px; }
  p { margin: 8px 0; }
  code {
    background: var(--background-color);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.9em;
  }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 3px 0; }

  .danger-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(239, 68, 68, 0.08);
    border-radius: 6px;
    color: #b91c1c;

    .material-symbols-outlined { font-size: 1.1em; }
  }
}

.live-banner {
  background: var(--card-bg);
  border: 1px solid var(--button-bg, #6366f1);
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);

  &.done { border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.1); }

  .live-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 240px; }
  .live-right { display: flex; gap: 6px; align-items: center; }

  .live-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #3b82f6;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(59, 130, 246, 0.4); }
    50% { opacity: 0.5; box-shadow: 0 0 0 rgba(59, 130, 246, 0); }
  }

  .live-info { flex: 1; }
  .live-title { display: flex; align-items: center; gap: 8px; color: var(--primary-text); font-size: 0.95rem; }
  .live-meta { color: var(--secondary-text); font-size: 0.78rem; margin-top: 2px; }
  .live-status-pill {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(59, 130, 246, 0.12);
    color: #3b82f6;

    &.completed { background: rgba(34, 197, 94, 0.12); color: #16a34a; }
    &.failed { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
    &.cancelled { background: rgba(156, 163, 175, 0.2); color: var(--secondary-text); }
  }

  .live-console {
    flex: 1 0 100%;
    max-height: 320px;
    overflow: auto;
    background: #1a1d24;
    color: #e5e7eb;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    padding: 10px 12px;
    border-radius: 6px;
    margin-top: 8px;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.55;
  }
}

.tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--border-color);

  .tab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--secondary-text);
    padding: 8px 14px;
    cursor: pointer;
    font-size: 0.88rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s;

    &.active {
      color: var(--button-bg, #6366f1);
      border-bottom-color: var(--button-bg, #6366f1);
    }
    &:hover:not(.active) { color: var(--primary-text); }

    .count {
      font-size: 0.7rem;
      background: var(--background-color);
      color: var(--secondary-text);
      padding: 1px 7px;
      border-radius: 10px;
    }
  }
}

.category-section {
  margin-top: 6px;

  .cat-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--primary-text);

    .cat-count {
      font-size: 0.72rem;
      color: var(--secondary-text);
      background: var(--background-color);
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: normal;
    }
  }

  .cat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
}

.script-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: all 0.2s;

  &:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); }
  &.danger-high { border-left: 3px solid #ef4444; }
  &.danger-medium { border-left: 3px solid #f59e0b; }
  &.danger-low { border-left: 3px solid #22c55e; }

  .sc-head {
    display: flex;
    gap: 10px;
    align-items: flex-start;

    .sc-icon {
      font-size: 1.6em;
      color: var(--button-bg, #6366f1);
      padding-top: 2px;
    }
    .sc-title-block { flex: 1; }
    .sc-title {
      font-size: 0.92rem;
      font-weight: 600;
      color: var(--primary-text);
      margin-bottom: 4px;
    }
    .sc-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  }

  .sc-desc {
    font-size: 0.78rem;
    color: var(--secondary-text);
    line-height: 1.55;
    margin: 0;
  }

  .sc-args {
    background: var(--background-color);
    padding: 8px 10px;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;

    .sc-arg-row {
      display: flex;
      gap: 8px;
      align-items: center;

      label {
        min-width: 80px;
        font-size: 0.78rem;
        color: var(--secondary-text);
      }
      input {
        flex: 1;
        padding: 5px 8px;
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 0.82rem;
        color: var(--primary-text);
      }
    }
  }

  .sc-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px dashed var(--border-color);
    padding-top: 10px;

    .last-run {
      font-size: 0.72rem;
      color: var(--secondary-text);

      &.completed { color: #16a34a; }
      &.failed { color: #ef4444; }
      &.cancelled { color: var(--secondary-text); }
      &.none { opacity: 0.55; }
    }
  }
}

.danger-badge {
  font-size: 0.68rem;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 500;
  display: inline-block;

  &.high, &.failed { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
  &.medium, &.running { background: rgba(245, 158, 11, 0.15); color: #d97706; }
  &.low, &.completed { background: rgba(34, 197, 94, 0.12); color: #16a34a; }
  &.cancelled { background: rgba(156, 163, 175, 0.15); color: var(--secondary-text); }
}

.stop-badge {
  font-size: 0.68rem;
  padding: 2px 6px 2px 4px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 500;

  .material-symbols-outlined { font-size: 0.95em; }
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-row {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  display: grid;
  grid-template-columns: 12px 1fr auto;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { background: var(--background-color); }

  .hr-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--secondary-text);

    &.completed { background: #22c55e; }
    &.failed { background: #ef4444; }
    &.cancelled { background: #f59e0b; }
    &.running { background: #3b82f6; }
  }

  .hr-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .hr-title {
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--primary-text);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hr-meta {
    font-size: 0.72rem;
    color: var(--secondary-text);

    code {
      font-family: monospace;
      background: var(--background-color);
      padding: 1px 5px;
      border-radius: 3px;
      color: var(--primary-text);
    }
  }

  .hr-status-pill {
    font-size: 0.72rem;
    padding: 2px 9px;
    border-radius: 10px;

    &.completed { background: rgba(34, 197, 94, 0.12); color: #16a34a; }
    &.failed { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
    &.cancelled { background: rgba(156, 163, 175, 0.2); color: var(--secondary-text); }
    &.running { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
  }
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-box {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 20px 24px;
  max-width: 480px;
  width: 100%;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 12px;

  &.modal-wide {
    max-width: 860px;
    max-height: 85vh;
  }

  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1rem;
    color: var(--primary-text);

    .material-symbols-outlined {
      &.high { color: #ef4444; }
      &.medium { color: #f59e0b; }
      &.low { color: #22c55e; }
    }
  }

  p {
    margin: 0;
    color: var(--secondary-text);
    font-size: 0.88rem;
    line-height: 1.6;
  }

  .warning-block {
    padding: 10px 12px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    color: #b91c1c;
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .hd-meta {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    font-size: 0.82rem;
    color: var(--primary-text);

    code {
      background: var(--background-color);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.9em;
    }
  }

  .hd-log {
    background: #1a1d24;
    color: #e5e7eb;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    padding: 12px;
    border-radius: 6px;
    max-height: 480px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.55;
    margin: 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
}
</style>
