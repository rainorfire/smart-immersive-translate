import type { TranslateProvider } from './provider'
import { bingProvider } from './providers/bing'
import { openaiCompatibleProvider } from './providers/openai-compatible'

const providers = new Map<string, TranslateProvider>()

for (const p of [bingProvider, openaiCompatibleProvider]) {
  providers.set(p.id, p)
}

export function getProvider(id: string): TranslateProvider {
  const p = providers.get(id)
  if (!p) throw new Error(`未知引擎：${id}`)
  return p
}

export function listProviders(): TranslateProvider[] {
  return [...providers.values()]
}
