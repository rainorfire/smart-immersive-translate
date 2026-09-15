import type { EngineConfig, TranslateRequest, TranslateResult } from '@/shared/types'
import { classifyHttpStatus, type TranslateProvider } from '../provider'

/**
 * Bing 免费翻译引擎。
 * 采用微软 Edge 翻译的公开接口，无需 API Key、无需 token。
 *
 * 2026-09-15 实测结论：
 * - `edge.microsoft.com/translate/auth` 已 404（旧路径废弃）
 * - 可用路径为 `edge.microsoft.com/translate/translatetext`
 * - 请求体必须是**字符串数组**（对象数组会 400）
 * - 自动检测语言必须**省略 from 参数**；传 `auto` / `auto-detect` 会 400
 * - `zh-CN` 与 `zh-Hans` 均可，繁体需用 `zh-Hant`
 */

const TRANSLATE_URL = 'https://edge.microsoft.com/translate/translatetext'

/**
 * 语言代码映射：中文按简繁映射，其余原样透传。
 */
const LANG_MAP: Record<string, string> = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant',
}

export function normalizeLang(lang: string): string {
  return LANG_MAP[lang] ?? lang
}

/** auto 或空值表示自动检测——此时必须完全不传 from 参数 */
function isAuto(lang: string): boolean {
  return !lang || lang === 'auto' || lang === 'auto-detect'
}

export const bingProvider: TranslateProvider = {
  id: 'bing',
  name: 'Bing 翻译（免费）',
  maxTextLengthPerRequest: 1800,
  maxTextGroupLengthPerRequest: 4000,
  concurrency: 4,
  requiresAuth: false,

  async translate(req: TranslateRequest, _config: EngineConfig): Promise<TranslateResult> {
    const translations: Record<string, string> = {}
    const failed: Record<string, string> = {}
    if (req.items.length === 0) return { translations, failed }

    const url = new URL(TRANSLATE_URL)
    // 自动检测时必须省略 from，传任何 auto 值都会 400
    if (!isAuto(req.source)) url.searchParams.set('from', normalizeLang(req.source))
    url.searchParams.set('to', normalizeLang(req.target))

    // 必须传字符串数组，传对象数组会 400
    const body = req.items.map((item) => item.text)

    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      for (const item of req.items) {
        failed[item.id] = e instanceof Error ? e.message : String(e)
      }
      return { translations, failed }
    }

    if (!res.ok) {
      const err = classifyHttpStatus(res.status)
      for (const item of req.items) failed[item.id] = err.message
      return { translations, failed }
    }

    const data = (await res.json()) as Array<{
      translations?: Array<{ text?: string }>
    }>

    req.items.forEach((item, index) => {
      const text = data[index]?.translations?.[0]?.text
      if (typeof text === 'string' && text.length > 0) {
        translations[item.id] = text
      } else {
        failed[item.id] = '引擎未返回译文'
      }
    })

    return { translations, failed }
  },
}
