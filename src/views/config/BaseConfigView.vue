<template>
  <div class="page base-config">
    <PageHeader title="全局配置" subtitle="config.env — 按字段编辑，自动保留注释" icon="settings">
      <template #actions>
        <!-- Honeypot：诱骗密码管理器去填这俩假框 -->
        <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" class="honeypot" />
        <input type="password" name="password" autocomplete="current-password" tabindex="-1" aria-hidden="true" class="honeypot" />
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          name="cfg-filter-keyword-x9z"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          readonly
          @focus="unlockSearchInput"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
          placeholder="搜索字段..."
          class="search"
        />
        <button class="btn btn-ghost" :class="{ 'btn-danger': rawMode }" @click="toggleRawMode">
          <span class="material-symbols-outlined">{{ rawMode ? 'view_module' : 'data_object' }}</span>
          {{ rawMode ? '表单模式' : '原文模式' }}
        </button>
        <button class="btn btn-ghost" @click="reload" :disabled="loading"><span class="material-symbols-outlined">refresh</span></button>
        <button class="btn" @click="save" :disabled="!dirty">保存</button>
      </template>
    </PageHeader>

    <p v-if="dirty" class="dirty-banner">⚠️ 有 {{ dirtyCount }} 个字段未保存，保存后重启服务生效</p>

    <!-- 表单模式（master-detail：左侧分类，右侧字段网格） -->
    <div v-if="!rawMode" class="content">
      <EmptyState v-if="loading" icon="sync" message="正在加载..." />
      <div v-else-if="!sections.length" class="empty-tip">
        <EmptyState icon="settings_applications" message="配置为空" />
      </div>
      <div v-else class="layout">
        <!-- 左侧：分类侧边栏（始终显示，避免 v-if 切换导致主区跑位） -->
        <aside class="cat-sidebar card">
          <div v-if="isSearching" class="search-state">
            <span class="material-symbols-outlined">search</span>
            <div class="state-info">
              <strong>搜索中</strong>
              <small>{{ filteredFieldCount }} 项匹配</small>
            </div>
            <button class="state-clear" title="清除搜索" @click="search = ''">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="cat-list" :class="{ disabled: isSearching }">
            <button
              v-for="(sec, idx) in sections"
              :key="idx"
              class="cat-item"
              :class="{ active: !isSearching && idx === activeSectionIdx, dirty: sectionDirtyCount(sec) > 0 }"
              :disabled="isSearching"
              @click="activeSectionIdx = idx"
            >
              <span class="material-symbols-outlined">{{ sec.icon || 'tune' }}</span>
              <span class="cat-name">{{ sec.title || '未分类' }}</span>
              <span class="cat-count">{{ sec.entries.length }}</span>
              <span v-if="sectionDirtyCount(sec) > 0" class="cat-dirty-badge" :title="`${sectionDirtyCount(sec)} 项未保存`">
                {{ sectionDirtyCount(sec) }}
              </span>
            </button>
          </div>
        </aside>

        <!-- 右侧：当前分类的字段网格 / 搜索全局结果 -->
        <main class="cat-content card">
          <header class="cat-head" v-if="!isSearching && activeSection">
            <span class="material-symbols-outlined">{{ activeSection.icon || 'tune' }}</span>
            <h2>{{ activeSection.title || '未分类' }}</h2>
            <span class="muted">{{ activeSection.entries.length }} 项</span>
          </header>
          <header class="cat-head" v-else-if="isSearching">
            <span class="material-symbols-outlined">search</span>
            <h2>搜索结果</h2>
            <span class="muted">{{ filteredFieldCount }} 项匹配</span>
          </header>

          <div class="field-grid">
            <div
              v-for="e in displayedFields"
              :key="e.originalIndex + '-' + e.key"
              :class="['grid-cell', isFullWidthField(e.originalIndex) ? 'full' : 'half']"
            >
              <EnvField
                :entry="itemAt(e.originalIndex)"
                :dirty="dirtyKeys.has(e.key)"
                @update:value="(v) => updateValue(e.originalIndex, v)"
              />
            </div>
          </div>

          <div v-if="isSearching && filteredFieldCount === 0" class="no-search-result">
            <span class="material-symbols-outlined">search_off</span>
            <p>没有字段匹配 "{{ search }}"</p>
          </div>
        </main>
      </div>
    </div>

    <!-- 原文模式（fallback）-->
    <div v-else class="content">
      <CodeEditor v-model="rawContent" :rows="32" placeholder="KEY=VALUE" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import EnvField from '@/components/config/EnvField.vue'
import { getMainConfig, saveMainConfig } from '@/api/config'
import { useUiStore } from '@/stores/ui'
import { parseEnv, buildEnv, type EnvItem, type EnvEntry } from '@/utils/envParser'

