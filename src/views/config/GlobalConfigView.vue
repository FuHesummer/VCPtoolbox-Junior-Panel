<template>
  <div class="page global-config">
    <PageHeader
      title="全局配置"
      subtitle="config.env -- 按 Schema 分类编辑，保留注释与顺序"
      icon="settings"
    >
      <template #actions>
        <!-- Honeypot: trick password managers -->
        <input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" class="honeypot" />
        <input type="password" name="password" autocomplete="current-password" tabindex="-1" aria-hidden="true" class="honeypot" />

        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="search"
          name="gcfg-search-x7k"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          readonly
          @focus="unlockSearch"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
          placeholder="搜索字段..."
          class="search-input"
        />

        <button class="btn btn-ghost" :class="{ 'btn-danger': rawMode }" @click="toggleRawMode">
          <span class="material-symbols-outlined">{{ rawMode ? 'view_module' : 'data_object' }}</span>
          {{ rawMode ? '表单模式' : '原文模式' }}
        </button>

        <button class="btn btn-ghost" @click="reload" :disabled="loading">
          <span class="material-symbols-outlined">refresh</span>
        </button>

        <button class="btn" @click="save" :disabled="!isDirty || saving">
          <span class="material-symbols-outlined">save</span>
          保存
          <span v-if="dirtyCount > 0" class="dirty-badge">{{ dirtyCount }}</span>
        </button>
      </template>
    </PageHeader>

    <p v-if="isDirty" class="dirty-banner">
      有 {{ dirtyCount }} 个字段未保存，保存后重启服务生效
    </p>

    <!-- ===================== Form Mode ===================== -->
    <div v-if="!rawMode" class="content">
      <EmptyState v-if="loading" icon="sync" message="正在加载..." />

      <template v-else>
        <!-- Tab bar -->
        <div class="tab-bar">
          <button
            v-for="tab in CONFIG_TABS"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTabKey === tab.key }"
            @click="switchTab(tab.key)"
          >
            <span class="material-symbols-outlined tab-icon">{{ tab.icon }}</span>
            <span class="tab-label">{{ tab.label }}</span>
            <span v-if="tabDirtyCount(tab.key) > 0" class="tab-dirty">{{ tabDirtyCount(tab.key) }}</span>
          </button>
        </div>

        <!-- Search results mode -->
        <div v-if="isSearching" class="search-results">
          <div class="search-results-header">
            <span class="material-symbols-outlined">search</span>
            <span>搜索结果：{{ searchResults.length }} 项匹配</span>
            <button class="clear-search" @click="searchQuery = ''">
              <span class="material-symbols-outlined">close</span>
              清除
            </button>
          </div>
          <div v-if="searchResults.length === 0" class="no-search-result">
            <span class="material-symbols-outlined">search_off</span>
            <p>没有字段匹配 "{{ searchQuery }}"</p>
          </div>
          <div v-else class="field-grid">
            <div
              v-for="sr in searchResults"
              :key="sr.field.key"
              :class="['grid-cell', sr.field.width === 'full' ? 'full' : 'half']"
            >
              <FieldRenderer
                :field="sr.field"
                :value="getEditedValue(sr.field.key)"
                :dirty="isFieldDirty(sr.field.key)"
                :password-visible="passwordVisible[sr.field.key] ?? false"
                :tvs-files="tvsFiles"
                :dynamic-pairs="sr.field.type === 'dynamic-pairs' ? getDynamicPairs(sr.field.key) : []"
                @update="(v: string) => onFieldUpdate(sr.field, v)"
                @update-pairs="(v: PairItem[]) => setDynamicPairs(sr.field.key, v)"
                @update-tags="(v: string[]) => { editedValues[sr.field.key] = arrayToTags(v) }"
                @toggle-password="togglePassword(sr.field.key)"
              />
            </div>
          </div>
        </div>

        <!-- Normal tab content -->
        <div v-else class="tab-content">
          <template v-for="section in activeTab?.sections" :key="section.id">
            <!-- Collapsible section -->
            <CollapsibleSection
              v-if="section.collapsible"
              :title="section.title"
              :icon="section.icon"
              :default-open="section.defaultOpen !== false"
            >
              <p v-if="section.description" class="section-desc">{{ section.description }}</p>
              <div class="field-grid">
                <div
                  v-for="field in section.fields"
                  :key="field.key"
                  :class="['grid-cell', field.width === 'full' ? 'full' : 'half']"
                >
                  <FieldRenderer
                    :field="field"
                    :value="getEditedValue(field.key)"
                    :dirty="isFieldDirty(field.key)"
                    :password-visible="passwordVisible[field.key] ?? false"
                    :tvs-files="tvsFiles"
                    :dynamic-pairs="field.type === 'dynamic-pairs' ? getDynamicPairs(field.key) : []"
                    @update="(v: string) => onFieldUpdate(field, v)"
                    @update-pairs="(v: PairItem[]) => setDynamicPairs(field.key, v)"
                    @update-tags="(v: string[]) => { editedValues[field.key] = arrayToTags(v) }"
                    @toggle-password="togglePassword(field.key)"
                  />
                </div>
              </div>
            </CollapsibleSection>

            <!-- Regular section -->
            <div v-else class="section-block">
              <div class="section-header">
                <span v-if="section.icon" class="material-symbols-outlined section-icon">{{ section.icon }}</span>
                <h3 class="section-title">{{ section.title }}</h3>
                <span v-if="section.description" class="section-hint">{{ section.description }}</span>
              </div>
              <div class="field-grid">
                <div
                  v-for="field in section.fields"
                  :key="field.key"
                  :class="['grid-cell', field.width === 'full' ? 'full' : 'half']"
                >
                  <FieldRenderer
                    :field="field"
                    :value="getEditedValue(field.key)"
                    :dirty="isFieldDirty(field.key)"
                    :password-visible="passwordVisible[field.key] ?? false"
                    :tvs-files="tvsFiles"
                    :dynamic-pairs="field.type === 'dynamic-pairs' ? getDynamicPairs(field.key) : []"
                    @update="(v: string) => onFieldUpdate(field, v)"
                    @update-pairs="(v: PairItem[]) => setDynamicPairs(field.key, v)"
                    @update-tags="(v: string[]) => { editedValues[field.key] = arrayToTags(v) }"
                    @toggle-password="togglePassword(field.key)"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- Dream tab: per-agent dynamic config groups -->
          <template v-if="activeTabKey === 'dream'">
            <div class="section-block dream-agents-section">
              <div class="section-header">
                <span class="material-symbols-outlined section-icon">person</span>
                <h3 class="section-title">Agent</h3>
                <button class="btn btn-small" @click="openAddDreamAgent">
                  <span class="material-symbols-outlined">add</span>
                  添加 Agent
                </button>
              </div>

              <div v-if="dreamAgentGroups.length === 0" class="dream-empty">
                <p>暂无 Agent，点击上方按钮添加</p>
              </div>

              <div v-for="group in dreamAgentGroups" :key="group.name" class="dream-agent-card">
                <div class="dream-card-header">
                  <AgentAvatar :alias="group.chineseName || group.name" :size="40" />
                  <div class="dream-card-info">
                    <strong>{{ group.chineseName || group.name }}</strong>
                    <span class="dream-card-id">{{ group.name }}</span>
                  </div>
                  <button class="btn btn-ghost btn-small btn-danger" @click="removeDreamAgent(group.name)" title="移除此 Agent">
                    <span class="material-symbols-outlined">delete</span>
                  </button>
                </div>
                <div class="dream-card-fields">
                  <div class="dream-field full">
                    <label>做梦模型</label>
                    <ModelSelect
                      :model-value="getEditedValue(`DREAM_AGENT_${group.name}_MODEL_ID`)"
                      placeholder="gemini-2.5-flash-preview-05-20"
                      @update:model-value="(v: string) => onRawFieldInput(`DREAM_AGENT_${group.name}_MODEL_ID`, v)"
                    />
                  </div>
                  <div class="dream-field">
                    <label>中文名</label>
                    <input type="text"
                      :value="getEditedValue(`DREAM_AGENT_${group.name}_CHINESE_NAME`)"
                      @input="onRawFieldInput(`DREAM_AGENT_${group.name}_CHINESE_NAME`, ($event.target as HTMLInputElement).value)"
                    />
                  </div>
                  <div class="dream-field full">
                    <label>系统提示词</label>
                    <input type="text"
                      :value="getEditedValue(`DREAM_AGENT_${group.name}_SYSTEM_PROMPT`)"
                      @input="onRawFieldInput(`DREAM_AGENT_${group.name}_SYSTEM_PROMPT`, ($event.target as HTMLInputElement).value)"
                      placeholder="留空使用默认 dreampost.txt"
                    />
                  </div>
                  <div class="dream-field">
                    <label>最大输出</label>
                    <div class="input-with-unit">
                      <input type="number"
                        :value="getEditedValue(`DREAM_AGENT_${group.name}_MAX_OUTPUT_TOKENS`)"
                        @input="onRawFieldInput(`DREAM_AGENT_${group.name}_MAX_OUTPUT_TOKENS`, ($event.target as HTMLInputElement).value)"
                        placeholder="40000"
                      />
                      <span class="unit-label">tokens</span>
                    </div>
                  </div>
                  <div class="dream-field">
                    <label>温度</label>
                    <input type="number" step="0.05" min="0" max="2"
                      :value="getEditedValue(`DREAM_AGENT_${group.name}_TEMPERATURE`)"
                      @input="onRawFieldInput(`DREAM_AGENT_${group.name}_TEMPERATURE`, ($event.target as HTMLInputElement).value)"
                      placeholder="0.85"
                    />
                  </div>
                </div>
              </div>

              <!-- Agent picker popover (positioned within section) -->
              <Transition name="popover">
                <div v-if="addDreamOpen" class="dream-agent-popover" ref="agentPopoverRef">
                  <div class="popover-header">
                    <span class="material-symbols-outlined">person_add</span>
                    <span>选择 Agent</span>
                    <button class="popover-close" @click="addDreamOpen = false">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </div>
                  <input v-model="addDreamSearch" placeholder="搜索 Agent..." class="popover-search" />
                  <div class="popover-list">
                    <button
                      v-for="ag in filteredAvailableAgents"
                      :key="ag.alias"
                      class="popover-agent-item"
                      :class="{ disabled: isDreamAgentExists(ag.alias) }"
                      :disabled="isDreamAgentExists(ag.alias)"
                      @click="quickAddDreamAgent(ag.alias)"
                    >
                      <AgentAvatar :alias="ag.alias" :size="28" />
                      <span class="popover-agent-name">{{ ag.alias }}</span>
                      <span v-if="isDreamAgentExists(ag.alias)" class="popover-agent-added">已添加</span>
                      <span v-else class="material-symbols-outlined popover-agent-add">add_circle</span>
                    </button>
                    <div v-if="filteredAvailableAgents.length === 0" class="popover-empty">
                      没有可用的 Agent
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
          </template>
        </div>
      </template>
    </div>

    <!-- ===================== Raw Mode ===================== -->
    <div v-else class="content">
      <CodeEditor v-model="rawContent" :rows="32" placeholder="KEY=VALUE" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

