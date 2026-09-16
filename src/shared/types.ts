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

/** ASR（语音识别）引擎类型 —— 对应方案 A / B / C 三路 */
export type AsrProviderId =
  /** A：OpenAI 兼容的 /audio/transcriptions（硅基流动 SenseVoice、通义、OpenAI Whisper） */
  | 'openai-asr'
  /** B：阿里云 NLS 实时语音识别 */
  | 'aliyun-nls'
  /** B2：腾讯云实时语音识别 */
  | 'tencent-asr'
  /** C：本地 Whisper（WASM / 浏览器内推理） */
  | 'local-whisper'

/**
 * 语音翻译配置。
 *
 * 与 `EngineConfig` **完全解耦**：文本翻译继续用 `config.engine`，
 * 语音翻译（ASR）走这一组独立配置。改 ASR 引擎不影响文本翻译，反之亦然。
 */
export interface AsrConfig {
  provider: AsrProviderId
  /** 是否启用 AI 字幕（无字幕轨的视频靠它转写） */
  enabled: boolean

  // ---- A 路：OpenAI 兼容 ----
  /** 厂商预设 id，复用引擎的厂商表 */
  vendor?: string
  apiKey?: string
  model?: string
  baseUrl?: string
  /** 是否直接复用文本翻译的 Key（免二次填写） */
  reuseTranslationKey?: boolean

  // ---- B 路：国内云实时语音 ----
  /** 阿里云 NLS 的 AppKey */
  appKey?: string
  /** 阿里云 AccessKeyId / 腾讯云 SecretId */
  accessKeyId?: string
  /** 阿里云 AccessKeySecret / 腾讯云 SecretKey */
  accessKeySecret?: string
  /** 阿里云 NLS 服务地址 */
  nlsUrl?: string

  // ---- C 路：本地 Whisper ----
  /** 本地模型规格 */
  localModel?: 'tiny' | 'base' | 'small'

  // ---- 通用 ----
  /** 识别语言，auto 为自动检测 */
  language: string
  /** 音频切片时长（秒） */
  chunkSeconds: number
  /** 识别出的字幕用哪套配置翻译：text=复用文本翻译配置 */
  translateWith: 'text'
  /** 自动翻译识别结果 */
  autoTranslate: boolean
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
  /** 语音翻译（AI 字幕）配置，与文本翻译引擎相互独立 */
  asr: AsrConfig
  /** 视频双语字幕开关 */
  enableVideoSubtitle: boolean
  /** 字幕是否双语（false 为仅译文） */
  videoSubtitleBilingual: boolean
  /** 字幕字号（px） */
  videoSubtitleFontSize: number
  /** PDF 译文显示模式 */
  pdfLayoutMode: 'bilingual' | 'translation-only'
}
