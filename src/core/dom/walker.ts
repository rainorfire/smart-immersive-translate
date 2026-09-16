import type { TranslatableItem } from '@/shared/types'
import { segmentToRich, type RichSpec } from '../translate/rich'

/**
 * 网页可译文本抽取（两种粒度）。
 *
 * - collectTextBlocks：**段落级**抽取，主路径。把「叶子块级容器」内的行内文本
 *   拼成一整段送去翻译，译文整块回填。这是对齐沉浸式翻译观感的关键：链接、
 *   加粗等行内元素不再把段落切碎，避免译文「碎句穿插」。
 * - collectTextNodes：**节点级**抽取，悬停翻译用。只翻鼠标下的一段时首屏更快。
 *
 * 共同目标：只取「内容区域」的文本，避开导航噪音、代码、表单等，
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
 * 一个「段落」：同一块级容器内的一整段行内文本。
 * 一个段落只发一次翻译请求，译文整块回填。
 */
export interface CollectedBlock {
  item: TranslatableItem
  /** 段内全部原文文本节点，按文档顺序（含空格节点，用于精确拼接） */
  nodes: Text[]
  /** 译文锚点：position=after 插到它之后，before 插到它之前 */
  anchor: Text
  /** 段落容器：译文作为块级元素追加到容器末尾，形成「原文一段 + 译文一段」 */
  container?: Element
  /** 标题类容器：译文与原文同行紧跟 */
  inline: boolean
  /** 译文里要还原的行内元素快照（超链接/加粗等），空数组表示纯文本 */
  specs: RichSpec[]
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
      // 仅译文模式下被包裹的原文也不再重复翻译（否则会被 MutationObserver 反复触发）
      if (parent.closest('.bilens-orig')) return NodeFilter.FILTER_REJECT

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

// ---------------------------------------------------------------------------
// 段落级抽取（主路径）
// ---------------------------------------------------------------------------

/** 译文可「追加到容器末尾」的显示类型：这些容器整段独占，追加即换行成段 */
const APPEND_DISPLAYS = new Set([
  'block', 'list-item', 'table-cell', 'table-caption', 'flow-root',
])

/**
 * 视为「块级」的显示类型：据此把容器树切成段落。
 * 注意不含 inline-block / inline-flex——它们是行内的「药丸」，切开反而会把
 * 一句话拆成碎片。
 */
const BLOCK_DISPLAYS = new Set([
  ...APPEND_DISPLAYS,
  'flex', 'grid', 'table',
  'table-row', 'table-row-group', 'table-header-group', 'table-footer-group',
])

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/** 我们自己的 DOM，绝不能再翻（否则会「翻译译文」并触发自激） */
const OURS =
  ':is(.bilens-target-wrapper,.bilens-orig,.bilens-selection-bubble,' +
  '.bilens-subtitle-overlay,.bilens-image-overlay,.bilens-video-overlay)'

/** 嵌套深度上限，防病态 DOM 递归过深 */
const MAX_DEPTH = 150

interface TextConfig {
  exclude: Set<string>
  minLength: number
}

function resolveConfig(options: CollectOptions): TextConfig {
  return {
    exclude: new Set([
      ...HARD_SKIP,
      ...(options.excludeTags ?? []).map((t) => t.toUpperCase()),
    ]),
    minLength: options.minLength ?? 2,
  }
}

/**
 * 段落级抽取：把「叶子块级容器」内的行内文本拼成一整段。
 *
 * 与节点级抽取的区别：链接、加粗、斜体等行内元素**不切段**，
 * 整段只发一次请求、只回填一块译文。
 */
export function collectTextBlocks(
  root: Element,
  options: CollectOptions = {},
): CollectedBlock[] {
  const cfg = resolveConfig(options)
  const out: CollectedBlock[] = []
  walkContainer(root, cfg, out, 0)
  return out
}

/**
 * 递归切分容器。
 *
 * 一边扫描子节点，一边按「块级子元素」把行内文本切成若干段：
 * 连续的行内内容（文本 + a/b/em/span 等）合成一段，块级子元素则下钻递归。
 * 这样 `<li>文字<div>嵌套</div></li>` 这类混合容器的直接文本也不会被吞掉。
 */
function walkContainer(
  el: Element,
  cfg: TextConfig,
  out: CollectedBlock[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return
  if (el.childNodes.length === 0) return
  if (!isTranslatableElement(el, cfg)) return

  const display = getComputedStyle(el).display
  const blockLevel = BLOCK_DISPLAYS.has(display)

  const runs: Text[] = []
  const segments: Text[][] = []
  const flush = (): void => {
    if (runs.length === 0) return
    segments.push(runs.slice())
    runs.length = 0
  }

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child as Text
      if (isCandidateText(text)) runs.push(text)
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const childEl = child as Element
    if (!isTranslatableElement(childEl, cfg)) continue
    if (BLOCK_DISPLAYS.has(getComputedStyle(childEl).display)) {
      flush()
      walkContainer(childEl, cfg, out, depth + 1)
      continue
    }
    // 行内元素里塞了块级后代（卡片式链接等）：切段后下钻，避免糊成一整块
    if (hasBlockDescendant(childEl)) {
      flush()
      walkContainer(childEl, cfg, out, depth + 1)
      continue
    }
    for (const text of collectInlineText(childEl)) runs.push(text)
  }
  flush()

  if (segments.length === 0) return

  const isHeading =
    HEADING_TAGS.has(el.tagName) || el.getAttribute('role') === 'heading'
  // 标题、行内容器：译文与原文同行紧跟
  const inline = isHeading || !blockLevel
  // 只有「单段的块级容器」把译文追加到容器末尾；混合容器退回锚点插入，
  // 否则多段译文会全挤到容器最后
  const container =
    !inline && segments.length === 1 && APPEND_DISPLAYS.has(display) ? el : undefined

  for (const nodes of segments) {
    const text = joinSegmentText(nodes)
    if (text.length < cfg.minLength) continue
    if (!/\p{L}/u.test(text)) continue
    const anchor = lastMeaningful(nodes)
    if (!anchor) continue
    // 段落序列化为富文本：超链接/加粗等行内元素转成 <cN> 占位，
    // 译文回来后按占位还原成原元素本体（链接保持可点、样式不变）
    const { rich, specs } = segmentToRich(container ?? el, nodes)
    out.push({
      item: { id: '', text: rich || text },
      nodes,
      anchor,
      container,
      inline,
      specs,
    })
  }
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

/** 元素本身是否可翻译（标签黑名单 + 用户标记 + 我们自己的 DOM） */
function isTranslatableElement(el: Element, cfg: TextConfig): boolean {
  if (cfg.exclude.has(el.tagName)) return false
  if (el.closest(OURS)) return false
  if (hasSkipAncestor(el)) return false
  return true
}

/**
 * 单个文本节点是否可能入选段落。
 *
 * 这里**不过滤纯空白节点**——段落内 `<b>Hello</b> <i>world</i>` 之间的空格
 * 也是独立文本节点，丢掉就会把单词粘连。长度与字母的过滤放在拼接之后。
 */
function isCandidateText(node: Text): boolean {
  if (!node.nodeValue) return false
  const parent = node.parentElement
  if (!parent) return false
  if (HARD_SKIP.has(parent.tagName)) return false
  if (parent.closest(OURS)) return false
  if (hasSkipAncestor(parent)) return false
  if (isHidden(parent)) return false
  return true
}

/** 收集行内元素内部的全部文本节点（文档顺序） */
function collectInlineText(el: Element): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    const text = current as Text
    if (isCandidateText(text)) out.push(text)
    current = walker.nextNode()
  }
  return out
}

/** 行内元素内部是否嵌了块级后代（决定要不要切段下钻） */
function hasBlockDescendant(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (HARD_SKIP.has(child.tagName)) continue
    if (child.matches(OURS)) continue
    const display = getComputedStyle(child).display
    if (display === 'none') continue
    if (BLOCK_DISPLAYS.has(display)) return true
    if (hasBlockDescendant(child)) return true
  }
  return false
}

/**
 * 把段内文本节点拼成送去翻译的一整段。
 * 空白折叠成单空格：译文只用于回填，不需要与原文逐字符对齐。
 */
function joinSegmentText(nodes: Text[]): string {
  return nodes
    .map((node) => node.nodeValue ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 段内最后一个「有内容」的节点，作为译文锚点（避免锚在空白节点上） */
function lastMeaningful(nodes: Text[]): Text | undefined {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    if (node && node.nodeValue && node.nodeValue.trim().length > 0) return node
  }
  return undefined
}

/** 不可见元素不翻译（display:none / visibility:hidden / 零尺寸） */
function isHidden(el: Element): boolean {
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return true
  if (style.opacity === '0') return true
  return false
}