// -- Layout / Common --
import PageHeader from '@/components/common/PageHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import CodeEditor from '@/components/common/CodeEditor.vue'
import CollapsibleSection from '@/components/config/CollapsibleSection.vue'
import AgentAvatar from '@/components/common/AgentAvatar.vue'
import ModelSelect from '@/components/config/ModelSelect.vue'

// -- Inline child component (defined below) --
import FieldRenderer from './FieldRenderer.vue'

// -- API --
import { getMainConfig, saveMainConfig } from '@/api/config'
import { getAgentMap } from '@/api/agents'
import { useUiStore } from '@/stores/ui'

// -- Utilities / Schema --
import { parseEnv, buildEnv, type EnvItem, type EnvEntry } from '@/utils/envParser'
import { CONFIG_TABS, type ConfigField, type ConfigTab } from '@/config/configSchema'

// Re-export type for template usage
type PairItem = { key: string; value: string }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const ui = useUiStore()

const loading = ref(false)
const saving = ref(false)
const rawMode = ref(false)
const rawContent = ref('')
const searchQuery = ref('')
const activeTabKey = ref<string>(CONFIG_TABS[0]?.key ?? 'connection')

// Parsed env items (preserves comments / ordering for buildEnv)
const envItems = ref<EnvItem[]>([])
// Original values snapshot (for dirty detection)
const originalValues = ref<Record<string, string>>({})
// Current edited values
const editedValues = ref<Record<string, string>>({})
// TVS file list
const tvsFiles = ref<string[]>([])
// Password visibility per field key
const passwordVisible = ref<Record<string, boolean>>({})

