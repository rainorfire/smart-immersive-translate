import { SubtitleOverlay } from './renderer'
import { collectTrack } from './source'
import { DomCueCollector, findCueAt, mergeShortCues, TimelineCalibrator } from './timeline'
import { SubtitleTranslator } from './translator'
import { detectGenericCaptionSelector, matchVideoRule } from './sites'
import { DEFAULT_VIDEO_OPTIONS, type VideoCue, type VideoSubtitleOptions } from './types'
import type { SubtitleTrack, VideoSubtitleRule } from './types'

/**
 * 视频双语字幕总控。
 *
 * 生命周期：
 * 1. 找到页面里的 <video>，按站点规则确定容器
 * 2. 抓字幕轨（原生 / 接口 / DOM 三路兜底）
 * 3. 时间轴对齐 + 滑窗预翻译
 * 4. 播放时按 currentTime 定位 cue，渲染双语覆盖层
 *
 * 站点适配策略：优先站点规则；无规则时走通用路径
 * （原生轨道 → <track> 标签 → DOM 字幕容器轮询）。
 */

export interface VideoSubtitleState {
  active: boolean
  sourceKind: string
  cueCount: number
  translatedCount: number
  message: string
}

export class VideoSubtitleController {
  private options: VideoSubtitleOptions
  private overlay: SubtitleOverlay
  private translator: SubtitleTranslator
  private calibrator = new TimelineCalibrator()
  private domCollector = new DomCueCollector()

  private video: HTMLVideoElement | null = null
  private rule: VideoSubtitleRule | null = null
  private track: SubtitleTrack | null = null
  private cues: VideoCue[] = []
  private active = false
  private rafId: number | null = null
  private domTimer: number | null = null
  private currentText = ''
  /** 无站点规则时探测出的通用字幕选择器 */
  private genericCaptionSelector: string | null = null
  /** 当前视频地址，用于检测 SPA 换集/换视频 */
  private currentVideoSrc = ''
  private onStateChange?: (state: VideoSubtitleState) => void

  constructor(options: Partial<VideoSubtitleOptions> = {}) {
    this.options = { ...DEFAULT_VIDEO_OPTIONS, ...options }
    this.overlay = new SubtitleOverlay(this.options)
    this.translator = new SubtitleTranslator({
      source: this.options.source,
      target: this.options.target,
      onCueTranslated: () => this.emitState(),
    })
  }

  setStateListener(listener: (state: VideoSubtitleState) => void): void {
    this.onStateChange = listener
  }

  update(options: Partial<VideoSubtitleOptions>): void {
    this.options = { ...this.options, ...options }
    this.overlay.update(options)
    this.translator.update({ source: this.options.source, target: this.options.target })
  }

  get isActive(): boolean {
    return this.active
  }

  /** 开启字幕翻译 */
  async start(root: ParentNode = document): Promise<VideoSubtitleState> {
    const video = this.findVideo(root)
    if (!video) {
      return this.stateOf('未找到视频元素')
    }
    if (this.active && this.video === video) {
      return this.stateOf('已在翻译中')
    }

    this.video = video
    this.rule = matchVideoRule(location.href)
    this.active = true

    this.overlay.mount(video, this.rule?.containerSelector)

    // 1. 抓字幕轨
    let track = await collectTrack(video, this.rule)

    // 2. 没有现成轨道则监听 DOM 字幕（通用兜底）
    if (!track) {
      track = await this.collectFromDom(video)
    }

    if (!track || track.cues.length === 0) {
      this.active = false
      this.overlay.unmount()
      return this.stateOf('未找到可用字幕轨（可先打开站点字幕再试）')
    }

    // 合并碎片 cue（YouTube 自动字幕按词切分）
    const cues = mergeShortCues(track.cues)
    this.track = track
    this.cues = cues
    this.translator.setCues(cues)

    this.bindVideoEvents(video)
    this.currentVideoSrc = video.currentSrc || video.src || ''
    this.startLoop()

    return this.stateOf(`已接入 ${track.kind} 字幕（${cues.length} 条），正在翻译…`)
  }

  /** 停止字幕翻译并清理 */
  stop(): void {
    this.active = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    if (this.domTimer !== null) window.clearInterval(this.domTimer)
    this.domTimer = null

    if (this.video) this.unbindVideoEvents(this.video)
    this.translator.dispose()
    this.overlay.destroy()
    this.calibrator.reset()
    this.video = null
    this.cues = []
    this.track = null
    this.currentText = ''
  }

  /** 翻译全部字幕（用户主动触发，不等滑窗） */
  async translateAll(): Promise<void> {
    await this.translator.translateAll(() => this.emitState())
  }

  // ---------- 内部实现 ----------

