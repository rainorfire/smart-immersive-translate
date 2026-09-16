/**
 * 富文本占位编解码。
 *
 * 目标：译文里把原文的超链接、加粗、斜体等行内元素**原样保住**。
 *
 * 为什么不能直接把 HTML 丢给引擎：
 * 实测（bing edge 端点，2026-09-15）把 `<a href="#">x</a>` 原样送出，
 * 返回的译文会把属性里的引号翻成中文引号（`href=“#”`），链接直接报废。
 *
 * 解法（对标闭源 `richTag: "c"`）：发送前把每个「需保留的元素」换成一个
 * **无属性占位标签** `<c0>…</c0>`。实测无属性标签在 bing 上保真度极高
 * （嵌套、重复、10+ 个都稳定），因为引擎没有可翻译的属性，无从破坏。
 * 收到译文后再按占位还原成原元素本体（含 href / target / class）。
 */

/** 需要保留到译文里的行内元素（有语义或影响观感） */
const KEEP_TAGS = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'INS', 'CODE', 'KBD',
  'MARK', 'SUB', 'SUP', 'ABBR', 'CITE', 'Q', 'SMALL', 'TIME', 'VAR',
])

/** 占位标签前缀：与常见的 a/b/span 都不冲突 */
const RICH_TAG = 'c'

/**
 * 序列化时**整棵丢弃**的元素。
 *
 * 段落里可能夹带 `<style>`（维基百科的 `.mw-parser-output cite.citation{…}`
 * 内联样式就是典型）：这些内容既不可译，混进请求还会把整段翻译打挂
 * （实测 326 字的参考文献因夹带 1800+ 字 CSS 而整段失败）。
 */
const DROP_SUBTREE = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME',
  'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'MAP', 'AREA', 'LINK', 'META',
])

/** 原文里一个待保留元素的快照 */
export interface RichSpec {
  tag: string
  /** 属性序列化文本（只含名与值），还原时原样回填 */
  attrs: string
}

/**
 * 段落 → 富文本。
 *
 * 直接遍历 DOM 生成，**不经过 innerHTML 字符串**，因此不会产生实体转义
 * （`&amp;` 之类）被引擎二次翻译的问题。
 *
 * @param container 段落所在容器
 * @param nodes     段内文本节点（文档顺序）
 */
export function segmentToRich(
  container: Element,
  nodes: Text[],
): { rich: string; specs: RichSpec[] } {
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (!first || !last) return { rich: '', specs: [] }

  const start = topChild(container, first)
  const end = topChild(container, last)
  if (!start || !end) return { rich: '', specs: [] }

  const range = document.createRange()
  range.setStartBefore(start)
  range.setEndAfter(end)
  const frag = range.cloneContents()

  const specs: RichSpec[] = []
  const parts: string[] = []

  // 段内文本节点数少于「区间内全部候选文本节点数」时，说明这一段只是某个
  // 行内容器的一部分（典型来源：按 <br> 拆行后，同一个 <span> 里出来的多行）。
  // 整区间克隆会把同容器的其它行一并序列化进来 → 行与行重复。
  // 这种情况走「按给定节点精确序列化」。
  if (countCandidateTexts(frag) !== nodes.length) {
    serializeExact(container, nodes, parts, specs)
    return { rich: parts.join('').replace(/\s+/g, ' ').trim(), specs }
  }

  serialize(frag, parts, specs)
  return { rich: parts.join('').replace(/\s+/g, ' ').trim(), specs }
}

/** 统计片段里的候选文本节点数（与 walker 的判定保持同一口径） */
function countCandidateTexts(node: Node): number {
  let count = 0
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      count += 1
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    if (DROP_SUBTREE.has(el.tagName)) continue
    if (el.className && String(el.className).includes('bilens-')) continue
    count += countCandidateTexts(el)
  }
  return count
}

/** node 到 container 之间的行内祖先链（自外向内） */
function inlineChain(container: Element, node: Node): Element[] {
  const chain: Element[] = []
  let current: Node | null = node.parentNode
  while (current && current !== container) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element
      if (KEEP_TAGS.has(el.tagName)) chain.push(el)
    }
    current = current.parentNode
  }
  return chain.reverse()
}

/**
 * 精确序列化：只序列化给定的文本节点，并把它们的行内祖先还原成占位标签。
 *
 * 与区间克隆的区别：不引入同容器内其它节点的内容，因此按 <br> 拆出的
 * 每一行都能各自拿到只属于自己的富文本。
 */