// Dream agent modal state
const agentMapEntries = ref<Array<{alias: string; file: string}>>([])
const addDreamOpen = ref(false)
const addDreamSearch = ref('')
const agentPopoverRef = ref<HTMLElement | null>(null)

// Search input readonly unlock
const searchInputRef = ref<HTMLInputElement | null>(null)
function unlockSearch() {
  searchInputRef.value?.removeAttribute('readonly')
}

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const activeTab = computed<ConfigTab | undefined>(() =>
  CONFIG_TABS.find(t => t.key === activeTabKey.value),
)

const isSearching = computed(() => searchQuery.value.trim().length > 0)

const dirtyKeys = computed<Set<string>>(() => {
  const set = new Set<string>()
  for (const [key, val] of Object.entries(editedValues.value)) {
    if (originalValues.value[key] !== val) set.add(key)
  }
  return set
})

const isDirty = computed(() => {
  if (rawMode.value) return rawContent.value !== buildEnv(envItems.value)
  return dirtyKeys.value.size > 0
})

const dirtyCount = computed(() => dirtyKeys.value.size)

function isFieldDirty(key: string): boolean {
  return dirtyKeys.value.has(key)
}

function tabDirtyCount(tabKey: string): number {
  const tab = CONFIG_TABS.find(t => t.key === tabKey)
  if (!tab) return 0
  let n = 0
  for (const sec of tab.sections) {
    for (const f of sec.fields) {
      if (f.type === 'dynamic-pairs') {
        for (const k of dirtyKeys.value) {
          if (isDynamicPairKey(f.key, k)) n++
        }
      } else {
        if (dirtyKeys.value.has(f.key)) n++
      }
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface SearchResult {
  field: ConfigField
  tabKey: string
  sectionId: string
}

const searchResults = computed<SearchResult[]>(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  if (!kw) return []
  const results: SearchResult[] = []
  for (const tab of CONFIG_TABS) {
    for (const sec of tab.sections) {
      for (const field of sec.fields) {
        if (
          field.key.toLowerCase().includes(kw) ||
          field.label.toLowerCase().includes(kw) ||
          (field.description ?? '').toLowerCase().includes(kw)
        ) {
          results.push({ field, tabKey: tab.key, sectionId: sec.id })
        }
      }
    }
  }
  return results
})

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function getEditedValue(key: string): string {
  if (key in editedValues.value) return editedValues.value[key]
  return originalValues.value[key] ?? ''
}

function onRawFieldInput(key: string, value: string) {
  editedValues.value[key] = value
}

// ---------------------------------------------------------------------------
// Dynamic pairs (Detector / SuperDetector)
// ---------------------------------------------------------------------------

function isDynamicPairKey(groupName: string, envKey: string): boolean {
  const baseRe = new RegExp(`^${groupName}\\d+$`)
  const outputRe = new RegExp(`^${groupName}_Output\\d+$`)
  return baseRe.test(envKey) || outputRe.test(envKey)
}

function getDynamicPairs(groupName: string): PairItem[] {
  const pairs: PairItem[] = []
  const allKeys = new Set([...Object.keys(originalValues.value), ...Object.keys(editedValues.value)])
  const indices = new Set<number>()
  const baseRe = new RegExp(`^${groupName}(\\d+)$`)
  for (const k of allKeys) {
    const m = baseRe.exec(k)
    if (m) indices.add(parseInt(m[1], 10))
  }
  const sorted = Array.from(indices).sort((a, b) => a - b)
  for (const idx of sorted) {
    const keyField = `${groupName}${idx}`
    const valField = `${groupName}_Output${idx}`
    const kv = getEditedValue(keyField)
    const vv = getEditedValue(valField)
    // Skip fully empty pairs (deleted)
    if (kv === '' && vv === '' && !(keyField in originalValues.value)) continue
    pairs.push({ key: kv, value: vv })
  }
  return pairs
}

function setDynamicPairs(groupName: string, pairs: PairItem[]) {
  // Clear all existing numbered keys for this group
  const baseRe = new RegExp(`^${groupName}\\d+$`)
  const outputRe = new RegExp(`^${groupName}_Output\\d+$`)
  const allKeys = new Set([...Object.keys(originalValues.value), ...Object.keys(editedValues.value)])
  for (const k of allKeys) {
    if (baseRe.test(k) || outputRe.test(k)) {
      editedValues.value[k] = ''
    }
  }
  // Write new pairs starting at index 1
  for (let i = 0; i < pairs.length; i++) {
    const idx = i + 1
    editedValues.value[`${groupName}${idx}`] = pairs[i].key
    editedValues.value[`${groupName}_Output${idx}`] = pairs[i].value
  }
}

// ---------------------------------------------------------------------------
// Tag-input conversion
// ---------------------------------------------------------------------------

function arrayToTags(arr: string[]): string {
  return arr.join(',')
}

// ---------------------------------------------------------------------------
// Field update handler
// ---------------------------------------------------------------------------

function onFieldUpdate(field: ConfigField, value: string) {
  editedValues.value[field.key] = value
}

// ---------------------------------------------------------------------------
// Dream agent groups
// ---------------------------------------------------------------------------

interface DreamAgentGroup {
  name: string
  chineseName: string
  entries: Array<{ key: string; description: string }>
}

const dreamAgentGroups = computed<DreamAgentGroup[]>(() => {
  const agentRe = /^DREAM_AGENT_(.+?)_(.+)$/
  const groupMap = new Map<string, Array<{ key: string; suffix: string }>>()
  const allKeys = new Set([...Object.keys(originalValues.value), ...Object.keys(editedValues.value)])
  for (const k of allKeys) {
    const m = agentRe.exec(k)
    if (m) {
      const name = m[1]
      if (name === 'LIST') continue
      if (!groupMap.has(name)) groupMap.set(name, [])
      groupMap.get(name)!.push({ key: k, suffix: m[2] })
    }
  }
  const groups: DreamAgentGroup[] = []
  const AGENT_SUFFIXES = ['MODEL_ID', 'CHINESE_NAME', 'SYSTEM_PROMPT', 'MAX_OUTPUT_TOKENS', 'TEMPERATURE']
  for (const [name, entries] of groupMap) {
    // Skip groups where all values are empty or deleted (removed agents)
    const hasAnyValue = AGENT_SUFFIXES.some(suffix => {
      const k = `DREAM_AGENT_${name}_${suffix}`
      return k in editedValues.value && editedValues.value[k] !== ''
    })
    if (!hasAnyValue) continue
    groups.push({
      name,
      chineseName: getEditedValue(`DREAM_AGENT_${name}_CHINESE_NAME`) || name,
      entries: entries.map(e => ({
        key: e.key,
        description: dreamAgentFieldDesc(e.suffix),
      })),
    })
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name))
})

function dreamAgentFieldDesc(suffix: string): string {
  const map: Record<string, string> = {
    MODEL_ID: '做梦使用的模型 ID',
    DIARY_NAME: '日记本名称',
    MAX_OUTPUT_TOKENS: '输出最大 Token',
    THINKING_BUDGET: '思维预算 Token',
    CONTEXT_LENGTH: '上下文长度',
  }
  return map[suffix] ?? suffix
}

// ---------------------------------------------------------------------------
// Dream agent modal helpers
// ---------------------------------------------------------------------------

async function fetchAgentMap() {
  try {
    const map = await getAgentMap()
    agentMapEntries.value = Object.entries(map).map(([alias, val]) => ({
      alias,
      file: typeof val === 'string' ? val : (val as any)?.prompt || '',
    }))
  } catch {
    agentMapEntries.value = []
  }
}

function openAddDreamAgent() {
  addDreamSearch.value = ''
  addDreamOpen.value = true
}

const filteredAvailableAgents = computed(() => {
  const kw = addDreamSearch.value.toLowerCase()
  return agentMapEntries.value.filter(ag =>
    !kw || ag.alias.toLowerCase().includes(kw),
  )
})

function isDreamAgentExists(alias: string): boolean {
  const name = alias.toUpperCase()
  return dreamAgentGroups.value.some(g => g.name === name)
}

function quickAddDreamAgent(alias: string) {
  if (isDreamAgentExists(alias)) return
  const name = alias.toUpperCase()
  editedValues.value[`DREAM_AGENT_${name}_MODEL_ID`] = 'gemini-2.5-flash-preview-05-20'
  editedValues.value[`DREAM_AGENT_${name}_CHINESE_NAME`] = alias
  editedValues.value[`DREAM_AGENT_${name}_SYSTEM_PROMPT`] = ''
  editedValues.value[`DREAM_AGENT_${name}_MAX_OUTPUT_TOKENS`] = '40000'
  editedValues.value[`DREAM_AGENT_${name}_TEMPERATURE`] = '0.85'
  const currentList = getEditedValue('DREAM_AGENT_LIST')
  const listArr = currentList.split(',').map(s => s.trim()).filter(Boolean)
  if (!listArr.includes(alias)) {
    listArr.push(alias)
    editedValues.value['DREAM_AGENT_LIST'] = listArr.join(',')
  }
  addDreamOpen.value = false
}

function onClickOutsidePopover(e: MouseEvent) {
  if (agentPopoverRef.value && !agentPopoverRef.value.contains(e.target as Node)) {
    addDreamOpen.value = false
  }
}

watch(addDreamOpen, (open) => {
  if (open) {
    setTimeout(() => document.addEventListener('mousedown', onClickOutsidePopover), 0)
  } else {
    document.removeEventListener('mousedown', onClickOutsidePopover)
  }
})

function removeDreamAgent(name: string) {
  const keys = ['MODEL_ID', 'CHINESE_NAME', 'SYSTEM_PROMPT', 'MAX_OUTPUT_TOKENS', 'TEMPERATURE']
  const currentList = getEditedValue('DREAM_AGENT_LIST')
  const chineseName = originalValues.value[`DREAM_AGENT_${name}_CHINESE_NAME`] || name
  for (const suffix of keys) {
    delete editedValues.value[`DREAM_AGENT_${name}_${suffix}`]
  }
  const listArr = currentList.split(',').map(s => s.trim()).filter(s => s && s !== chineseName && s.toUpperCase() !== name)
  editedValues.value['DREAM_AGENT_LIST'] = listArr.join(',')
}

// ---------------------------------------------------------------------------
// TVS files
// ---------------------------------------------------------------------------

async function fetchTvsFiles() {
  try {
    const res = await fetch('/admin_api/tvsvars', { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    tvsFiles.value = data.files ?? []
  } catch {
    tvsFiles.value = []
  }
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchTab(key: string) {
  activeTabKey.value = key
}

// ---------------------------------------------------------------------------
// Password visibility
// ---------------------------------------------------------------------------

function togglePassword(key: string) {
  passwordVisible.value[key] = !passwordVisible.value[key]
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

async function reload() {
  loading.value = true
  try {
    const data = await getMainConfig()
    const parsed = parseEnv(data.content)
    envItems.value = parsed
    rawContent.value = data.content

    const origMap: Record<string, string> = {}
    for (const item of parsed) {
      if (item.kind === 'entry') origMap[item.key] = item.value
    }
    originalValues.value = origMap
    editedValues.value = { ...origMap }
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    let content: string

    if (rawMode.value) {
      content = rawContent.value
    } else {
      // Merge editedValues back into parsed items
      const updatedItems = envItems.value.map(item => {
        if (item.kind !== 'entry') return item
        if (item.key in editedValues.value) {
          return { ...item, value: editedValues.value[item.key] }
        }
        return item
      })

      // Detect new entries not in original env (e.g., new dynamic-pair slots)
      const existingKeys = new Set(
        envItems.value.filter(i => i.kind === 'entry').map(i => (i as EnvEntry).key),
      )
      const newEntries: EnvItem[] = []
      for (const [key, val] of Object.entries(editedValues.value)) {
        if (!existingKeys.has(key) && val !== '') {
          newEntries.push({
            kind: 'entry',
            key,
            value: val,
            type: 'text',
            multiline: val.includes('\n'),
            description: '',
          })
        }
      }

      // Filter out entries that were fully cleared and did not originally exist
      const finalItems = updatedItems.filter(item => {
        if (item.kind !== 'entry') return true
        const edited = editedValues.value[item.key]
        if (edited === '' && !(item.key in originalValues.value)) return false
        return true
      })

      content = buildEnv([...finalItems, ...newEntries])
    }

    await saveMainConfig(content)

    // Re-parse for clean baseline
    const parsed = parseEnv(content)
    envItems.value = parsed
    rawContent.value = content
    const origMap: Record<string, string> = {}
    for (const item of parsed) {
      if (item.kind === 'entry') origMap[item.key] = item.value
    }
    originalValues.value = origMap
    editedValues.value = { ...origMap }

    ui.showMessage('配置已保存，重启服务生效', 'success')
  } catch {
    // apiFetch already handles error toast
  } finally {
    saving.value = false
  }
}

function toggleRawMode() {
  if (rawMode.value) {
    // Back to form: re-parse raw text
    const parsed = parseEnv(rawContent.value)
    envItems.value = parsed
    const origMap: Record<string, string> = {}
    for (const item of parsed) {
      if (item.kind === 'entry') origMap[item.key] = item.value
    }
    originalValues.value = origMap
    editedValues.value = { ...origMap }
    rawMode.value = false
  } else {
    // Switch to raw
    const updatedItems = envItems.value.map(item => {
      if (item.kind !== 'entry') return item
      if (item.key in editedValues.value) {
        return { ...item, value: editedValues.value[item.key] }
      }
      return item
    })
    rawContent.value = buildEnv(updatedItems)
    rawMode.value = true
  }
}

// Sync rawContent when editing in form mode
watch(editedValues, () => {
  if (!rawMode.value) {
    const updatedItems = envItems.value.map(item => {
      if (item.kind !== 'entry') return item
      if (item.key in editedValues.value) {
        return { ...item, value: editedValues.value[item.key] }
      }
      return item
    })
    rawContent.value = buildEnv(updatedItems)
  }
}, { deep: true })

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  reload()
  fetchTvsFiles()
  fetchAgentMap()
})
</script>

<style lang="scss" scoped>
.global-config {
  display: flex;
  flex-direction: column;
}

// ---------------------------------------------------------------------------
// Honeypot
// ---------------------------------------------------------------------------
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

// -- Header search (玻璃态) --
.search-input {
  padding: 7px 14px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  width: 200px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(8px);
  color: var(--primary-text);
  transition: all 0.2s;
  &:focus {
    outline: none;
    border-color: rgba(212, 116, 142, 0.45);
    box-shadow: 0 0 0 3px rgba(212, 116, 142, 0.12);
    background: rgba(255, 255, 255, 0.75);
  }
  &::placeholder { color: var(--secondary-text); }
}

// -- Save dirty badge --
.dirty-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #d4748e, #c4647e);
  border-radius: var(--radius-pill);
  box-shadow: 0 1px 4px rgba(212, 116, 142, 0.35);
}

// -- Dirty banner (玻璃态) --
.dirty-banner {
  margin: 0 24px 14px;
  padding: 10px 18px;
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.12), rgba(212, 116, 142, 0.04));
  border: 1px solid rgba(212, 116, 142, 0.28);
  border-left: 3px solid var(--highlight-text);
  border-radius: var(--radius-md);
  color: var(--highlight-text);
  font-size: 13px;
  font-weight: 500;
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 8px rgba(212, 116, 142, 0.08);
}

