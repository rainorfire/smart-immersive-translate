import type { TranslationMode, TranslationPosition } from '@/shared/types'
import type { CollectedBlock } from '../dom/walker'
import { hasLeftoverPlaceholder, richToFragment, type RichSpec } from '../translate/rich'

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
  /** 仅译文模式下包裹原文的容器（可逆） */
  orig: 'bilens-orig',
} as const

/** 全部可用主题（对标官方 18 种） */
export const THEMES = [
  { id: 'bilens-theme-none', label: '无（继承原文样式）' },
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

/**
 * 渲染目标：一个「段落」。
 *
 * 与旧实现的差异：渲染单元从「单个文本节点」升级为「整段」。
 * 一整段只插一个译文容器，段落不再被链接/加粗切成碎片。
 */
export interface RenderTarget {
  /** 段内原文文本节点，按文档顺序 */
  nodes: Text[]
  /** 锚点：position=after 插到它之后，before 插到它之前 */
  anchor: Text
  /** 段落容器：译文作为块级元素追加到容器末尾 */
  container?: Element
  /** 标题类：译文与原文同行紧跟 */
  inline?: boolean
  /** 译文里要还原的行内元素快照（超链接/加粗等） */
  specs?: RichSpec[]
}

interface RenderedSegment {
  wrapper: HTMLElement
  nodes: Text[]
}

/** key = 段首文本节点 */
const rendered = new Map<Text, RenderedSegment>()

/** 原文文本节点 → 隐藏包裹层（仅译文模式） */
const hiddenOriginals = new Map<Text, HTMLElement>()

/** 段落抽取结果 → 渲染目标 */
export function targetOf(block: CollectedBlock): RenderTarget {
  return {
    nodes: block.nodes,
    anchor: block.anchor,
    container: block.container,
    inline: block.inline,
    specs: block.specs,
  }
}

/** 该段是否已渲染过（增量翻译时用于跳过重复段落，避免重复请求与重复插入） */
export function hasRendered(target: RenderTarget): boolean {
  const first = target.nodes[0]
  if (!first) return false
  const segment = rendered.get(first)
  return Boolean(segment && segment.wrapper.isConnected)
}

/**
 * 清理已脱离 DOM 的陈旧登记。
 *
 * rendered 持有强引用（仅译文模式切换需要遍历），无限滚动页面必须定期剪枝，
 * 否则内存只增不减；剪枝时顺手把残留的原文包裹层还原掉。
 */
export function pruneDetached(): void {
  for (const [key, segment] of rendered) {
    if (segment.wrapper.isConnected) continue
    showOriginals(segment.nodes)
    rendered.delete(key)
  }
}

export interface RenderOptions {
  mode: TranslationMode
  position: TranslationPosition
  /** 译文样式主题类名 */
  theme?: string
}

/**
 * 创建译文容器。
 *
 * 用 `<font>` 而非 `<span>`：站点 CSS 里 `p span` 这类规则会把译文的
 * 字体/字号/颜色一起打穿，`<font>` 天然继承父级排版且极少被站点规则命中。
 * 类名契约不变，CSS 与站点规则逻辑不受影响。
 */
function createWrapper(positionClass: string): HTMLElement {
  const wrapper = document.createElement('font') as unknown as HTMLElement
  wrapper.className = `${CLS.wrapper} ${positionClass}`
  wrapper.setAttribute('translate', 'no')
  return wrapper
}

/** 创建译文内层容器 */
function createInner(): HTMLElement {
  const inner = document.createElement('font') as unknown as HTMLElement
  inner.className = `${CLS.inner} ${CLS.text}`
  inner.setAttribute('translate', 'no')
  return inner
}

/**
 * 把译文写进内层。
 *
 * 有富文本快照（段落含超链接/加粗）时按占位还原成原元素，
 * 链接保持 `href`/`target` 原样，可点、样式不变。
 * 引擎把占位标签翻坏时退回纯文本，绝不让 `<c0>` 残渣漏到页面上。
 */
function fillInner(inner: HTMLElement, text: string, target: RenderTarget): void {
  const specs = target.specs
  if (!specs || specs.length === 0) {
    inner.textContent = text
    return
  }

  const frag = richToFragment(text, specs)
  // 引擎把占位标签翻坏时，会残留 `<c0>` 之类的字面量；此时退回纯文本，
  // 保证页面上不出现标记残渣。正常还原时占位已被消耗，不会误判。
  if (hasLeftoverPlaceholder(frag.textContent ?? '')) {
    inner.textContent = stripPlaceholders(text)
    return
  }
  inner.textContent = ''
  inner.appendChild(frag)
}

/** 剥掉译文里的占位标记，只留文字 */
function stripPlaceholders(text: string): string {
  return text.replace(new RegExp(`</?c\\d+>`, 'gi'), '')
}

/** 段落译文就位：整段插一个译文容器 */
export function renderTranslation(
  target: RenderTarget,
  text: string,
  options: RenderOptions,
): void {
  const key = target.nodes[0]
  if (!key) return

  // 已有容器（可能是加载占位气泡）：就地升级成译文容器
  const existing = rendered.get(key)
  if (existing && existing.wrapper.isConnected) {
    upgradeToTranslation(existing.wrapper, text, target, options)
    if (options.mode === 'translation-only') hideOriginals(target.nodes)
    return
  }

  const wrapper = createWrapper(isBlockSegment(target) ? CLS.block : CLS.inline)
  if (options.theme) wrapper.classList.add(options.theme)

  const inner = createInner()
  fillInner(inner, text, target)
  wrapper.appendChild(inner)

  insertWrapper(wrapper, target, options)
  rendered.set(key, { wrapper, nodes: target.nodes })

  if (options.mode === 'translation-only') hideOriginals(target.nodes)
}

/** 显示加载态占位（整段一个「···」，不再是每节点一个） */
export function renderLoading(target: RenderTarget): void {
  const key = target.nodes[0]
  if (!key) return
  const previous = rendered.get(key)
  if (previous && previous.wrapper.isConnected) return

  const wrapper = createWrapper(
    `${isBlockSegment(target) ? CLS.block : CLS.inline} ${CLS.loading}`,
  )
  wrapper.textContent = '···'
  insertWrapper(wrapper, target, { mode: 'dual', position: 'after' })
  rendered.set(key, { wrapper, nodes: target.nodes })
}

/**
 * 把已存在的容器（通常是加载占位气泡）升级为译文容器。
 *
 * 关键：占位气泡是纯文本、没有 `.bilens-target-inner` 内层。
 * 旧实现查到 inner 为 null 后直接 return，导致译文被永久丢弃、页面卡在「···」。
 * 这里补齐内层并覆写文本，同时清掉 loading / error 状态。
 */
function upgradeToTranslation(
  wrapper: HTMLElement,
  text: string,
  target: RenderTarget,
  options: RenderOptions,
): void {
  wrapper.classList.remove(CLS.loading, CLS.error)
  if (!wrapper.classList.contains(CLS.block) && !wrapper.classList.contains(CLS.inline)) {
    wrapper.classList.add(isBlockSegment(target) ? CLS.block : CLS.inline)
  }
  if (options.theme) wrapper.classList.add(options.theme)

  let inner = wrapper.querySelector(`.${CLS.inner}`)
  if (!inner) {
    wrapper.textContent = ''
    inner = createInner()
    wrapper.appendChild(inner)
  }
  fillInner(inner as HTMLElement, text, target)
}

/** 渲染错误提示，不阻塞阅读 */
export function renderError(target: RenderTarget, message: string): void {
  const key = target.nodes[0]
  if (!key) return
  const existing = rendered.get(key)
  if (existing) existing.wrapper.remove()

  const wrapper = createWrapper(
    `${CLS.error} ${isBlockSegment(target) ? CLS.block : CLS.inline}`,
  )
  wrapper.textContent = `[${message}]`
  insertWrapper(wrapper, target, { mode: 'dual', position: 'after' })
  rendered.set(key, { wrapper, nodes: target.nodes })
  // 出错时恢复原文，避免「仅译文」模式下整段消失
  showOriginals(target.nodes)
}

/**
 * 隐藏整段原文：把段内每个文本节点包进 `.bilens-orig` 容器。
 *
 * 用「包裹文本节点」而非「给父元素打属性」——后者会把同一父元素下的译文一起隐藏。
 */
function hideOriginal(node: Text): void {
  if (hiddenOriginals.has(node)) return
  const parent = node.parentNode
  if (!parent) return
  const span = document.createElement('span')
  span.className = CLS.orig
  parent.insertBefore(span, node)
  span.appendChild(node)
  hiddenOriginals.set(node, span)
}

function hideOriginals(nodes: Text[]): void {
  for (const node of nodes) hideOriginal(node)
}

function showOriginals(nodes: Text[]): void {
  for (const node of nodes) showOriginal(node)
}

/** 恢复单条原文：解包 `.bilens-orig` */
function showOriginal(node: Text): void {
  const span = hiddenOriginals.get(node)
  if (!span) return
  hiddenOriginals.delete(node)
  const parent = span.parentNode
  if (!parent) return
  parent.insertBefore(node, span)
  span.remove()
}

/**
 * 切换「仅译文 / 双语」显示模式（不重新请求翻译）。
 * 译文容器已在 DOM 中，这里只做原文的隐藏与恢复。
 */
export function setTranslationOnly(active: boolean): void {
  pruneDetached()
  for (const segment of rendered.values()) {
    if (!segment.wrapper.isConnected) continue
    if (active) hideOriginals(segment.nodes)
    else showOriginals(segment.nodes)
  }
  document.documentElement.toggleAttribute('data-bilens-translation-only', active)
}

/**
 * 译文是否按独立段落显示。
 *
 * 段级渲染的定位就是「原文一整段 → 译文一整段」，所以默认按块级走；
 * 只有标题这类需要与原文同行的段落才内联。
 */
function isBlockSegment(target: RenderTarget): boolean {
  return !target.inline
}

/** 插入译文容器：块级段落挂到容器末尾，行内/标题紧跟锚点 */
function insertWrapper(
  wrapper: HTMLElement,
  target: RenderTarget,
  options: RenderOptions,
): void {
  const container = target.container
  if (container && !target.inline) {
    if (options.position === 'before') {
      container.insertBefore(wrapper, container.firstChild)
    } else {
      container.appendChild(wrapper)
    }
    return
  }

  const anchor = target.anchor
  const parent = anchor.parentNode
  if (!parent) return
  if (options.position === 'before') parent.insertBefore(wrapper, anchor)
  else parent.insertBefore(wrapper, anchor.nextSibling)
}

/** 还原页面到原始状态 */
export function revertAll(root: ParentNode = document): void {
  for (const node of [...hiddenOriginals.keys()]) showOriginal(node)
  root.querySelectorAll(`.${CLS.wrapper}`).forEach((el) => el.remove())
  root.querySelectorAll(`.${CLS.orig}`).forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    el.remove()
  })
  rendered.clear()
  hiddenOriginals.clear()
}
