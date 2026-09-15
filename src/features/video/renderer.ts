import type { VideoCue, VideoSubtitleOptions } from './types'

/**
 * 字幕覆盖层渲染。
 *
 * 设计：
 * - 覆盖层绝对定位在视频容器内，跟随视频尺寸自动贴合（ResizeObserver）
 * - 双语：原文在上、译文在下，字号可调
 * - 仅译文：只显示译文
 * - 全屏/画中画切换时自动重挂载
 * - 不修改站点的原生字幕（由调用方决定是否隐藏）
 */

const OVERLAY_CLASS = 'bilens-video-overlay'

export class SubtitleOverlay {
  private root: HTMLElement
  private sourceEl: HTMLElement
  private targetEl: HTMLElement
  private host: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private lastText = ''
  private visible = false

  constructor(private options: VideoSubtitleOptions) {
    this.root = document.createElement('div')
    this.root.className = OVERLAY_CLASS

    this.sourceEl = document.createElement('div')
    this.sourceEl.className = 'bilens-video-source'

    this.targetEl = document.createElement('div')
    this.targetEl.className = 'bilens-video-target'

    this.root.append(this.sourceEl, this.targetEl)
    this.applyOptions()
  }

  update(options: Partial<VideoSubtitleOptions>): void {
    this.options = { ...this.options, ...options }
    this.applyOptions()
  }

  /** 挂载到视频容器 */
  mount(video: HTMLVideoElement, containerSelector?: string): void {
    const host = this.resolveHost(video, containerSelector)
    if (host === this.host) return
    this.unmount()
    this.host = host

    const style = getComputedStyle(host)
    if (style.position === 'static') host.style.position = 'relative'
    host.appendChild(this.root)

    // 容器尺寸变化时（进入全屏、调整窗口）重新贴合
    this.resizeObserver = new ResizeObserver(() => this.syncGeometry())
    this.resizeObserver.observe(host)
    this.syncGeometry()
  }

  unmount(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.root.remove()
    this.host = null
  }

  /** 更新当前字幕；传 null 表示清空 */
  render(cue: VideoCue | null): void {
    if (!cue) {
      if (this.visible) {
        this.root.classList.remove('bilens-visible')
        this.visible = false
        this.lastText = ''
      }
      return
    }

    const key = `${cue.text}|${cue.translation ?? ''}`
    if (key === this.lastText) return
    this.lastText = key

    if (this.options.bilingual) {
      this.sourceEl.textContent = cue.text
      this.sourceEl.hidden = false
    } else {
      this.sourceEl.hidden = true
    }
    this.targetEl.textContent = cue.translation ?? cue.failed ?? ''

    if (!this.visible) {
      this.root.classList.add('bilens-visible')
      this.visible = true
    }
  }

  destroy(): void {
    this.unmount()
  }

  /** 覆盖层底部留白，避免挡住站点自己的控件 */
  private applyOptions(): void {
    this.root.style.setProperty('--bilens-subtitle-size', `${this.options.fontSize}px`)
    this.root.toggleAttribute('data-bilingual', this.options.bilingual)
  }

  private resolveHost(video: HTMLVideoElement, containerSelector?: string): HTMLElement {
    if (containerSelector) {
      const found = video.ownerDocument.querySelector<HTMLElement>(containerSelector)
      if (found) return found
    }
    // 优先挂在视频的直接父元素（多数播放器就是容器）
    return video.parentElement ?? video.ownerDocument.body
  }

  /** 让覆盖层只覆盖视频画面区域（而非整个容器） */
  private syncGeometry(): void {
    if (!this.host) return
    const video = this.host.querySelector('video')
    if (!video) return

    const hostRect = this.host.getBoundingClientRect()
    const videoRect = video.getBoundingClientRect()
    if (hostRect.width === 0 || hostRect.height === 0) return

    this.root.style.left = `${videoRect.left - hostRect.left}px`
    this.root.style.top = `${videoRect.top - hostRect.top}px`
    this.root.style.width = `${videoRect.width}px`
    this.root.style.height = `${videoRect.height}px`
  }
}

/**
 * 隐藏站点自带字幕，避免两层字幕重叠。
 *
 * 两种来源分开处理：
 * - 原生 textTracks：mode 设为 'hidden'（仍加载 cues，但不显示）
 * - DOM 字幕容器：加一个只改可见性的类，保留其 DOM 更新
 *   （visibility:hidden 不影响站点继续写入文本，我们还能读到）
 */
const HIDE_CLASS = 'bilens-hide-native-caption'

export function hideNativeCaptions(video: HTMLVideoElement, hide: boolean): void {
  for (const track of video.textTracks) {
    if (hide && track.mode === 'showing') track.mode = 'hidden'
  }
}

/** 标记/取消标记 DOM 字幕容器（只改可见性，可随时还原） */
export function markDomCaptionHidden(doc: Document, selector: string | null, hide: boolean): void {
  if (!selector) return
  let nodes: NodeListOf<Element>
  try {
    nodes = doc.querySelectorAll(selector)
  } catch {
    return
  }
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    node.classList.toggle(HIDE_CLASS, hide)
  }
}