const ui = useUiStore()
const items = ref<EnvItem[]>([])
const original = ref<EnvItem[]>([])
const search = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
function unlockSearchInput() {
  if (searchInput.value) searchInput.value.removeAttribute('readonly')
}
const loading = ref(false)
const rawMode = ref(false)
const rawContent = ref('')

const dirtyKeys = computed(() => {
  const set = new Set<string>()
  const origMap = new Map<string, string>()
  for (const item of original.value) {
    if (item.kind === 'entry') origMap.set(item.key, item.value)
  }
  for (const item of items.value) {
    if (item.kind === 'entry' && origMap.get(item.key) !== item.value) {
      set.add(item.key)
    }
  }
  return set
})

const dirty = computed(() => {
  if (rawMode.value) return rawContent.value !== buildEnv(original.value)
  return dirtyKeys.value.size > 0
})

const dirtyCount = computed(() => dirtyKeys.value.size)

// 按注释段落分组（连续 entries 聚在一起，遇到注释"段标题"时开新段）
interface Section {
  title: string
  icon?: string
  entries: Array<{ key: string; originalIndex: number }>
}

// 段标题识别：只认规范化的 banner 格式（与 config.env.example 一致）
//   # ============================================================   ← 分隔线
//   # [段标题]                                                         ← 标题
//   # ============================================================   ← 分隔线
// 分隔线规则：# 后跟 3+ 个连续的 = 字符（可两端空格）
const BANNER_REGEX = /^=+$/
function isBannerLine(text: string): boolean {
  return BANNER_REGEX.test(text.trim()) && text.trim().length >= 3
}

// Sar* 字段已完全迁移到 sarprompt.json，config.env 中不再包含这些字段

// 不再受 search 影响 —— search 由 displayedFields 单独处理
const sections = computed<Section[]>(() => {
  const secs: Section[] = []
  let currentTitle = ''
  let bannerState: 0 | 1 | 2 = 0
  let bannerTitle = ''

  items.value.forEach((item, idx) => {
    if (item.kind === 'comment') {
      if (item.blank) {
        if (bannerState !== 0) bannerState = 0
        return
      }
      if (isBannerLine(item.text)) {
        if (bannerState === 0) { bannerState = 1; bannerTitle = '' }
        else if (bannerState === 2) {
          currentTitle = bannerTitle
          bannerState = 0
          bannerTitle = ''
        }
      } else if (bannerState === 1) {
        bannerTitle = item.text
        bannerState = 2
      }
      return
    }

    if (!secs.length || secs[secs.length - 1].title !== currentTitle) {
      secs.push({ title: currentTitle, entries: [] })
    }
    secs[secs.length - 1].entries.push({ key: item.key, originalIndex: idx })
  })

  return secs.filter((s) => s.entries.length > 0)
})

// ==== Master-detail 状态 ====
const activeSectionIdx = ref(0)
const isSearching = computed(() => search.value.trim().length > 0)
const activeSection = computed(() => sections.value[activeSectionIdx.value] || null)

// 搜索模式：跨 section 字段过滤；非搜索模式：当前 section 字段
const displayedFields = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (kw) {
    const all: Array<{ key: string; originalIndex: number }> = []
    for (const sec of sections.value) {
      for (const e of sec.entries) {
        const item = items.value[e.originalIndex]
        if (item?.kind !== 'entry') continue
        if (
          item.key.toLowerCase().includes(kw)
          || (item.description || '').toLowerCase().includes(kw)
        ) {
          all.push(e)
        }
      }
    }
    return all
  }
  return activeSection.value?.entries || []
})

const filteredFieldCount = computed(() => displayedFields.value.length)

function sectionDirtyCount(sec: Section): number {
  let n = 0
  for (const e of sec.entries) {
    const item = items.value[e.originalIndex]
    if (item?.kind === 'entry' && dirtyKeys.value.has(item.key)) n++
  }
  return n
}

// textarea / 长字段独占整行；其他字段半幅
function isFullWidthField(originalIndex: number): boolean {
  const item = items.value[originalIndex]
  if (item?.kind !== 'entry') return false
  if (item.type === 'textarea') return true
  // 长 value（>= 80 字符）或 key 含 URL/PROMPT 关键字 → 全宽更舒服
  if ((item.value || '').length >= 80) return true
  if (/url|prompt|key|secret|password|token/i.test(item.key) && item.type !== 'boolean') return true
  return false
}

// 切 section 时滚到顶部（避免长列表保留滚动位置不直观）
watch(activeSectionIdx, () => {
  const el = document.querySelector('.cat-content')
  if (el) el.scrollTop = 0
})

// 当 sections 数量变化导致 activeSectionIdx 越界，自动归零
watch(sections, (s) => {
  if (activeSectionIdx.value >= s.length) activeSectionIdx.value = 0
})

function itemAt(index: number): EnvEntry {
  return items.value[index] as EnvEntry
}

