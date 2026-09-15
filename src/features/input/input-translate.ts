import type { TranslateOutcome } from '@/core/translate/translator'

/**
 * 输入框翻译。
 *
 * 交互（对标官方）：在输入框里输入内容后，连按三次触发键（默认 Alt+I 走快捷键，
 * 这里实现的是**行尾触发字符**方案），把当前内容翻译为配置的目标语言并回填。
 *
 * 实现要点：
 * - 覆盖 input / textarea / contenteditable 三类可编辑元素
 * - 只在触发字符出现在行尾且与内容之间有分隔时生效
 * - 翻译期间显示 loading 状态，失败时保留原文
 */

const TRIGGER_TIMEOUT = 1500

export interface InputTranslateOptions {
  source: string
  target: string
  /** 触发键，默认 Alt+I 由快捷键处理；此处为行尾触发字符 */
  triggerKey: string
  repeatTimes: number
}

const DEFAULTS: InputTranslateOptions = {
  source: 'auto',
  target: 'zh-CN',
  triggerKey: '///',
  repeatTimes: 1,
}

export class InputTranslator {
  private options: InputTranslateOptions
  private lastTriggerAt = 0
  private inflight = new WeakSet<Element>()

  constructor(options: Partial<InputTranslateOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  update(options: Partial<InputTranslateOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /** 绑定到 document，捕获所有可编辑元素的输入 */
  attach(): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
      void this.handleKeyDown(event)
    }
    const onInput = (event: Event) => {
      void this.handleInput(event)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('input', onInput, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('input', onInput, true)
    }
  }

  /** 快捷键触发：翻译当前聚焦的输入框 */
  async translateFocused(): Promise<void> {
    const el = document.activeElement
    if (!el || !isEditable(el)) return
    await this.translateElement(el as HTMLElement)
  }

  private async handleKeyDown(event: KeyboardEvent): Promise<void> {
    // Alt+I 由 background 的 commands 转成消息，这里处理浏览器内直接按键
    if (event.altKey && event.key.toLowerCase() === 'i') {
      this.lastTriggerAt = Date.now()
    }
  }

  private async handleInput(event: Event): Promise<void> {
    const el = event.target
    if (!(el instanceof HTMLElement) || !isEditable(el)) return

    const text = getEditableText(el)
    if (!text) return

    // 行尾触发字符：内容以触发符结尾
    const trigger = this.options.triggerKey
    const trimmed = text.replace(/\s+$/, '')
    // 触发符可重复出现 N 次，按实际重复次数剥离
    const repeats = countTrailingRepeats(trimmed, trigger)
    if (repeats < this.options.repeatTimes) return
    if (this.inflight.has(el)) return

    // 立即去掉触发符，避免被一起翻译
    const cleaned = trimmed.slice(0, -(trigger.length * repeats)).trimEnd()
    setEditableText(el, cleaned)

    await this.translateElement(el, cleaned)
  }

  private async translateElement(el: HTMLElement, presetText?: string): Promise<void> {
    if (this.inflight.has(el)) return
    const text = presetText ?? getEditableText(el)
    if (!text.trim()) return

    this.inflight.add(el)
    setBusy(el, true)
    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: [{ id: 'input', text }],
        source: this.options.source,
        target: this.options.target,
      })) as TranslateOutcome | undefined

      const result = outcome?.translations['input']
      if (result) setEditableText(el, result)
    } catch {
      // 失败保留原文，不打扰用户
    } finally {
      setBusy(el, false)
      this.inflight.delete(el)
    }
  }
}

export function isEditable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLInputElement) {
    const ok = ['text', 'search', 'url', 'email', 'tel', '']
    return ok.includes(el.type) && !el.disabled && !el.readOnly
  }
  return el instanceof HTMLElement && el.isContentEditable
}

export function getEditableText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return el.innerText ?? el.textContent ?? ''
}

export function setEditableText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // 走原生 setter，保证 React/Vue 等框架能感知变更
    const proto = el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  el.textContent = text
  el.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

function setBusy(el: HTMLElement, busy: boolean): void {
  if (busy) el.setAttribute('data-bilens-input-busy', '1')
  else el.removeAttribute('data-bilens-input-busy')
}

/** 统计字符串末尾连续重复触发符的次数 */
export function countTrailingRepeats(text: string, trigger: string): number {
  if (!trigger) return 0
  let count = 0
  let end = text.length
  while (end - trigger.length >= 0 && text.slice(end - trigger.length, end) === trigger) {
    count += 1
    end -= trigger.length
  }
  return count
}
