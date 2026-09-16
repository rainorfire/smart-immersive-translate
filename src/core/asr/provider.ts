import type { AsrConfig } from '@/shared/types'

/**
 * ASR（语音识别）适配器接口。
 *
 * 与翻译引擎适配层（`core/engine/`）平行且**完全独立**：
 * 文本翻译的引擎配置与语音识别的引擎配置互不影响。
 *
 * 三路实现：
 * - A `openai-asr`   ：OpenAI 兼容 `/audio/transcriptions`，整段识别，复用现有 Key
 * - B `aliyun-nls`   ：阿里云 NLS 实时识别（WebSocket）
 * - B2 `tencent-asr` ：腾讯云实时语音识别（WebSocket，TC3 签名）
 * - C `local-whisper`：浏览器内 Whisper（WASM），离线、免 Key
 */

/** 一段音频（PCM 16kHz 单声道，或可直接上传的编码片段） */
export interface AudioChunk {
  /** 原始音频数据 */
  data: ArrayBuffer
  /** MIME 类型，如 audio/webm;codecs=opus */
  mimeType: string
  /** 该片段在视频时间轴上的起始时刻（秒） */
  startTime: number
  /** 片段时长（秒） */
  duration: number
  /** 采样率（有值时按 PCM 处理） */
  sampleRate?: number
}

/** 识别结果：带时间轴的文本片段 */
export interface AsrSegment {
  /** 识别文本 */
  text: string
  /** 在音频片段内的相对起始时间（秒），无则用片段起始时间 */
  start?: number
  /** 相对结束时间（秒） */
  end?: number
}

export interface AsrResult {
  segments: AsrSegment[]
  /** 失败原因 */
  error?: string
}

/** 引擎错误分类，与翻译侧保持同一套语义，便于 UI 统一提示 */
export type AsrErrorKind = 'auth' | 'network' | 'quota' | 'config' | 'unsupported'

export class AsrError extends Error {
  constructor(
    message: string,
    readonly kind: AsrErrorKind,
  ) {
    super(message)
    this.name = 'AsrError'
  }
}

export interface AsrProvider {
  readonly id: string
  readonly name: string
  /** 是否需要鉴权 */
  readonly requiresAuth: boolean
  /**
   * 识别模式：
   * - batch  ：整段音频一次性识别（A、C 路）
   * - stream ：持续流向引擎（B 路）
   */
  readonly mode: 'batch' | 'stream'
  /** 建议的切片时长（秒） */
  readonly recommendedChunkSeconds: number
  /** 配置是否有缺项，返回缺失说明（null 表示可用） */
  validate(config: AsrConfig): string | null
  /** batch 模式：识别一段音频 */
  transcribe(chunk: AudioChunk, config: AsrConfig): Promise<AsrResult>
  /** stream 模式：建立会话 */
  openStream?(config: AsrConfig): AsrStreamSession
}

/** 流式识别会话（B 路用） */
export interface AsrStreamSession {
  /** 推入一段音频 */
  push(chunk: AudioChunk): Promise<AsrSegment[]>
  /** 结束并等待尾包结果 */
  close(): Promise<AsrSegment[]>
  /** 中断会话 */
  abort(): void
}

/** 把 HTTP 状态码归一化成错误 */
export function classifyAsrStatus(status: number, detail?: string): AsrError {
  const suffix = detail ? `：${detail}` : ''
  if (status === 401 || status === 403) {
    return new AsrError(`鉴权失败（${status}），请检查语音识别的 Key${suffix}`, 'auth')
  }
  if (status === 402 || status === 429) {
    return new AsrError(`额度不足或请求过于频繁（${status}）${suffix}`, 'quota')
  }
  if (status >= 500) {
    return new AsrError(`语音服务端错误（${status}）${suffix}`, 'network')
  }
  return new AsrError(`语音识别请求失败（${status}）${suffix}`, 'unsupported')
}
