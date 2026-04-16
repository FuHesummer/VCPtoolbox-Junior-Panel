// 上游 VCPToolBox 一键迁移 API
import { apiFetch } from './client'

// ============ 类型定义 ============

export interface ScanAgent { name: string; promptFile: string; size: number }
export interface ScanDailynote {
  name: string
  relPath: string
  fileCount: number
  size: number
  suggest: 'personal' | 'public'
}
export interface ScanPlugin {
  name: string
  enabled: boolean
  manifest: { version?: string; pluginType?: string; displayName?: string; description?: string } | null
  configFiles: string[]
  size: number
}
export interface ScanTvs { name: string; relPath: string; size: number }
export interface ScanImage { name: string; relPath: string; fileCount: number; size: number }
export interface ScanVector { plugin: string; relPath: string; size: number }
export interface ConfigEnvKey { key: string; value: string; lineNum: number }
export interface ScanAgentMap {
  source: string
  format: 'legacy-string' | 'new-object' | 'unknown'
  entries: number
  raw: Record<string, unknown>
}

export interface ScanResult {
  valid: boolean
  reason?: string
  sourcePath: string
  scanAt?: string
  agents: ScanAgent[]
  dailynotes: ScanDailynote[]
  plugins: ScanPlugin[]
  tvs: ScanTvs[]
  images: ScanImage[]
  vectors: ScanVector[]
  configEnv: { keys: ConfigEnvKey[]; totalLines: number; error?: string } | null
  agentMap: ScanAgentMap | null
  summary: Record<string, number>
}

export interface ConfigConflict {
  key: string
  sourceValue: string
  juniorValue: string
  sourceLineNum: number
  juniorLineNum: number
}
export interface ConfigDiff {
  available: boolean
  reason?: string
  juniorSource?: string
  addedFromSource: Array<{ key: string; sourceValue: string; sourceLineNum: number }>
  conflicts: ConfigConflict[]
  sameValue: Array<{ key: string; value: string }>
  juniorOnly: Array<{ key: string; juniorValue: string }>
  summary: { add: number; conflict: number; same: number; juniorOnly: number }
}

export interface PluginMatch {
  installable: Array<{
    name: string
    upstreamSize: number
    repoSize: number
    hasUpstreamConfig: boolean
    repoDefaultEnabled: boolean
    repoBlocked: boolean
    upstreamEnabled: boolean
  }>
  builtin: Array<{ name: string; reason: string }>
  notInRepo: Array<{ name: string; reason: string }>
  repoRoot: string
  repoExists: boolean
}

export interface DailynoteDecision {
  sourceName: string
  targetType: 'personal' | 'public' | 'skip'
  agentName?: string
  publicDirName?: string
}
export interface PluginInstallDecision {
  name: string
  mergeConfig?: boolean
  copyVectorStore?: boolean
  enable?: boolean
}
export interface ConfigMergeDecisions {
  add: Record<string, boolean>
  conflicts: Record<string, 'use_upstream' | 'use_junior' | { custom: string }>
}

export interface MigrationPlan {
  sourcePath: string
  doBackup?: boolean
  agents?: string[]
  dailynotes?: DailynoteDecision[]
  tvs?: string[]
  images?: string[]
  plugins?: PluginInstallDecision[]
  configMerge?: ConfigMergeDecisions
  copyVectors?: boolean
}

export interface MigrationJobStatus {
  running: boolean
  jobId?: string
  label?: string
  startedAt?: string
  cancelRequested?: boolean
}
export interface BackupItem {
  name: string
  relPath: string
  size: number
  sizeHuman: string
  createdAt: string
}
export interface HistoryEntry {
  jobId: string
  startedAt: string
  finishedAt?: string
  status: 'success' | 'error' | 'cancelled'
  sourcePath: string
  stages: Record<string, unknown>
  error?: string
}

export interface SseLogEvent {
  level: 'info' | 'progress' | 'warn' | 'error' | 'done'
  stage: string
  message: string
  ts: string
}

// ============ API ============

export async function scanSource(sourcePath: string): Promise<ScanResult> {
  return apiFetch('/admin_api/migration/scan', {
    method: 'POST',
    body: { sourcePath },
  })
}

export async function diffConfig(sourcePath: string): Promise<ConfigDiff> {
  return apiFetch('/admin_api/migration/diff-config', {
    method: 'POST',
    body: { sourcePath },
  })
}

export async function matchPlugins(plugins: ScanPlugin[]): Promise<PluginMatch> {
  return apiFetch('/admin_api/migration/match-plugins', {
    method: 'POST',
    body: { plugins },
  })
}

export async function createBackup(label?: string): Promise<{ success: boolean; relPath?: string; sizeHuman?: string }> {
  return apiFetch('/admin_api/migration/backup', {
    method: 'POST',
    body: { label },
  })
}

export async function listBackups(): Promise<BackupItem[]> {
  return apiFetch('/admin_api/migration/backups')
}

export async function readHistory(): Promise<HistoryEntry[]> {
  return apiFetch('/admin_api/migration/history')
}

export async function getStatus(): Promise<MigrationJobStatus> {
  return apiFetch('/admin_api/migration/status')
}

export async function cancel(jobId?: string): Promise<{ ok: boolean }> {
  return apiFetch('/admin_api/migration/cancel', {
    method: 'POST',
    body: jobId ? { jobId } : {},
  })
}

/**
 * 执行迁移（SSE 流式）
 * @returns Promise<void>，onLog 在每条事件到达时调用
 */
export function executeMigration(
  plan: MigrationPlan,
  handlers: {
    onOpen?: (jobId: string) => void
    onLog?: (evt: SseLogEvent) => void
    onDone?: (summary: HistoryEntry) => void
    onFatal?: (err: string) => void
  },
): { abort: () => void } {
  const controller = new AbortController()

  fetch('/admin_api/migration/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
    signal: controller.signal,
  })
    .then(async res => {
      if (!res.ok) {
        const text = await res.text()
        handlers.onFatal?.(`HTTP ${res.status}: ${text}`)
        return
      }
      if (!res.body) {
        handlers.onFatal?.('无响应体')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\n\n/)
        buffer = events.pop() || ''
        for (const evtBlock of events) {
          const lines = evtBlock.split('\n')
          let type = 'message'
          let dataStr = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) type = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataStr = line.slice(6)
          }
          if (!dataStr) continue
          try {
            const parsed = JSON.parse(dataStr)
            if (type === 'open') handlers.onOpen?.(parsed.jobId)
            else if (type === 'log') handlers.onLog?.(parsed)
            else if (type === 'done') handlers.onDone?.(parsed)
            else if (type === 'fatal') handlers.onFatal?.(parsed.error || 'unknown')
          } catch {}
        }
      }
    })
    .catch(err => {
      if (err.name !== 'AbortError') handlers.onFatal?.(err.message)
    })

  return { abort: () => controller.abort() }
}

// ============ 工具函数 ============

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
