import type { AsrConfig, EngineConfig } from '@/shared/types'
import { getAsrProvider } from './registry'
import { inheritTranslationKey } from './providers/openai-asr'
import type { AsrSegment, AudioChunk } from './provider'

/**
 * 语音识别调度器。
 *
 * 职责：把「音频片段」变成「带时间轴的字幕 cue」，再交给现有的字幕翻译与
 * 渲染链路（`features/video/translator.ts` + `renderer.ts`）——这一步复用，
 * 不重造。
 *
 * 时间轴：ASR 出来的时间是**片段内相对时间**，这里统一换算成视频绝对时间
 * （片段起始 + 相对偏移），保证和视频播放位置对齐。
 */

export interface TranscriptionCue {
  start: number
  end: number
  text: string
  translation?: string
  failed?: string
}

export interface TranscriberOptions {
  asr: AsrConfig
  /** 文本翻译引擎配置（识别结果用它翻译） */
  engine: EngineConfig
  /** 翻译方向 */
  source: string
  target: string
  /** 识别到新 cue 时回调（已含译文，若开启自动翻译） */
  onCue?: (cue: TranscriptionCue) => void
  onError?: (message: string) => void
}

export class SpeechTranscriber {
  private queue: Array<{ chunk: AudioChunk }> = []
  private running = false
  private disposed = false
  private cues: TranscriptionCue[] = []

  constructor(private options: TranscriberOptions) {}

  get allCues(): TranscriptionCue[] {
    return this.cues
  }

  /** 投入一个音频片段（由切片器产出），串行识别避免打爆额度 */
  push(chunk: AudioChunk): void {
    if (this.disposed) return
    this.queue.push({ chunk })
    void this.drain()
  }

  dispose(): void {
    this.disposed = true
    this.queue.length = 0
  }

  // ---------- 内部实现 ----------

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const item = this.queue.shift()
        if (!item) break
        await this.processChunk(item.chunk)
      }
    } finally {
      this.running = false
    }
  }

  private async processChunk(chunk: AudioChunk): Promise<void> {
    const provider = getAsrProvider(this.options.asr.provider)

    // A 路未单独填 Key 时，复用文本翻译的 Key（用户只填一次）
    const asrConfig = inheritTranslationKey(this.options.asr, this.options.engine.apiKey)

    const missing = provider.validate(asrConfig)
    if (missing) {
      this.options.onError?.(missing)
      this.disposed = true
      return
    }

    let segments: AsrSegment[] = []
    const fresh: TranscriptionCue[] = []
    try {
      const result = await provider.transcribe(chunk, asrConfig)
      if (result.error) {
        this.options.onError?.(result.error)
        return
      }
      segments = result.segments
    } catch (e) {
      this.options.onError?.(e instanceof Error ? e.message : String(e))
      return
    }

    for (const segment of segments) {
      const text = segment.text.replace(/\s+/g, ' ').trim()
      if (!text) continue
      // 相对时间 → 视频绝对时间
      const start = chunk.startTime + (segment.start ?? 0)
      const end = chunk.startTime + (segment.end ?? chunk.duration)
      const cue: TranscriptionCue = {
        start,
        end: end > start ? end : start + Math.max(1, text.length / 12),
        text,
      }
      this.cues.push(cue)
      fresh.push(cue)
    }

    // 自动翻译：识别出来就立刻翻译这一片新 cue。
    // 只翻「本次新增的」，不重扫全表——长时间视频的 cue 表会很大。
    if (fresh.length > 0 && this.options.asr.autoTranslate) {
      await translateTranscriptionCues(fresh, {
        source: this.options.source,
        target: this.options.target,
      })
    }
    for (const cue of fresh) this.options.onCue?.(cue)
  }
}

/**
 * 识别结果 → 字幕轨。
 *
 * 交给现有的 `SubtitleTranslator` 走文本翻译引擎，因此 AI 字幕与
 * 「已有字幕轨」走的是**同一条翻译链路**，译文缓存、并发、重试全部复用。
 */
export async function translateTranscriptionCues(
  cues: TranscriptionCue[],
  options: { source: string; target: string },
): Promise<void> {
  const pending = cues.filter((c) => c.translation === undefined && !c.failed)
  if (pending.length === 0) return

  const outcome = (await chrome.runtime.sendMessage({
    type: 'translate',
    items: pending.map((cue, i) => ({ id: String(i), text: cue.text })),
    source: options.source,
    target: options.target,
  })) as { translations?: Record<string, string>; failed?: Record<string, string> } | undefined

  if (!outcome) {
    for (const cue of pending) cue.failed = '翻译服务无响应'
    return
  }
  pending.forEach((cue, i) => {
    const text = outcome.translations?.[String(i)]
    if (text !== undefined) cue.translation = text
    else cue.failed = outcome.failed?.[String(i)] ?? '翻译失败'
  })
}

void 0