.content { padding: 0 24px 24px; flex: 1; min-height: 0; }

// -- Tab bar (玻璃态卡片) --
.tab-bar {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  margin-bottom: 20px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--secondary-text);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    background: var(--accent-bg);
    color: var(--primary-text);
    .tab-icon { color: var(--primary-text); }
  }

  &.active {
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.14), rgba(212, 116, 142, 0.05));
    border-color: rgba(212, 116, 142, 0.32);
    color: var(--highlight-text);
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(212, 116, 142, 0.14);
    .tab-icon { color: var(--highlight-text); }
  }

  .tab-icon {
    font-size: 18px;
    color: var(--secondary-text);
    transition: color 0.2s ease;
  }
}

.tab-dirty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #d4748e, #c4647e);
  border-radius: var(--radius-pill);
  box-shadow: 0 1px 3px rgba(212, 116, 142, 0.3);
}

// -- Tab content --
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

// -- Section block (玻璃态卡片容器) --
.section-block {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);
  padding: 20px 22px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.section-icon {
  font-size: 22px;
  color: #fff;
  background: linear-gradient(135deg, #d4748e, #c4647e);
  padding: 6px;
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 8px rgba(212, 116, 142, 0.28);
  flex-shrink: 0;
}

.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--primary-text);
  letter-spacing: 0.2px;
}

