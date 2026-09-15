import type { TranslateOutcome } from '@/core/translate/translator'
import type { VideoCue } from './types'

/**
 * 字幕翻译调度。
 *
 * 核心问题：一条 1 小时的视频可能有 1000+ 条字幕，
 * 全量翻译要几十次请求，用户不可能等。
 *
 * 解法：**滑窗预翻译**——
 * - 以当前播放位置为锚点，先翻前后 N 秒的字幕（马上要看到的）
 * - 播放过程中持续补充窗口（增量翻译）
 * - 已翻译的 cue 写入内存 Map，不重复请求
 * - 字幕批次走 SW 的并发/重试/缓存链路，这里只管调度
 */

export interface SubtitleTranslatorOptions {
  source: string
  target: string
  /** 预翻译窗口：当前时刻前多少秒 */
  lookBehind?: number
  /** 预翻译窗口：当前时刻后多少秒 */
  lookAhead?: number
  /** 单批条数 */
  batchSize?: number
  onCueTranslated?: (cue: VideoCue) => void
}

const DEFAULTS = {
  lookBehind: 5,
  lookAhead: 60,
  batchSize: 40,
} as const

export class SubtitleTranslator {
  private options: SubtitleTranslatorOptions
  private cues: VideoCue[] = []
  private pending = new Set<VideoCue>()
  private running = false
  private disposed = false

  constructor(options: SubtitleTranslatorOptions) {
    this.options = { ...DEFAULTS, ...options }
  }

  update(options: Partial<SubtitleTranslatorOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /** 载入新字幕轨，重置翻译状态 */
  setCues(cues: VideoCue[]): void {
    this.cues = cues
    this.pending.clear()
  }

  get total(): number {
    return this.cues.length
  }

  get translatedCount(): number {
    return this.cues.filter((c) => c.translation !== undefined).length
  }

  /**
   * 以当前播放位置为准，补充预翻译窗口。
   * 播放时高频调用：未进入新窗口时直接返回，开销极小。
   */
  tick(currentTime: number): void {
    if (this.disposed) return
    const from = currentTime - (this.options.lookBehind ?? DEFAULTS.lookBehind)
    const to = currentTime + (this.options.lookAhead ?? DEFAULTS.lookAhead)

    for (const cue of this.cues) {
      if (cue.end < from) continue
      if (cue.start > to) break
      if (cue.translation !== undefined || cue.failed) continue
      this.pending.add(cue)
    }

    if (this.pending.size > 0) void this.flush()
  }

  /** 预翻译整条轨道（用户点「翻译全部字幕」时用） */
  async translateAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    for (const cue of this.cues) {
      if (cue.translation === undefined && !cue.failed) this.pending.add(cue)
    }
    await this.flush(onProgress)
  }

  /** 取当前时刻该显示的字幕 */
  dispose(): void {
    this.disposed = true
    this.pending.clear()
  }

  // ---------- 内部实现 ----------

  private async flush(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.running) return
    this.running = true
    const total = this.pending.size

    try {
      while (this.pending.size > 0 && !this.disposed) {
        const batch = [...this.pending].slice(0, this.options.batchSize ?? 40)
        for (const cue of batch) this.pending.delete(cue)

        await this.translateBatch(batch, total, onProgress)
      }
    } finally {
      this.running = false
    }
  }

  private async translateBatch(
    batch: VideoCue[],
    total: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: batch.map((cue, i) => ({ id: String(i), text: cue.text })),
        source: this.options.source,
        target: this.options.target,
      })) as TranslateOutcome | undefined

      if (!outcome) {
        for (const cue of batch) cue.failed = '翻译服务无响应'
        return
      }

      batch.forEach((cue, i) => {
        const text = outcome.translations[String(i)]
        if (text !== undefined) cue.translation = text
        else cue.failed = outcome.failed[String(i)] ?? '翻译失败'
        this.options.onCueTranslated?.(cue)
      })
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      for (const cue of batch) cue.failed = reason
    } finally {
      onProgress?.(this.translatedCount, total)
    }
  }
}
