import type { TranslationMode, TranslationPosition } from '@/shared/types'
import type { CollectedNode } from '../dom/walker'

/**
 * 双语渲染层。
 *
 * 类名契约沿用反编译分析的结论（类名是行为接口，便于样式与规则复用）：
 * - bilens-target-wrapper   译文容器
 * - bilens-target-inner     译文内层
 * - bilens-loading          加载态
 * - bilens-error            错误态
 */

export const CLS = {
  wrapper: 'bilens-target-wrapper',
  inner: 'bilens-target-inner',
  block: 'bilens-target-block',
  inline: 'bilens-target-inline',
  loading: 'bilens-loading',
  error: 'bilens-error',
  text: 'bilens-text',
} as const

/** 全部可用主题（对标官方 18 种） */
export const THEMES = [
  { id: 'bilens-theme-underline', label: '下划线' },
  { id: 'bilens-theme-native-underline', label: '原始下划线' },
  { id: 'bilens-theme-dashed', label: '虚线' },
  { id: 'bilens-theme-native-dashed', label: '原始虚线' },
  { id: 'bilens-theme-dotted', label: '点线' },
  { id: 'bilens-theme-native-dotted', label: '原始点线' },
  { id: 'bilens-theme-wavy', label: '波浪线' },
  { id: 'bilens-theme-thin-dashed', label: '细虚线' },
  { id: 'bilens-theme-solid-border', label: '实线框' },
  { id: 'bilens-theme-dashed-border', label: '虚线框' },
  { id: 'bilens-theme-highlight', label: '高亮' },
  { id: 'bilens-theme-marker', label: '荧光笔' },
  { id: 'bilens-theme-grey', label: '灰色' },
  { id: 'bilens-theme-opacity', label: '半透明' },
  { id: 'bilens-theme-mask', label: '模糊遮罩' },
  { id: 'bilens-theme-weakening', label: '弱化' },
  { id: 'bilens-theme-bold', label: '加粗' },
  { id: 'bilens-theme-italic', label: '斜体' },
] as const

/** 记录已插入的译文节点，便于还原 */
const inserted = new WeakMap<Text, HTMLElement>()

export interface RenderOptions {
  mode: TranslationMode
  position: TranslationPosition
  /** 译文样式主题类名 */
  theme?: string
}

/** 在原文节点旁插入译文 */
export function renderTranslation(
  target: CollectedNode,
  text: string,
  options: RenderOptions,
): void {
  const { node } = target
  const parent = node.parentElement
  if (!parent) return

  // 已渲染则只更新文本，避免重复插入
  const existing = inserted.get(node)
  if (existing) {
    const inner = existing.querySelector(`.${CLS.inner}`)
    if (inner) inner.textContent = text
    return
  }

  const wrapper = document.createElement('span')
  wrapper.className = `${CLS.wrapper} ${isBlock(parent) ? CLS.block : CLS.inline}`
  if (options.theme) wrapper.classList.add(options.theme)

  const inner = document.createElement('span')
  inner.className = `${CLS.inner} ${CLS.text}`
  inner.textContent = text
  wrapper.appendChild(inner)

  if (options.mode === 'translation-only') {
    // 仅译文模式：隐藏原文，只显示译文
    parent.setAttribute('data-bilens-original-hidden', '1')
    hideOriginal(parent)
  }

  if (options.position === 'before') node.parentNode?.insertBefore(wrapper, node)
  else node.parentNode?.insertBefore(wrapper, node.nextSibling)

  inserted.set(node, wrapper)
}

/** 显示加载态占位 */
export function renderLoading(target: CollectedNode): void {
  const { node } = target
  if (inserted.has(node)) return
  const parent = node.parentElement
  if (!parent) return
  const wrapper = document.createElement('span')
  wrapper.className = `${CLS.wrapper} ${CLS.loading}`
  wrapper.textContent = '···'
  node.parentNode?.insertBefore(wrapper, node.nextSibling)
  inserted.set(node, wrapper)
}

/** 渲染错误提示，不阻塞阅读 */
export function renderError(target: CollectedNode, message: string): void {
  const existing = inserted.get(target.node)
  if (existing) existing.remove()
  const wrapper = document.createElement('span')
  wrapper.className = `${CLS.wrapper} ${CLS.error}`
  wrapper.textContent = `[${message}]`
  target.node.parentNode?.insertBefore(wrapper, target.node.nextSibling)
  inserted.set(target.node, wrapper)
}

/** 隐藏原文（用属性而非改样式，便于还原） */
function hideOriginal(el: HTMLElement): void {
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let cur = walker.nextNode()
  while (cur) {
    textNodes.push(cur as Text)
    cur = walker.nextNode()
  }
  for (const t of textNodes) {
    if (t.parentElement?.closest(`.${CLS.wrapper}`)) continue
    t.parentElement?.setAttribute('data-bilens-orig-hidden', '1')
  }
}

function isBlock(el: Element): boolean {
  const display = getComputedStyle(el).display
  return display === 'block' || display === 'flex' || display === 'grid' || display === 'list-item'
}

/** 还原页面到原始状态 */
export function revertAll(root: ParentNode = document): void {
  root.querySelectorAll(`.${CLS.wrapper}`).forEach((el) => el.remove())
  root.querySelectorAll('[data-bilens-original-hidden]').forEach((el) => {
    el.removeAttribute('data-bilens-original-hidden')
  })
  root.querySelectorAll('[data-bilens-orig-hidden]').forEach((el) => {
    el.removeAttribute('data-bilens-orig-hidden')
  })
}
