import type { TranslateOutcome } from '@/core/translate/translator'

/**
 * 划词翻译。
 *
 * 交互（对标官方）：选中文本后，在选区旁弹出译文气泡。
 * 相比整页翻译，适合「只想看一句话」的场景。
 */

export interface SelectionOptions {
  source: string
  target: string
  /** 是否自动翻译（false 时点击图标才翻译） */
  autoTranslate: boolean
}

const DEFAULTS: SelectionOptions = {
  source: 'auto',
  target: 'zh-CN',
  autoTranslate: true,
}

const BUBBLE_ID = 'bilens-selection-bubble'

export class SelectionTranslator {
  private options: SelectionOptions
  private bubble: HTMLElement | null = null
  private pendingTimer: number | null = null

  constructor(options: Partial<SelectionOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  update(options: Partial<SelectionOptions>): void {
    this.options = { ...this.options, ...options }
  }

  attach(): () => void {
    const onMouseUp = () => {
      // 延迟等待选区稳定
      window.setTimeout(() => void this.handleSelection(), 10)
    }
    const onMouseDown = (e: MouseEvent) => {
      // 点击气泡外部时关闭
      if (this.bubble && !this.bubble.contains(e.target as Node)) this.removeBubble()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.removeBubble()
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      this.removeBubble()
    }
  }

  private async handleSelection(): Promise<void> {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (!text || text.length < 2) {
      this.removeBubble()
      return
    }

    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!range) return

    if (!this.options.autoTranslate) {
      this.showBubble(range, text, null)
      return
    }

    this.showBubble(range, text, '翻译中…')
    if (this.pendingTimer !== null) window.clearTimeout(this.pendingTimer)

    // 防抖：连续调整选区时只请求最后一次
    this.pendingTimer = window.setTimeout(() => {
      void this.translate(range, text)
    }, 200)
  }

  private async translate(range: Range, text: string): Promise<void> {
    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: [{ id: 'sel', text }],
        source: this.options.source,
        target: this.options.target,
      })) as TranslateOutcome | undefined

      const result = outcome?.translations['sel']
      this.showBubble(range, text, result ?? '翻译失败')
    } catch {
      this.showBubble(range, text, '翻译服务无响应')
    }
  }

  private showBubble(range: Range, original: string, translation: string | null): void {
    this.removeBubble()
    const rect = range.getBoundingClientRect()

    const bubble = document.createElement('div')
    bubble.id = BUBBLE_ID
    bubble.className = 'bilens-selection-bubble'
    bubble.style.position = 'absolute'
    bubble.style.zIndex = '2147483647'

    const source = document.createElement('div')
    source.className = 'bilens-selection-source'
    source.textContent = original.length > 120 ? `${original.slice(0, 120)}…` : original

    const target = document.createElement('div')
    target.className = 'bilens-selection-target'
    target.textContent = translation ?? ''
    if (translation === null) target.textContent = '点击翻译'

    bubble.append(source, target)

    if (translation === null) {
      bubble.style.cursor = 'pointer'
      bubble.addEventListener('click', () => {
        void this.translate(range, original)
      })
    }

    document.body.appendChild(bubble)
    this.bubble = bubble

    // 定位：优先显示在选区下方，超出视口则上移
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const bubbleRect = bubble.getBoundingClientRect()
    let top = rect.bottom + scrollY + 8
    if (rect.bottom + bubbleRect.height + 16 > window.innerHeight) {
      top = rect.top + scrollY - bubbleRect.height - 8
    }
    let left = rect.left + scrollX + rect.width / 2 - bubbleRect.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - bubbleRect.width - 8))

    bubble.style.top = `${top}px`
    bubble.style.left = `${left}px`
  }

  private removeBubble(): void {
    this.bubble?.remove()
    this.bubble = null
  }
}