function serializeExact(
  container: Element,
  nodes: Text[],
  parts: string[],
  specs: RichSpec[],
): void {
  for (const node of nodes) {
    const chain = inlineChain(container, node)
    const ids: number[] = []
    for (const el of chain) {
      const id = specs.length
      specs[id] = { tag: el.tagName, attrs: attrText(el) }
      ids.push(id)
      parts.push(`<${RICH_TAG}${id}>`)
    }
    parts.push(node.nodeValue ?? '')
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      parts.push(`</${RICH_TAG}${ids[i]}>`)
    }
  }
}

/** 找到 node 在 container 下的最外层祖先（用于确定段落边界） */
function topChild(container: Element, node: Node): Node | null {
  let cur: Node | null = node
  while (cur && cur.parentNode !== container) cur = cur.parentNode
  return cur
}

/**
 * 序列化片段：文本原样，保留标签换成占位，其余标签丢弃只留文本。
 * 传 only 时只序列化该文本节点（节点级场景）。
 */
function serialize(node: Node, parts: string[], specs: RichSpec[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push((child as Text).nodeValue ?? '')
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    // style/script 等不可译子树整棵丢弃（内容混进请求会把整段翻译打挂）
    if (DROP_SUBTREE.has(el.tagName)) continue
    if (el.tagName === 'BR') {
      parts.push(' ')
      continue
    }
    // 我们自己的 DOM（译文等）不参与序列化
    if (el.className && String(el.className).includes('bilens-')) continue
    if (KEEP_TAGS.has(el.tagName)) {
      const id = specs.length
      specs[id] = { tag: el.tagName, attrs: attrText(el) }
      parts.push(`<${RICH_TAG}${id}>`)
      serialize(el, parts, specs)
      parts.push(`</${RICH_TAG}${id}>`)
      continue
    }
    // 非保留标签：丢弃标签本身，内容继续下钻
    serialize(el, parts, specs)
  }
}

/** 元素属性序列化成字面量文本（只取名与值，不执行任何东西） */
function attrText(el: Element): string {
  const out: string[] = []
  for (const attr of Array.from(el.attributes)) {
    out.push(`${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`)
  }
  return out.join(' ')
}

/**
 * 富文本译文 → 安全 DOM 片段。
 *
 * 关键：译文里的文本一律走 `textContent` 写入，**不解析 HTML**，
 * 只根据占位标签创建白名单元素。因此即便引擎返回 `<img onerror=...>`
 * 这类内容，也只会被当成普通文本，不存在注入面。
 */
export function richToFragment(text: string, specs: RichSpec[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  const stack: Element[] = []
  const holder = (): Element | DocumentFragment => stack[stack.length - 1] ?? frag
  const push = (node: Node): void => {
    holder().appendChild(node)
  }

  const re = new RegExp(`<${RICH_TAG}(\\d+)>|</${RICH_TAG}(\\d+)>`, 'gi')
  let cursor = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text))) {
    if (m.index > cursor) push(document.createTextNode(text.slice(cursor, m.index)))
    cursor = re.lastIndex

    if (m[1] !== undefined) {
      const spec = specs[Number(m[1])]
      if (!spec) continue
      const el = document.createElement(spec.tag)
      if (spec.attrs) {
        for (const attr of parseAttrs(spec.attrs)) {
          try {
            el.setAttribute(attr.name, attr.value)
          } catch {
            // 非法属性名（引擎可能改写了占位）：忽略，不影响译文展示
          }
        }
      }
      push(el)
      stack.push(el)
    } else {
      const el = stack.pop()
      if (el && el.parentNode) el.parentNode.appendChild(el)
    }
  }

  if (cursor < text.length) push(document.createTextNode(text.slice(cursor)))
  // 引擎漏了闭合标签时，把未闭合元素按文档顺序补回顶层
  for (const el of stack) {
    if (el.parentNode) el.parentNode.appendChild(el)
  }
  return frag
}

/** 属性字面量解析：` href="/a" target="_blank"` → 名值对 */
function parseAttrs(raw: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const name = m[1]
    if (!name) continue
    const value = (m[2] ?? m[3] ?? m[4] ?? '').replace(/&quot;/g, '"')
    out.push({ name, value })
  }
  return out
}

/** 富文本译文里是否还残留未还原的占位标签（引擎把标签翻坏了） */
export function hasLeftoverPlaceholder(text: string): boolean {
  return new RegExp(`</?${RICH_TAG}\\d+>`, 'i').test(text)
}
