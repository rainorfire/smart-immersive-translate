import type { TranslatableItem } from '@/shared/types'

/**
 * 把一批文本按引擎的长度上限切成多个批次。
 *
 * 策略：贪心装箱——每条文本不超过单条上限（超长则硬切），
 * 批次总长不超过组上限。这样能最大化单次请求的利用率，
 * 又不会因为超限被引擎拒绝。
 */
export function buildBatches(
  items: TranslatableItem[],
  maxTextLength: number,
  maxGroupLength: number,
): TranslatableItem[][] {
  const batches: TranslatableItem[][] = []
  let current: TranslatableItem[] = []
  let currentLength = 0

  for (const item of items) {
    // 超长单条硬切分，避免整批失败
    const pieces =
      item.text.length > maxTextLength ? hardSplit(item, maxTextLength) : [item]

    for (const piece of pieces) {
      const pieceLength = piece.text.length
      if (current.length > 0 && currentLength + pieceLength > maxGroupLength) {
        batches.push(current)
        current = []
        currentLength = 0
      }
      current.push(piece)
      currentLength += pieceLength
    }
  }

  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * 硬切分超长文本。
 * 优先在句末标点处断开，找不到标点再按长度硬切。
 */
function hardSplit(item: TranslatableItem, limit: number): TranslatableItem[] {
  const result: TranslatableItem[] = []
  const { text } = item
  let start = 0
  let part = 0
  // 上一切片遗留的未闭合占位标签，需要在下一片开头重新打开
  let carry = ''

  while (start < text.length) {
    const avail = limit - carry.length
    let end = Math.min(start + Math.max(avail, 1), text.length)
    if (end < text.length) {
      const window = text.slice(start, end)
      // 只能在「不在占位标签内部」的位置下刀，否则标签会被切断
      const breakAt = findSentenceBreak(window)
      if (breakAt > 0) end = start + breakAt
    }
    const body = text.slice(start, end)
    const open = openPlaceholders(carry + body)
    // 末尾补上未闭合标签的闭合，保证本片标签配对；未闭合的留到下一片重开
    const piece = carry + body + open.map((id) => `</c${id}>`).join('')
    result.push({ id: `${item.id}::${part}`, text: piece })
    carry = open.map((id) => `<c${id}>`).join('')
    start = end
    part += 1
  }
  if (carry) {
    result.push({ id: `${item.id}::${part}`, text: carry })
  }

  return result
}

const SENTENCE_END = /[.。!！?？;；\n]/

/** 富文本占位标签，例如 `<c0>` / `</c12>` */
const PLACEHOLDER = /<\/?c\d+>/g

function findSentenceBreak(window: string): number {
  const minKeep = Math.floor(window.length * 0.5)
  for (let i = window.length - 1; i >= minKeep; i -= 1) {
    const ch = window[i]
    if (ch && SENTENCE_END.test(ch)) {
      const at = i + 1
      // 断点若落在占位标签内部（`<c0` / `/c0>`），挪到标签之后再断，
      // 否则会把 `<c0>` 切成两半，译文无法还原链接
      if (insidePlaceholder(window, at)) continue
      return at
    }
  }
  return -1
}

/** 位置 at 是否落在某个占位标签的内部 */
function insidePlaceholder(text: string, at: number): boolean {
  PLACEHOLDER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PLACEHOLDER.exec(text))) {
    if (at > m.index && at < m.index + m[0].length) return true
  }
  return false
}

/** 返回文本里尚未闭合的占位标签 id（按嵌套顺序） */
function openPlaceholders(text: string): number[] {
  const re = /<c(\d+)>|<\/c(\d+)>/g
  const stack: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) stack.push(Number(m[1]))
    else stack.pop()
  }
  return stack
}

/** 把切分后的译文按原 id 合并回去 */
export function mergeSplit(
  original: TranslatableItem[],
  translations: Record<string, string>,
): { merged: Record<string, string>; failed: string[] } {
  const merged: Record<string, string> = {}
  const failed: string[] = []

  for (const item of original) {
    const parts: string[] = []
    let part = 0
    let missing = false

    // 先尝试拼接切片；只有一片时 id 就是原 id
    while (true) {
      const key = part === 0 ? item.id : `${item.id}::${part}`
      const value = translations[key]
      if (value === undefined) {
        if (part === 0) missing = true
        break
      }
      parts.push(value)
      part += 1
      // 下一切片不存在则结束
      if (translations[`${item.id}::${part}`] === undefined) break
    }

    if (missing || parts.length === 0) failed.push(item.id)
    else merged[item.id] = parts.join('')
  }

  return { merged, failed }
}
