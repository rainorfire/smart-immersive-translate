import type { TranslatableItem } from '@/shared/types'

/**
 * 网页可译文本抽取。
 *
 * 目标：只取「内容区域」的文本节点，避开导航、代码、表单等噪音，
 * 对标沉浸式翻译「像阅读模式一样只翻译正文」的核心体验。
 */

/** 这些标签内部一律不翻译 */
const HARD_SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'SVG', 'CANVAS', 'IFRAME',
  'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'MAP', 'AREA', 'TEMPLATE',
])

/** 用户显式标记跳过的类名/属性 */
const SKIP_CLASS = 'bilens-notranslate'

export interface CollectOptions {
  excludeTags?: string[]
  /** 最小文本长度，过滤单字噪音 */
  minLength?: number
}

export interface CollectedNode {
  item: TranslatableItem
  node: Text
}

/**
 * 遍历 DOM 抽取待翻译文本节点。
 * 返回「节点 → 文本」的映射，供渲染层原位插入译文。
 */
export function collectTextNodes(
  root: ParentNode,
  options: CollectOptions = {},
): CollectedNode[] {
  const exclude = new Set([
    ...HARD_SKIP,
    ...(options.excludeTags ?? []).map((t) => t.toUpperCase()),
  ])
  const minLength = options.minLength ?? 2
  const collected: CollectedNode[] = []
  let counter = 0

  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const text = node.nodeValue
      if (!text || text.trim().length < minLength) return NodeFilter.FILTER_REJECT
      if (!/\p{L}/u.test(text)) return NodeFilter.FILTER_REJECT

      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (exclude.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      if (isHidden(parent)) return NodeFilter.FILTER_REJECT
      if (hasSkipAncestor(parent)) return NodeFilter.FILTER_REJECT
      // 已经是译文容器的内容不再翻译
      if (parent.closest('.bilens-target-wrapper')) return NodeFilter.FILTER_REJECT

      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current) {
    const textNode = current as Text
    counter += 1
    collected.push({
      item: { id: `n${counter}`, text: textNode.nodeValue?.trim() ?? '' },
      node: textNode,
    })
    current = walker.nextNode()
  }

  return collected
}

/** 元素或祖先是否被标记为不翻译 */
function hasSkipAncestor(el: Element): boolean {
  let node: Element | null = el
  while (node) {
    if (node.classList.contains(SKIP_CLASS)) return true
    if (node.getAttribute('translate') === 'no') return true
    if (node.hasAttribute('data-bilens-skip')) return true
    node = node.parentElement
  }
  return false
}

/** 不可见元素不翻译（display:none / visibility:hidden / 零尺寸） */
function isHidden(el: Element): boolean {
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return true
  if (style.opacity === '0') return true
  return false
}
