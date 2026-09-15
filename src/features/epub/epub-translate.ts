import JSZip from 'jszip'
import type { TranslatableItem } from '@/shared/types'
import type { TranslateOutcome } from '@/core/translate/translator'

/**
 * EPUB 电子书翻译。
 *
 * 采用「解包 → 逐章翻译 → 重新打包」方案：
 * EPUB 本质是 zip，直接解出 XHTML 章节改文本再打回去，
 * 比走 epub.js 渲染管线更可靠，且能保证输出是合法 EPUB。
 */

export interface EpubTranslateOptions {
  source: string
  target: string
  /** true = 原文+译文对照；false = 仅译文 */
  bilingual: boolean
  onProgress?: (done: number, total: number, name: string) => void
}

export interface EpubTranslateResult {
  /** 翻译后的 EPUB 二进制 */
  data: Uint8Array
  chapters: number
  paragraphs: number
  translated: number
  failed: number
}

const TEXT_TAGS = new Set([
  'P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION',
])

export async function translateEpub(
  arrayBuffer: ArrayBuffer,
  options: EpubTranslateOptions,
): Promise<EpubTranslateResult> {
  const zip = await JSZip.loadAsync(arrayBuffer)

  // 找出所有 XHTML/HTML 章节
  const chapterPaths = Object.keys(zip.files).filter((path) => {
    const lower = path.toLowerCase()
    if (!/\.(x?html?|xhtml)$/.test(lower)) return false
    const entry = zip.files[path]
    return entry !== undefined && !entry.dir
  })

  let paragraphs = 0
  let translated = 0
  let failed = 0
  let chapterIndex = 0

  for (const path of chapterPaths) {
    const entry = zip.files[path]
    if (!entry) continue
    const html = await entry.async('string')
    chapterIndex += 1

    const { output, stats } = await translateChapterHtml(html, options)
    paragraphs += stats.paragraphs
    translated += stats.translated
    failed += stats.failed

    zip.file(path, output)
    options.onProgress?.(chapterIndex, chapterPaths.length, path.split('/').pop() ?? path)
  }

  const data = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return { data, chapters: chapterPaths.length, paragraphs, translated, failed }
}

interface ChapterStats {
  paragraphs: number
  translated: number
  failed: number
}

/** 翻译单章 HTML：保留结构与属性，只替换/追加文本 */
async function translateChapterHtml(
  html: string,
  options: EpubTranslateOptions,
): Promise<{ output: string; stats: ChapterStats }> {
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml')
  // 解析失败时回退到 text/html
  const parsed = doc.querySelector('parsererror') ? new DOMParser().parseFromString(html, 'text/html') : doc

  const blocks = collectBlocks(parsed.body)
  const stats: ChapterStats = { paragraphs: blocks.length, translated: 0, failed: 0 }
  if (blocks.length === 0) {
    return { output: serialize(parsed, html), stats }
  }

  const items: TranslatableItem[] = blocks.map((b) => ({ id: b.id, text: b.text }))
  const elById = new Map(blocks.map((b) => [b.id, b.el]))

  const BATCH = 40
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: batch,
        source: options.source,
        target: options.target,
      })) as TranslateOutcome | undefined

      if (!outcome) {
        stats.failed += batch.length
        continue
      }

      for (const [id, text] of Object.entries(outcome.translations)) {
        const el = elById.get(id)
        if (!el) continue
        appendTranslation(el, text, options.bilingual)
        stats.translated += 1
      }
      stats.failed += Object.keys(outcome.failed).length
    } catch {
      stats.failed += batch.length
    }
  }

  return { output: serialize(parsed, html), stats }
}

function serialize(doc: Document, fallback: string): string {
  if (doc.querySelector('parsererror')) return fallback
  const result = new XMLSerializer().serializeToString(doc)
  return result || fallback
}

interface Block {
  id: string
  text: string
  el: Element
}

/** 抽取段落级文本块：取最小可译单元，避免重复计数 */
function collectBlocks(body: HTMLElement | null): Block[] {
  if (!body) return []
  const blocks: Block[] = []
  let counter = 0

  const walk = (el: Element): void => {
    for (const child of [...el.children]) {
      if (child.hasAttribute('data-bilens-translated')) continue
      if (!TEXT_TAGS.has(child.tagName)) {
        walk(child)
        continue
      }

      const text = child.textContent?.trim() ?? ''
      if (text.length < 4 || hasBlockChild(child)) {
        walk(child)
        continue
      }

      counter += 1
      blocks.push({ id: `b${counter}`, text, el: child })
    }
  }

  walk(body)
  return blocks
}

function hasBlockChild(el: Element): boolean {
  for (const child of [...el.children]) {
    if (TEXT_TAGS.has(child.tagName)) return true
  }
  return false
}

/** 双语：译文追加在原文下方；仅译文：替换文本 */
function appendTranslation(el: Element, text: string, bilingual: boolean): void {
  el.setAttribute('data-bilens-translated', '1')
  const doc = el.ownerDocument

  if (!bilingual) {
    el.textContent = text
    return
  }

  // EPUB 是 XHTML，用 div 包裹译文
  const wrapper = doc.createElementNS(el.namespaceURI, 'span')
  wrapper.setAttribute('class', 'bilens-epub-target')
  wrapper.textContent = text
  el.appendChild(doc.createElementNS(el.namespaceURI, 'br'))
  el.appendChild(wrapper)
}