.section-hint {
  font-size: 12px;
  color: var(--secondary-text);
  margin-left: auto;
}

.section-desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;
}

// -- Field grid --
// 严格 2 列网格：half 字段稳定成对，full 字段 span 全宽
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: auto; // 让卡片按内容自适应，不拉伸
  align-items: start; // 短卡（如 boolean）不会被拉伸到和长卡等高
  gap: 14px;
}

.grid-cell.full { grid-column: 1 / -1; }

@media (max-width: 860px) {
  .field-grid { grid-template-columns: 1fr; }
  .grid-cell.half { grid-column: 1 / -1; }
}

// -- Field wrapper --
.field-wrap {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.6);
    border-color: rgba(212, 116, 142, 0.2);
  }

  &.dirty {
    border-left: 3px solid var(--highlight-text);
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.06), rgba(255, 255, 255, 0.5));
  }
}

.field-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.field-key {
  font-size: 10px;
  color: var(--secondary-text);
  background: var(--accent-bg);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-weight: 500;
}

.field-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--secondary-text);
  line-height: 1.6;
}

// -- Search results --
.search-results {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);
  padding: 20px 22px;
  margin-top: 8px;
}

.search-results-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.12), rgba(212, 116, 142, 0.03));
  border: 1px solid rgba(212, 116, 142, 0.25);
  border-radius: var(--radius-md);
  color: var(--highlight-text);
  font-size: 13px;
  font-weight: 500;
  backdrop-filter: blur(8px);
  .material-symbols-outlined { font-size: 18px; }
}

