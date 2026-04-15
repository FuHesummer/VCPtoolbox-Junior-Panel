// 运维中心 API
import { apiFetch } from './client'

export type DangerLevel = 'low' | 'medium' | 'high'
export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface ScriptArgDef {
  name: string
  label: string
  placeholder?: string
  required?: boolean
}

export interface ScriptDef {
  id: string
  title: string
  description: string
  category: string
  categoryLabel: string
  danger: DangerLevel
  requiresStopServer: boolean
  icon: string
  args: ScriptArgDef[]
}

export interface JobSummary {
  id: string
  scriptId: string
  title: string
  danger: DangerLevel
  cmd: string
  startedAt: string
  finishedAt: string | null
  status: JobStatus
  exitCode: number | null
  initiator: string
}

export interface HistoryRecord extends JobSummary {
  durationMs: number
  stderrLines: number
  logBytes: number
  finishedAt: string
}

export interface RunResponse {
  success: boolean
  job?: JobSummary
  error?: string
  currentJobId?: string
  currentTitle?: string
}

export function listScripts() {
  return apiFetch<{ success: boolean; scripts: ScriptDef[]; categories: Record<string, string> }>(
    '/admin_api/maintenance/scripts',
    { showLoader: false, suppressErrorToast: true },
  )
}

export function getCurrentJob() {
  return apiFetch<{ success: boolean; job: JobSummary | null; output: string }>(
    '/admin_api/maintenance/jobs/current',
    { showLoader: false, suppressErrorToast: true },
  )
}

export function getJob(id: string) {
  return apiFetch<{ success: boolean; job: JobSummary | HistoryRecord; output: string }>(
    `/admin_api/maintenance/jobs/${encodeURIComponent(id)}`,
    { showLoader: false },
  )
}

export function runScript(scriptId: string, args: Record<string, string> = {}) {
  return apiFetch<RunResponse>('/admin_api/maintenance/run', {
    method: 'POST',
    body: JSON.stringify({ scriptId, args }),
    showLoader: false,
    suppressErrorToast: true,
  })
}

export function cancelJob(id: string) {
  return apiFetch<{ success: boolean }>(`/admin_api/maintenance/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    showLoader: false,
  })
}

export function getHistory(limit = 50) {
  return apiFetch<{ success: boolean; items: HistoryRecord[] }>(
    `/admin_api/maintenance/history?limit=${limit}`,
    { showLoader: false, suppressErrorToast: true },
  )
}

// SSE 订阅实时日志流
// 返回 close 函数，调用后关闭连接
export interface StreamHandlers {
  onReplay?: (text: string) => void
  onChunk?: (kind: 'stdout' | 'stderr', text: string) => void
  onDone?: (info: { status: JobStatus; exitCode: number | null; finishedAt: string; cancelled: boolean }) => void
  onError?: (err: Event) => void
}

export function streamJob(id: string, handlers: StreamHandlers): () => void {
  const url = `/admin_api/maintenance/jobs/${encodeURIComponent(id)}/stream`
  const es = new EventSource(url, { withCredentials: true })

  es.addEventListener('replay', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data)
      handlers.onReplay?.(data.text || '')
    } catch { /* ignore */ }
  })

  es.addEventListener('chunk', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data)
      handlers.onChunk?.(data.kind, data.text || '')
    } catch { /* ignore */ }
  })

  es.addEventListener('done', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data)
      handlers.onDone?.(data)
    } catch { /* ignore */ }
    es.close()
  })

  es.onerror = (e) => {
    handlers.onError?.(e)
  }

  return () => es.close()
}
