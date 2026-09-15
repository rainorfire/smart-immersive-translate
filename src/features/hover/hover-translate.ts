import { collectTextNodes } from '@/core/dom/walker'
import { renderTranslation } from '@/core/render/renderer'
import type { TranslateOutcome } from '@/core/translate/translator'

/**
 * 鼠标悬停翻译。
 *
 * 交互（对标官方）：按住修饰键（默认 Alt）时，鼠标划过的段落自动翻译。
 * 相比整页翻译，这是「按需翻译」，适合快速浏览长文。
 *
 * 实现要点：
 * - 只在修饰键按下时激活，松开即停止，避免误触
 * - 按最近块级祖先去重，同一段落只请求一次
 * - 已翻译段落不重复请求
 */

export interface HoverTranslateOptions {
  source: string
  target: string
  /** 修饰键：alt / ctrl / meta / shift */
  modifier: 'alt' | 'ctrl' | 'meta' | 'shift'
}

const DEFAULTS: HoverTranslateOptions = {
  source: 'auto',
  target: 'zh-CN',
  modifier: 'alt',
}

const done = new WeakSet<Element>()

export class HoverTranslator {
  private options: HoverTranslateOptions
  private active = false
  private theme: string | undefined

  constructor(options: Partial<HoverTranslateOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  update(options: Partial<HoverTranslateOptions>): void {
    this.options = { ...this.options, ...options }
  }

  setTheme(theme?: string): void {
    this.theme = theme
  }

  attach(): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.matchesModifier(e)) this.active = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) this.active = false
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!this.active) return
      void this.handleHover(e)
    }
    const onBlur = () => {
      this.active = false
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })
    window.addEventListener('blur', onBlur)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('blur', onBlur)
    }
  }

  private matchesModifier(e: KeyboardEvent): boolean {
    switch (this.options.modifier) {
      case 'alt':
        return e.altKey && !e.ctrlKey && !e.metaKey
      case 'ctrl':
        return e.ctrlKey && !e.altKey && !e.metaKey
      case 'meta':
        return e.metaKey
      case 'shift':
        return e.shiftKey && !e.altKey && !e.ctrlKey
    }
  }

  private lastTarget: Element | null = null

  private async handleHover(event: MouseEvent): Promise<void> {
    const el = document.elementFromPoint(event.clientX, event.clientY)
    if (!el) return

    const block = closestBlock(el)
    if (!block) return
    if (block === this.lastTarget) return
    this.lastTarget = block

    if (done.has(block)) return
    if (block.closest('.bilens-target-wrapper')) return
    done.add(block)

    const collected = collectTextNodes(block, { minLength: 2 })
    if (collected.length === 0) return

    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: collected.map((c) => c.item),
        source: this.options.source,
        target: this.options.target,
      })) as TranslateOutcome | undefined

      if (!outcome) return
      const byId = new Map(collected.map((c) => [c.item.id, c]))
      for (const [id, text] of Object.entries(outcome.translations)) {
        const target = byId.get(id)
        if (target) {
          renderTranslation(target, text, {
            mode: 'dual',
            position: 'after',
            theme: this.theme,
          })
        }
      }
    } catch {
      done.delete(block)
    }
  }
}

/** 找到最近的块级祖先作为翻译单元 */
function closestBlock(el: Element): Element | null {
  let node: Element | null = el
  while (node) {
    if (node === document.body) return node
    const display = getComputedStyle(node).display
    if (display === 'block' || display === 'flex' || display === 'grid' || display === 'list-item') {
      return node
    }
    node = node.parentElement
  }
  return null
}