.clear-search {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--secondary-text);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  transition: all 0.15s;
  &:hover { background: rgba(217, 85, 85, 0.1); color: var(--danger-color); }
  .material-symbols-outlined { font-size: 14px; }
}

.no-search-result {
  padding: 60px 20px;
  text-align: center;
  color: var(--secondary-text);
  .material-symbols-outlined {
    font-size: 48px;
    opacity: 0.35;
    display: block;
    margin: 0 auto 8px;
  }
  p { margin: 0; font-size: 14px; }
}

// -- Dream agent section (玻璃态卡片容器) --
.dream-agents-section {
  position: relative;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--card-shadow);
  backdrop-filter: var(--glass-blur);
  padding: 20px 22px;

  .btn-small {
    padding: 6px 14px;
    font-size: 12px;
    margin-left: auto;
    background: linear-gradient(135deg, var(--button-bg), var(--button-hover-bg));
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(212, 116, 142, 0.25);
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(212, 116, 142, 0.35);
    }
    .material-symbols-outlined { font-size: 16px; }
  }
}

.dream-empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--secondary-text);
  font-size: 14px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  margin-top: 14px;
  background: rgba(255, 255, 255, 0.25);
}

.dream-agent-card {
  margin-top: 14px;
  padding: 18px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--highlight-text);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.6);
    border-color: rgba(212, 116, 142, 0.35);
    box-shadow: 0 4px 14px rgba(212, 116, 142, 0.1);
  }
}

