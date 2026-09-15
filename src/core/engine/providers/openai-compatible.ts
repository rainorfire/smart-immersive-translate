import type { EngineConfig, TranslateRequest, TranslateResult } from '@/shared/types'
import { classifyHttpStatus, type TranslateProvider } from '../provider'
import { getVendor } from '../vendors'

/**
 * OpenAI 兼容协议的通用适配器。
 *
 * 一个适配器覆盖全部国内主流模型（DeepSeek / Kimi / 通义 / 智谱 /
 * SiliconFlow / 火山方舟 / 千帆 / 阶跃）+ OpenRouter + 本地 Ollama
 * + 任意自定义端点，差异仅由厂商预设表提供 baseUrl 与默认模型。
 *
 * 相比免费引擎，LLM 引擎需要更保守的 batch 上限，因为要受 token 约束。
 */

/** 系统提示：要求模型严格按行返回，保持行数与顺序一致 */
const SYSTEM_PROMPT = `You are a professional translator. Translate each line of the user input into the target language.
Rules:
1. Output exactly the same number of lines as the input, in the same order.
2. Output ONLY the translations, one per line. No numbering, no explanations, no extra text.
3. Preserve formatting, placeholders like {name}, and inline tags like <b>...</b> as-is.`

/** 用行分隔多条文本，要求模型按行返回 */
const SEP = '\n'

function resolveEndpoint(config: EngineConfig): { url: string; model: string; apiKey: string } {
  const vendor = config.vendor ? getVendor(config.vendor) : undefined
  const baseUrl = (config.baseUrl || vendor?.baseUrl || '').replace(/\/+$/, '')
  const model = config.model || vendor?.model || ''
  const apiKey = config.apiKey ?? ''

  if (!baseUrl) throw new Error('未配置 Base URL')
  if (!model) throw new Error('未配置模型名')

  return { url: `${baseUrl}/chat/completions`, model, apiKey }
}

export const openaiCompatibleProvider: TranslateProvider = {
  id: 'openai-compatible',
  name: 'OpenAI 兼容（大模型）',
  // LLM 受 token 约束，单条与整组都要压得更小
  maxTextLengthPerRequest: 1200,
  maxTextGroupLengthPerRequest: 3000,
  concurrency: 2,
  requiresAuth: true,

  async translate(req: TranslateRequest, config: EngineConfig): Promise<TranslateResult> {
    const translations: Record<string, string> = {}
    const failed: Record<string, string> = {}
    if (req.items.length === 0) return { translations, failed }

    let endpoint: { url: string; model: string; apiKey: string }
    try {
      endpoint = resolveEndpoint(config)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      for (const item of req.items) failed[item.id] = msg
      return { translations, failed }
    }

    const payload = req.items.map((item) => item.text).join(SEP)

    let res: Response
    try {
      res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: endpoint.model,
          temperature: 0,
          stream: false,
          messages: [
            {
              role: 'system',
              content: `${SYSTEM_PROMPT}\nTarget language: ${req.target}. Source language: ${req.source === 'auto' ? 'auto-detect' : req.source}.`,
            },
            { role: 'user', content: payload },
          ],
        }),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      for (const item of req.items) failed[item.id] = msg
      return { translations, failed }
    }

    if (!res.ok) {
      const err = classifyHttpStatus(res.status)
      for (const item of req.items) failed[item.id] = err.message
      return { translations, failed }
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data.choices?.[0]?.message?.content ?? ''
    const lines = raw.split('\n').map((l) => l.trim())

    // 行数不匹配时整体判失败，避免错误对齐
    if (lines.length !== req.items.length) {
      for (const item of req.items) {
        failed[item.id] = `返回行数与请求不一致（期望 ${req.items.length}，实际 ${lines.length}）`
      }
      return { translations, failed }
    }

    req.items.forEach((item, index) => {
      const text = lines[index]
      if (text) translations[item.id] = text
      else failed[item.id] = '模型返回空译文'
    })

    return { translations, failed }
  },
}