function updateValue(index: number, value: string) {
  const entry = items.value[index]
  if (entry?.kind === 'entry') {
    entry.value = value
  }
}

async function reload() {
  loading.value = true
  try {
    const data = await getMainConfig()
    const parsed = parseEnv(data.content)
    items.value = parsed
    // deep clone for original baseline
    original.value = parsed.map((x) => ({ ...x }))
    rawContent.value = data.content
  } finally { loading.value = false }
}

async function save() {
  try {
    const content = rawMode.value ? rawContent.value : buildEnv(items.value)
    await saveMainConfig(content)
    const parsed = parseEnv(content)
    items.value = parsed
    original.value = parsed.map((x) => ({ ...x }))
    rawContent.value = content
    ui.showMessage('配置已保存，重启服务生效', 'success')
  } catch { /* toast 已弹 */ }
}

function toggleRawMode() {
  if (rawMode.value) {
    // 从原文模式切回：重新解析原文
    items.value = parseEnv(rawContent.value)
    original.value = items.value.map((x) => ({ ...x }))
    rawMode.value = false
  } else {
    // 切入原文模式：用当前表单构建 env 原文
    rawContent.value = buildEnv(items.value)
    rawMode.value = true
  }
}

// 两种模式来回切换时保持 rawContent 同步
watch(items, () => {
  if (!rawMode.value) rawContent.value = buildEnv(items.value)
}, { deep: true })

onMounted(reload)
</script>

<style lang="scss" scoped>
.base-config { display: flex; flex-direction: column; }

.search {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 180px;
}

/* honeypot：完全不可见 + 不可聚焦，仅供密码管理器自动填充用 */
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

.dirty-banner {
  margin: 0 24px 12px;
  padding: 8px 14px;
  background: rgba(212, 116, 142, 0.08);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--highlight-text);
  font-size: 13px;
}

.content {
  padding: 0 24px 24px;
  flex: 1;
  min-height: 0;
}

/* ===== Master-detail 布局（flex：sidebar 不存在时 main 自动占满，零纠缠） ===== */
.layout {
  display: flex;
  gap: 14px;
  height: calc(100vh - 180px);
  min-height: 480px;
}
.cat-sidebar {
  flex: 0 0 240px;   /* 固定 240px，不缩 */
}
.cat-content {
  flex: 1 1 auto;    /* 主区永远撑满剩余空间 */
  min-width: 0;      /* 允许子元素换行/收缩，避免溢出 */
}

/* 左侧：分类侧边栏 */
.cat-sidebar {
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.search-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--accent-bg);
  border: 1px solid var(--button-bg);
  border-radius: var(--radius-sm);
  color: var(--button-bg);
  .material-symbols-outlined { font-size: 18px; }
  .state-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    strong { font-size: 12px; }
    small { font-size: 11px; opacity: 0.8; color: var(--secondary-text); }
  }
  .state-clear {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--secondary-text);
    padding: 2px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    .material-symbols-outlined { font-size: 16px; }
    &:hover { background: rgba(0,0,0,0.06); color: var(--danger-color); }
  }
}
.cat-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  &.disabled .cat-item { opacity: 0.5; cursor: not-allowed; }
}
.cat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: var(--primary-text);
  transition: all 0.12s;

  .material-symbols-outlined { font-size: 18px; color: var(--secondary-text); }

  &:hover { background: var(--accent-bg); }

  &.active {
    background: var(--accent-bg);
    border-color: var(--button-bg);
    color: var(--button-bg);
    font-weight: 600;
    .material-symbols-outlined { color: var(--button-bg); }
  }

  &.dirty .cat-name::after {
    content: ' •';
    color: var(--highlight-text);
  }

  .cat-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cat-count {
    font-size: 11px;
    font-family: monospace;
    color: var(--secondary-text);
    background: var(--tertiary-bg);
    padding: 1px 6px;
    border-radius: var(--radius-pill);
  }

  .cat-dirty-badge {
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    background: var(--highlight-text);
    padding: 1px 6px;
    border-radius: var(--radius-pill);
  }
}

/* 右侧：当前分类的字段网格 */
.cat-content {
  padding: 18px 20px;
  overflow-y: auto;
  min-height: 0;
}
.cat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);

  .material-symbols-outlined {
    font-size: 22px;
    color: var(--button-bg);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    color: var(--primary-text);
  }
  .muted {
    margin-left: auto;
    font-size: 12px;
    color: var(--secondary-text);
  }
}

/* 字段网格：短字段并排，长字段全宽 */
.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}
.grid-cell.full {
  grid-column: 1 / -1;
}

.no-search-result {
  padding: 60px 20px;
  text-align: center;
  color: var(--secondary-text);
  .material-symbols-outlined {
    font-size: 48px;
    opacity: 0.4;
    display: block;
    margin: 0 auto 8px;
  }
  p { margin: 0; font-size: 14px; }
}

.empty-tip { padding: 40px 0; }
</style>