.dream-card-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-color);

  .dream-card-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;

    strong {
      font-size: 16px;
      color: var(--primary-text);
      font-weight: 600;
    }

    .dream-card-id {
      font-size: 11px;
      color: var(--secondary-text);
      font-family: 'JetBrains Mono', monospace;
      background: var(--accent-bg);
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      display: inline-block;
      width: fit-content;
    }
  }

  .btn-danger {
    background: transparent;
    border: 1px solid rgba(217, 85, 85, 0.25);
    color: var(--secondary-text);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    &:hover {
      background: rgba(217, 85, 85, 0.1);
      color: var(--danger-color);
      border-color: rgba(217, 85, 85, 0.45);
    }
    .material-symbols-outlined { font-size: 18px; }
  }
}

.dream-card-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;

  .dream-field {
    &.full { grid-column: 1 / -1; }

    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: var(--secondary-text);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    input[type="text"],
    input[type="number"] {
      width: 100%;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.55);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--primary-text);
      font-size: 13px;
      transition: all 0.2s;
      &:focus {
        outline: none;
        border-color: rgba(212, 116, 142, 0.45);
        box-shadow: 0 0 0 3px rgba(212, 116, 142, 0.1);
        background: rgba(255, 255, 255, 0.75);
      }
    }
  }
}

