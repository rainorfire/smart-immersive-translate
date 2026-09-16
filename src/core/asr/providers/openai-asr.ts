import { getVendor } from '@/core/engine/vendors'
import type { AsrConfig } from '@/shared/types'
import {
  AsrError,
  classifyAsrStatus,
  type AsrProvider,
  type AsrResult,
  type AudioChunk,
} from '../provider'

/**
 * A 路：OpenAI 兼容的 `/audio/transcriptions`。
 *
 * 一个适配器覆盖：OpenAI Whisper、硅基流动（SenseVoice / FunAudioLLM）、
 * 通义 paraformer、以及任意自建兼容端点 —— 差异只由厂商预设表提供 baseUrl。
 * 端点实测（2026-09-16）：硅基流动 `api.siliconflow.cn/v1/audio/transcriptions`
 * 返回 401（缺鉴权），说明端点存在。
 *
 * 请求形态：multipart/form-data，字段 file / model / response_format。
 * 这里要求 verbose_json 以便拿到逐句时间轴（segment 级），用于字幕对齐。
 */
export const openaiAsrProvider: AsrProvider = {
  id: 'openai-asr',
  name: 'OpenAI 兼容（Whisper / SenseVoice）',
  requiresAuth: true,
  mode: 'batch',
  recommendedChunkSeconds: 20,

  validate(config: AsrConfig): string | null {
    if (!resolve(config).apiKey) return '未填写 API Key'
    if (!resolve(config).baseUrl) return '未配置 Base URL'
    if (!resolve(config).model) return '未配置语音模型名'
    return null
  },

  async transcribe(chunk: AudioChunk, config: AsrConfig): Promise<AsrResult> {
    const { baseUrl, model, apiKey } = resolve(config)

    const form = new FormData()
    const ext = chunk.mimeType.includes('wav') ? 'wav' : chunk.mimeType.includes('mp4') ? 'mp4' : 'webm'
    form.append('file', new Blob([chunk.data], { type: chunk.mimeType }), `chunk.${ext}`)
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    if (config.language && config.language !== 'auto') form.append('language', config.language)

    let res: Response
    try {
      res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body: form,
      })
    } catch (e) {
      return { segments: [], error: e instanceof Error ? e.message : String(e) }
    }

    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        detail = ''
      }
      throw classifyAsrStatus(res.status, detail)
    }

    const data = (await res.json()) as {
      text?: string
      segments?: Array<{ start?: number; end?: number; text?: string }>
    }

    if (Array.isArray(data.segments) && data.segments.length > 0) {
      return {
        segments: data.segments
          .map((s) => ({ text: (s.text ?? '').trim(), start: s.start, end: s.end }))
          .filter((s) => s.text.length > 0),
      }
    }
    const text = (data.text ?? '').trim()
    return { segments: text ? [{ text }] : [] }
  },
}

/** 解析出端点、模型与 Key（A 路可直接复用文本翻译的 Key） */
function resolve(config: AsrConfig): { baseUrl: string; model: string; apiKey: string } {
  const vendor = config.vendor ? getVendor(config.vendor) : undefined
  const baseUrl = (config.baseUrl || vendor?.baseUrl || '').replace(/\/+$/, '')
  const model = config.model || vendor?.model || ''
  return { baseUrl, model, apiKey: config.apiKey ?? '' }
}

/** 供上层复用：A 路若未单独填 Key，可回落到文本翻译的 Key */
export function inheritTranslationKey(asr: AsrConfig, translationApiKey?: string): AsrConfig {
  if (!asr.reuseTranslationKey || asr.apiKey) return asr
  return { ...asr, apiKey: translationApiKey }
}

void AsrError
