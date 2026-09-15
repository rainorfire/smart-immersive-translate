import type { TranslatableItem } from '@/shared/types'
import type { TranslateOutcome } from '@/core/translate/translator'
import {
  detectFormat,
  mergeBilingual,
  parseSubtitle,
  serializeSubtitle,
  type SubtitleFormat,
} from './parser'

export interface SubtitleTranslateOptions {
  source: string
  target: string
  /** 是否输出双语（原文+译文），false 则只输出译文 */
  bilingual: boolean
  onProgress?: (done: number, total: number) => void
}

export interface SubtitleTranslateResult {
  content: string
  format: SubtitleFormat
  total: number
  translated: number
  failed: string[]
}

/**
 * 翻译字幕文件。
 * 流程：解析 → 抽正文 → 分批翻译 → 回写（保留时间轴/样式）。
 */
export async function translateSubtitleFile(
  filename: string,
  content: string,
  options: SubtitleTranslateOptions,
): Promise<SubtitleTranslateResult> {
  const format = detectFormat(filename, content)
  const parsed = parseSubtitle(content, format)

  const items: TranslatableItem[] = parsed.cues.map((cue) => ({
    id: String(cue.index),
    text: cue.text,
  }))

  const translations = new Map<number, string>()
  const failed: string[] = []

  // 分批请求，避免单次消息过大（SW 消息有大小限制）
  const BATCH = 40
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: batch,
        source: options.source,
        target: options.target,
      })) as TranslateOutcome | undefined

      if (!outcome) {
        for (const item of batch) failed.push(item.id)
      } else {
        for (const [id, text] of Object.entries(outcome.translations)) {
          translations.set(Number(id), text)
        }
        for (const id of Object.keys(outcome.failed)) failed.push(id)
      }
    } catch {
      for (const item of batch) failed.push(item.id)
    }
    options.onProgress?.(Math.min(i + BATCH, items.length), items.length)
  }

  const finalMap = options.bilingual
    ? mergeBilingual(parsed, translations)
    : (translations as Map<number, string>)

  return {
    content: serializeSubtitle(parsed, finalMap),
    format,
    total: items.length,
    translated: translations.size,
    failed,
  }
}
