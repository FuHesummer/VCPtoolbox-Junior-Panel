// 上游 VCPToolBox 一键迁移 + VCPBackUp 备份管理 API
import { apiFetch } from './client'

// ============ 类型定义 ============

export interface ScanAgent {
  name: string
  promptFile: string
  size: number
  structure?: 'flat' | 'nested'
  diary?: { relPath: string; fileCount: number; size: number } | null
  knowledge?: Array<{ name: string; relPath: string; fileCount: number; size: number }>
}
export interface ScanDailynote {
  name: string
  relPath: string
  fileCount: number
  size: number
  suggest: 'personal' | 'public'
}
export interface ScanKnowledge {
  name: string
  relPath: string
  fileCount: number
  size: number
  suggest: 'public' | 'auto'
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

export type SourceType = 'dir' | 'vcpserver-zip' | 'vcpfull-zip' | 'generic-zip'

export interface ScanResult {
  valid: boolean
  reason?: string
  sourcePath: string
  sourceType?: SourceType
  scanAt?: string
  agents: ScanAgent[]
  dailynotes: ScanDailynote[]
  knowledge: ScanKnowledge[]
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

export interface InstallableItem {
  name: string
  source: 'localRepo' | 'remoteStore'
  upstreamSize: number
  hasUpstreamConfig: boolean
  upstreamEnabled: boolean
  // localRepo 独有
  repoSize?: number
  repoDefaultEnabled?: boolean
  repoBlocked?: boolean
  // remoteStore 独有
  remoteVersion?: string
  remoteDisplayName?: string
  remoteDescription?: string
}

export interface PluginMatch {
  installable: InstallableItem[]
  builtin: Array<{ name: string; reason: string }>
  notAvailable: Array<{ name: string; reason: string }>
  sources: {
    localRepoPath: string | null
    remoteStoreSize: number
  }
}

export interface DailynoteDecision {
  sourceName: string
  targetType: 'personal' | 'public' | 'skip'
  agentName?: string
  publicDirName?: string
}
export interface KnowledgeDecision {
  sourceName: string
  targetType: 'personal' | 'public' | 'skip'
  agentName?: string
  publicDirName?: string
}
export interface PluginInstallDecision {
  name: string
  source?: 'localRepo' | 'remoteStore' | 'auto'
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
  knowledge?: KnowledgeDecision[]
  tvs?: string[]
  images?: string[]
  plugins?: PluginInstallDecision[]
  configMerge?: ConfigMergeDecisions
  copyVectors?: boolean
}

export interface AutoPlanResult {
  plan: MigrationPlan
  scan: ScanResult
  match: PluginMatch
  summary: {
    agents: number
    dailynotes: number
    knowledge: number
    tvs: number
    images: number
    pluginsInstallable: number
    pluginsBuiltin: number
    pluginsSkipped: number
  }
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

// 🪄 智能推荐：一键生成完整默认 plan
export async function autoPlan(sourcePath: string): Promise<AutoPlanResult> {
  return apiFetch('/admin_api/migration/auto-plan', {
    method: 'POST',
    body: { sourcePath },
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

// ============ 上传 VCPBackUp zip ============

export interface UploadResponse {
  ok: boolean
  sourcePath: string
  filename: string
  savedAs: string
  size: number
  note?: string
}

export interface UploadedItem {
  filename: string
  absPath: string
  size: number
  createdAt: string
}

// 上传 VCPBackUp zip（multipart/form-data）
export async function uploadSource(file: File): Promise<UploadResponse> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/admin_api/migration/upload', { method: 'POST', body: fd })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return await res.json()
}

export async function listUploads(): Promise<UploadedItem[]> {
  return apiFetch('/admin_api/migration/uploads')
}

export async function deleteUpload(name: string): Promise<{ ok: boolean }> {
  return apiFetch(`/admin_api/migration/uploads/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

// ============ 坚果云 WebDAV ============

export interface WebdavConfig {
  enabled: boolean
  url: string
  basePath: string
  userConfigured: boolean
  passwordConfigured: boolean
}

export interface WebdavTestResult {
  ok: boolean
  error?: string
  statusCode?: number
  url?: string
  created?: boolean
}

export interface WebdavItem {
  filename: string
  href: string
  isDirectory: boolean
  size: number
  lastModified: string | null
}

export interface WebdavDownloadResult {
  ok: boolean
  localPath: string
  sourcePath: string
  size: number
}

export async function getWebdavConfig(): Promise<WebdavConfig> {
  return apiFetch('/admin_api/migration/webdav/config')
}

export async function testWebdav(): Promise<WebdavTestResult> {
  return apiFetch('/admin_api/migration/webdav/test', { method: 'POST' })
}

export async function listWebdavBackups(): Promise<WebdavItem[]> {
  return apiFetch('/admin_api/migration/webdav/list')
}

export async function downloadFromWebdav(filename: string): Promise<WebdavDownloadResult> {
  return apiFetch('/admin_api/migration/webdav/download', {
    method: 'POST',
    body: { filename },
  })
}

export async function uploadToWebdav(filePath: string, remoteName?: string): Promise<{ ok: boolean; statusCode: number; remoteName: string; size: number }> {
  return apiFetch('/admin_api/migration/webdav/upload', {
    method: 'POST',
    body: { filePath, remoteName },
  })
}

export async function removeWebdavFile(filename: string): Promise<{ ok: boolean }> {
  return apiFetch(`/admin_api/migration/webdav/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}

// ============ 导出 VCPBackUp 兼容包 ============

export interface ExportItem {
  name: string
  filename?: string           // 仅 exportBackup 直接返回时有，listExports 用 name
  relPath: string
  absPath: string
  size: number
  sizeHuman: string
  createdAt: string
  type: 'full' | 'server'
  fileCount?: number
  innerZip?: string
}

export interface ExportResult {
  ok: boolean
  server: ExportItem
  full?: ExportItem
  upload?: { ok: boolean; remoteName: string; size: number }
}

export async function exportBackup(opts?: { asFull?: boolean; uploadToWebdav?: boolean }): Promise<ExportResult> {
  return apiFetch('/admin_api/migration/export', {
    method: 'POST',
    body: opts || {},
  })
}

export async function listExports(): Promise<ExportItem[]> {
  return apiFetch('/admin_api/migration/exports')
}

export async function deleteExport(name: string): Promise<{ ok: boolean }> {
  return apiFetch(`/admin_api/migration/exports/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

// 触发浏览器下载
export function downloadExportUrl(name: string): string {
  return `/admin_api/migration/exports/${encodeURIComponent(name)}/download`
}

// ============ 定期备份调度 ============

export interface BackupScheduleConfig {
  enabled: boolean
  cron: string
  keepCount: number
  keepDays: number
  uploadToWebdav: boolean
  uploadAsFull: boolean
  lastRun: string | null
  lastStatus: 'success' | 'error' | null
  active?: boolean
  nextInvocation?: string | null
}

export interface BackupScheduleHistory {
  startedAt: string
  finishedAt?: string
  trigger: 'manual' | 'cron'
  status: 'running' | 'success' | 'error'
  error?: string
  stages: Record<string, unknown>
}

export async function getSchedule(): Promise<BackupScheduleConfig> {
  return apiFetch('/admin_api/migration/schedule')
}

export async function setSchedule(patch: Partial<BackupScheduleConfig>): Promise<{ ok: boolean; config: BackupScheduleConfig; applied: { scheduled: boolean; cron?: string; nextInvocation?: string | null; error?: string } }> {
  return apiFetch('/admin_api/migration/schedule', {
    method: 'POST',
    body: patch,
  })
}

export async function triggerSchedule(): Promise<BackupScheduleHistory> {
  return apiFetch('/admin_api/migration/schedule/trigger', { method: 'POST' })
}

export async function getScheduleHistory(): Promise<BackupScheduleHistory[]> {
  return apiFetch('/admin_api/migration/schedule/history')
}

// ============ 临时目录管理 ============

export interface TempDirItem {
  name: string
  path: string
  createdAt: string
}

export async function listTempDirs(): Promise<TempDirItem[]> {
  return apiFetch('/admin_api/migration/temp-list')
}

export async function cleanupTemp(): Promise<{ removed: number; error?: string }> {
  return apiFetch('/admin_api/migration/cleanup-temp', { method: 'POST' })
}

// ============ 工具函数 ============

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// 标签化源类型
export function sourceTypeLabel(type?: SourceType): string {
  if (!type) return '未知'
  return {
    'dir': '本地目录',
    'vcpserver-zip': 'VCPServer 备份包',
    'vcpfull-zip': 'VCP 全家桶包',
    'generic-zip': 'ZIP 压缩包',
  }[type] || type
}