  private findVideo(root: ParentNode): HTMLVideoElement | null {
    const selector = this.rule?.videoSelector ?? 'video'
    const matched = root.querySelector<HTMLVideoElement>(selector)
    if (matched) return matched
    return root.querySelector<HTMLVideoElement>('video')
  }

  /** DOM 兜底：轮询站点字幕容器，按播放时刻打时间戳 */
  private async collectFromDom(video: HTMLVideoElement): Promise<SubtitleTrack | null> {
    // 站点规则没给选择器时，尝试通用探测（覆盖任意自研播放器）
    const selector =
      this.rule?.captionSelector ?? detectGenericCaptionSelector(video)
    this.genericCaptionSelector = selector
    if (!selector) return null

    const container = video.ownerDocument.querySelector(selector)
    if (!container) return null

    // 监听 3 秒，看是否能采到字幕
    const collected = await new Promise<VideoCue[]>((resolve) => {
      let ticks = 0
      const timer = window.setInterval(() => {
        ticks += 1
        const text = readCaptionText(video.ownerDocument, selector)
        if (text) this.domCollector.push(text, video.currentTime)
        if (ticks >= 6) {
          window.clearInterval(timer)
          resolve(this.domCollector.finish(video.currentTime))
        }
      }, 500)
    })

    if (collected.length === 0) return null
    return { kind: 'dom', language: 'unknown', origin: `dom:${selector}`, cues: collected }
  }

  private bindVideoEvents(video: HTMLVideoElement): void {
    // 拖动进度条后重置校准，避免时间基准错位
    video.addEventListener('seeked', this.handleSeek)
    video.addEventListener('ratechange', this.handleSeek)
  }

  private unbindVideoEvents(video: HTMLVideoElement): void {
    video.removeEventListener('seeked', this.handleSeek)
    video.removeEventListener('ratechange', this.handleSeek)
  }

  private handleSeek = (): void => {
    this.calibrator.reset()
    if (!this.video) return
    // 立即补一次窗口，拖动后不等下一个 tick
    this.translator.tick(this.video.currentTime)
  }

  /**
   * SPA 换视频检测。
   * 播放循环里顺便比对 src，变了说明换集/换片，需要重新抓字幕轨。
   */
  private handlePossibleSourceChange(): void {
    if (!this.video) return
    const src = this.video.currentSrc || this.video.src || ''
    if (!src || src === this.currentVideoSrc) return
    this.currentVideoSrc = src
    // 重新抓轨：保留覆盖层，换一套 cue
    void this.reloadTrack()
  }

  private async reloadTrack(): Promise<void> {
    if (!this.video || !this.active) return
    this.translator.dispose()
    this.domCollector = new DomCueCollector()
    this.calibrator.reset()

    let track = await collectTrack(this.video, this.rule)
    if (!track) track = await this.collectFromDom(this.video)
    if (!track || track.cues.length === 0) return

    const cues = mergeShortCues(track.cues)
    this.track = track
    this.cues = cues
    this.translator = new SubtitleTranslator({
      source: this.options.source,
      target: this.options.target,
      onCueTranslated: () => this.emitState(),
    })
    this.translator.setCues(cues)
    this.emitState()
  }

  /** 播放循环：每帧定位字幕并补翻译窗口 */
  private startLoop(): void {
    let lastTick = 0
    const loop = (): void => {
      if (!this.active || !this.video) return
      const time = this.calibrator.toSubtitleTime(this.video.currentTime)

      const cue = findCueAt(this.cues, time)
      const text = cue?.text ?? ''
      if (text !== this.currentText) {
        this.currentText = text
        this.overlay.render(cue)
      } else if (cue?.translation && cue.translation !== this.lastRenderedTranslation) {
        // 译文晚到：重绘同一条
        this.lastRenderedTranslation = cue.translation
        this.overlay.render(cue)
      }

      // 每 500ms 补一次预翻译窗口，避免每帧都扫描
      const now = performance.now()
      if (now - lastTick > 500) {
        lastTick = now
        this.translator.tick(this.video.currentTime)
        this.handlePossibleSourceChange()
      }

      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  private lastRenderedTranslation = ''

  private emitState(): void {
    this.onStateChange?.(this.stateOf(''))
  }

  private stateOf(message: string): VideoSubtitleState {
    return {
      active: this.active,
      sourceKind: this.track?.kind ?? 'none',
      cueCount: this.cues.length,
      translatedCount: this.translator.translatedCount,
      message,
    }
  }
}

/** 读取当前字幕文本（兼容容器本身与子元素两种结构） */
function readCaptionText(doc: Document, selector: string): string {
  const nodes = doc.querySelectorAll(selector)
  if (nodes.length === 0) return ''
  const parts: string[] = []
  for (const node of nodes) {
    const text = node.textContent?.trim()
    if (text) parts.push(text)
  }
  return parts.join(' ').trim()
}
