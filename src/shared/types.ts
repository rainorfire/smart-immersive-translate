/** 翻译方向与基础类型 */

export interface LangPair {
  source: string
  target: string
}

/** 一条待翻译文本 */
export interface TranslatableItem {
  id: string
  text: string
}

export interface TranslateRequest {
  items: TranslatableItem[]
  source: string
  target: string
}

export interface TranslateResult {
  /** key 为 item.id */
  translations: Record<string, string>
  /** 未成功翻译的 id -> 原因 */
  failed: Record<string, string>
}

/** 译文插入位置 */
export type TranslationPosition = 'before' | 'after'

/** 双语 / 仅译文 */
export type TranslationMode = 'dual' | 'translation-only'

export interface EngineConfig {
  /** provider id，如 bing / openai-compatible */
  provider: string
  /** openai-compatible 系厂商预设 id，如 deepseek */
  vendor?: string
  apiKey?: string
  model?: string
  baseUrl?: string
  /** 温度、并发等可选覆盖 */
  concurrency?: number
  maxTextLengthPerRequest?: number
  maxTextGroupLengthPerRequest?: number
}

export interface UserConfig {
  /** 主翻译引擎 */
  engine: EngineConfig
  /** 目标语言 */
  targetLanguage: string
  /** 源语言，auto 为自动检测 */
  sourceLanguage: string
  mode: TranslationMode
  position: TranslationPosition
  /** 动态内容增量翻译 */
  translateDynamicContent: boolean
  /** 不翻译的标签 */
  excludeTags: string[]
  /** 站点规则开关 */
  enableSiteRules: boolean
  /** 缓存 */
  enableCache: boolean
  /** 译文样式主题 */
  theme: string
  /** 悬停翻译：按下修饰键后自动翻译鼠标下段落 */
  enableHoverTranslate: boolean
  /** 输入框翻译开关 */
  enableInputTranslate: boolean
  /** 划词翻译开关 */
  enableSelectionTranslate: boolean
  /** 图片翻译开关 */
  enableImageTranslate: boolean
  /** OCR 识别语言 */
  ocrLanguage: string
  /** 视频双语字幕开关 */
  enableVideoSubtitle: boolean
  /** 字幕是否双语（false 为仅译文） */
  videoSubtitleBilingual: boolean
  /** 字幕字号（px） */
  videoSubtitleFontSize: number
  /** PDF 译文显示模式 */
  pdfLayoutMode: 'bilingual' | 'translation-only'
}
