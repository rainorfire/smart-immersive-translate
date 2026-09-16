import { SpeechTranscriber, translateTranscriptionCues, type TranscriptionCue } from '@/core/asr/transcriber'
import { findCueAt } from './timeline'
import type { SubtitleOverlay } from './renderer'
import type { VideoCue } from './types'

/**
 * AI 字幕（语音识别）控制器。
 *
 * 与「翻译已有字幕轨」的区别：
 * - 既有路径：视频**本来就有**字幕轨/timedtext，我们只翻译
 * - 本控制器：视频**没有字幕**时，抓标签页音频 → ASR 转写 → 翻译 → 叠加显示
 *
 * 数据流：
 *   内容脚本 → SW（tabCapture 取 streamId）→ 离屏文档（取流 + 切片）
 *            → 片段回推 SW → 回推本标签页 → SpeechTranscriber（识别 + 翻译）
 *            → cue 列表 → 复用 SubtitleOverlay 渲染
 */

export interface SpeechSubtitleOptions {
  source: string
  target: string
  bilingual: boolean
  onCues?: (cues: TranscriptionCue[]) => void
  onError?: (message: string) => void
  onState?: (state: SpeechSubtitleState) => void
}

export interface SpeechSubtitleState {
  active: boolean
  cueCount: number
  translatedCount: number
  message: string
}

export class SpeechSubtitleController {
  private transcriber: SpeechTranscriber | null = null
  private cues: TranscriptionCue[] = []
  private active = false
  private rafId: number | null = null
  private video: HTMLVideoElement | null = null
  private lastRenderedKey = ''

  constructor(
    private options: SpeechSubtitleOptions,
    private overlay: SubtitleOverlay,
  ) {}

  get isActive(): boolean {
    return this.active
  }

  get allCues(): TranscriptionCue[] {
    return this.cues
  }

  update(options: Partial<SpeechSubtitleOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /** 开始 AI 字幕：请求 SW 启动标签页音频捕获 */
  async start():
    Promise<SpeechSubtitleState> {
    if (this.active) return this.stateOf('已在识别中')
    const video = document.querySelector('video')
    if (!video) return this.stateOf('未找到视频元素')

    // 捕获前必须先播放：未播放的标签页 getMediaStreamId 会失败
    if (video.paused) {
      try {
        await video.play()
      } catch {
        // 自动播放被拦时不阻塞，交给 Chrome 的捕获接口报错
      }
    }

    this.video = video
    this.cues = []
    this.transcriber = new SpeechTranscriber({
      ...(await this.loadEngineConfig()),
      source: this.options.source,
      target: this.options.target,
      onCue: (cue) => {
        // 译文由调度器按 asr.autoTranslate 处理（避免这里每来一条就重扫全表）
        const existing = this.cues.findIndex((c) => c.start === cue.start && c.text === cue.text)
        if (existing >= 0) this.cues[existing] = cue
        else this.cues.push(cue)
        this.options.onCues?.(this.cues)
        this.emitState()
      },
      onError: (message) => {
        this.options.onError?.(message)
        this.emitState(message)
      },
    })

    const result = (await chrome.runtime.sendMessage({ type: 'speech-start' })) as
      | { ok: boolean; error?: string }
      | undefined

    if (!result?.ok) {
      this.active = false
      this.transcriber.dispose()
      this.transcriber = null
      return this.stateOf(result?.error ?? '音频捕获启动失败')
    }

    this.active = true
    this.overlay.mount(video)
    this.startLoop()
    return this.stateOf('已开始语音识别，正在生成 AI 字幕…')
  }

  /** 停止并清理（含关掉音频捕获） */
  stop(): void {
    if (!this.active) return
    this.active = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.transcriber?.dispose()
    this.transcriber = null
    this.cues = []
    this.lastRenderedKey = ''
    void chrome.runtime.sendMessage({ type: 'speech-stop' }).catch(() => {})
    this.overlay.render(null)
  }

  /** 收到离屏文档回推的音频片段 */
  pushChunk(chunk: {
    data: ArrayBuffer
    mimeType: string
    startedAt: number
    duration: number
  }): void {
    if (!this.active || !this.transcriber) return
    this.transcriber.push({
      data: chunk.data,
      mimeType: chunk.mimeType,
      startTime: chunk.startedAt,
      duration: chunk.duration,
    })
  }

  // ---------- 内部实现 ----------

  /** 取出 ASR 与文本翻译两套配置（两套配置相互独立） */
  private async loadEngineConfig(): Promise<{
    asr: import('@/shared/types').AsrConfig
    engine: import('@/shared/types').EngineConfig
  }> {
    const config = (await chrome.runtime.sendMessage({ type: 'get-config' })) as
      | import('@/shared/types').UserConfig
      | undefined
    return {
      asr:
        config?.asr ??
        ({ provider: 'openai-asr', enabled: true, language: 'auto', chunkSeconds: 6 } as never),
      engine: config?.engine ?? ({ provider: 'bing' } as never),
    }
  }

  /** 手动补翻当前所有未翻译的 cue（autoTranslate 关闭时由 UI 触发） */
  async translatePending(): Promise<void> {
    await translateTranscriptionCues(this.cues, {
      source: this.options.source,
      target: this.options.target,
    })
    this.emitState()
  }

  /** 播放循环：按视频时刻定位当前 cue 并渲染 */
  private startLoop(): void {
    const loop = (): void => {
      if (!this.active || !this.video) return
      const time = this.video.currentTime
      const cue = findCueAt(this.cues as VideoCue[], time)
      const key = cue ? `${cue.text}|${cue.translation ?? ''}` : ''
      if (key !== this.lastRenderedKey) {
        this.lastRenderedKey = key
        this.overlay.render(cue ? { start: cue.start, end: cue.end, text: cue.text, translation: cue.translation, failed: cue.failed } : null)
      }
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  private emitState(message = ''): void {
    this.options.onState?.(this.stateOf(message))
  }

  private stateOf(message: string): SpeechSubtitleState {
    return {
      active: this.active,
      cueCount: this.cues.length,
      translatedCount: this.cues.filter((c) => c.translation !== undefined).length,
      message,
    }
  }
}