// -- Agent picker popover (玻璃态) --
.dream-agent-popover {
  position: absolute;
  top: 58px;
  right: 22px;
  width: 340px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(212, 116, 142, 0.12);
  backdrop-filter: var(--glass-blur);
  z-index: 60;
  overflow: hidden;
}

.popover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(212, 116, 142, 0.12), rgba(212, 116, 142, 0.03));
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-text);

  .material-symbols-outlined { font-size: 18px; color: var(--highlight-text); }

  .popover-close {
    margin-left: auto;
    background: transparent;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: all 0.15s;
    &:hover { color: var(--primary-text); background: var(--accent-bg); }
    .material-symbols-outlined { font-size: 16px; }
  }
}

.popover-search {
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  color: var(--primary-text);
  font-size: 13px;
  outline: none;
  &::placeholder { color: var(--secondary-text); }
}

.popover-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
}

.popover-agent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--primary-text);
  font-size: 13px;
  transition: all 0.15s;

  &:hover:not(.disabled) {
    background: linear-gradient(135deg, rgba(212, 116, 142, 0.08), rgba(212, 116, 142, 0.02));
  }
  &.disabled { opacity: 0.4; cursor: not-allowed; }

  .popover-agent-name { flex: 1; font-weight: 500; }
  .popover-agent-added { font-size: 11px; color: var(--secondary-text); font-style: italic; }
  .popover-agent-add {
    font-size: 20px;
    color: var(--highlight-text);
    opacity: 0;
    transition: opacity 0.15s, transform 0.15s;
  }
  &:hover:not(.disabled) .popover-agent-add {
    opacity: 1;
    transform: scale(1.1);
  }
}

.popover-empty {
  padding: 28px;
  text-align: center;
  color: var(--secondary-text);
  font-size: 13px;
}

.popover-enter-active, .popover-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.popover-enter-from, .popover-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.input-with-unit {
  display: flex;
  align-items: center;
  gap: 8px;
  input { flex: 1; }
  .unit-label {
    font-size: 12px;
    color: var(--secondary-text);
    white-space: nowrap;
    font-weight: 500;
  }
}
</style>
