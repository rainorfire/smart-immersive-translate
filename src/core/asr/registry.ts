import type { AsrConfig, AsrProviderId } from '@/shared/types'
import type { AsrProvider } from './provider'
import { openaiAsrProvider } from './providers/openai-asr'
import { aliyunNlsProvider } from './providers/aliyun-nls'
import { tencentAsrProvider } from './providers/tencent-asr'
import { localWhisperProvider } from './providers/local-whisper'

/**
 * ASR 引擎注册表。
 *
 * 与翻译引擎注册表（`core/engine/registry.ts`）平行且独立——
 * 语音翻译的引擎切换不影响文本翻译的引擎。
 */

const providers = new Map<string, AsrProvider>()

for (const p of [openaiAsrProvider, aliyunNlsProvider, tencentAsrProvider, localWhisperProvider]) {
  providers.set(p.id, p)
}

export function getAsrProvider(id: AsrProviderId | string): AsrProvider {
  const p = providers.get(id)
  if (!p) throw new Error(`未知语音识别引擎：${id}`)
  return p
}

export function listAsrProviders(): AsrProvider[] {
  return [...providers.values()]
}
