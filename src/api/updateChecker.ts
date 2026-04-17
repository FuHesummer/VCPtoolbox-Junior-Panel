export interface UpdateInfo {
  current: string
  latest: string | null
  name: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  publishedAt: string | null
}

export interface UpdateCheckResult {
  backend: UpdateInfo
  panel: UpdateInfo
  checkedAt: string
}

export async function checkUpdates(): Promise<UpdateCheckResult> {
  const res = await fetch('/admin_api/check-updates')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function forceCheckUpdates(): Promise<UpdateCheckResult> {
  const res = await fetch('/admin_api/check-updates', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
