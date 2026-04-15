// 模型专属指令（SarModel / SarPrompt）API
import { apiFetch } from './client'

export interface SarPromptItem {
  index: number
  models: string[]
  prompt: string
}

export function listSarPrompts() {
  return apiFetch<{ success: boolean; items: SarPromptItem[] }>(
    '/admin_api/sar-prompts',
    { showLoader: false, suppressErrorToast: true },
  )
}

export function saveSarPrompts(items: SarPromptItem[], restart = false) {
  const qs = restart ? '?restart=1' : ''
  return apiFetch<{ success: boolean; message: string; count: number }>(
    `/admin_api/sar-prompts${qs}`,
    {
      method: 'POST',
      body: JSON.stringify({ items }),
      showLoader: false,
    },
  )
}
