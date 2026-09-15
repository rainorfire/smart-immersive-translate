import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TranslateOutcome } from '@/core/translate/translator'

/**
 * PDF 页内对照翻译。
 *
 * 方案说明（重要）：不做「保留排版重排」——那需要服务端级别的排版引擎。
 * 这里做的是**页内对照层**：渲染原页 → 提取文本块 → 翻译 →
 * 在页面上叠加译文区块，保持原页可读性。
 *
 * 每个页面的处理流程：
 * 1. pdf.js 渲染到 canvas（原页外观）
 * 2. getTextContent 拿到文本项与坐标
 * 3. 按行合并文本项 → 翻译 → 在对照层按原坐标定位渲染译文
 */

// worker 从扩展本地加载，不走 CDN
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('/pdf/pdf.worker.min.mjs')

export interface PdfTranslateOptions {
  source: string
  target: string
  /** 渲染倍率，影响清晰度与内存 */
  scale: number
  onProgress?: (page: number, total: number) => void
}

/** PDF 译文排布模式 */
export type PdfLayoutMode = 'bilingual' | 'translation-only'

/** 单个译文块的屏幕定位（像素） */
export interface PdfBlockLayout {
  left: number
  top: number
  width: number
  minHeight: number
}

export interface PdfTextBlock {
  index: number
  text: string
  /** 归一化坐标（0–1 比例），渲染时乘实际显示尺寸，缩放不变形 */
  normX: number
  normY: number
  normWidth: number
  /** 归一化行高，用于译文块的定位与不遮挡判断 */
  normHeight: number
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data }).promise
}

/** 提取单页的文本块（按行合并） */
export async function extractPageBlocks(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ blocks: PdfTextBlock[]; page: PDFPageProxy; viewportWidth: number; viewportHeight: number }> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()

  const pageHeight = viewport.height || 1
  const pageWidth = viewport.width || 1

  // 按 y 坐标聚合成行（同一行的文本项合并成一行文本）
  const lineMap = new Map<number, { texts: string[]; x: number; y: number; width: number; height: number }>()

  for (const item of content.items) {
    const it = item as { str?: string; transform?: number[]; width?: number; height?: number }
    const str = it.str ?? ''
    if (!str.trim()) continue

    const transform = it.transform ?? [1, 0, 0, 1, 0, 0]
    const x = transform[4] ?? 0
    // PDF 坐标原点在左下，页面显示原点在左上，翻转 y
    const y = pageHeight - (transform[5] ?? 0)
    const key = Math.round(y / 4) * 4
    const itemHeight = Math.abs(transform[3] ?? 0) || it.height || 12

    const existing = lineMap.get(key)
    if (existing) {
      existing.texts.push(str)
      existing.width += it.width ?? 0
      existing.height = Math.max(existing.height, itemHeight)
    } else {
      lineMap.set(key, { texts: [str], x, y, width: it.width ?? 0, height: itemHeight })
    }
  }

  const blocks: PdfTextBlock[] = [...lineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, line], index) => ({
      index,
      text: line.texts.join(' ').replace(/\s+/g, ' ').trim(),
      normX: clamp01(line.x / pageWidth),
      normY: clamp01(line.y / pageHeight),
      normWidth: clamp01(line.width / pageWidth),
      normHeight: clamp01(Math.max(line.height, 10) / pageHeight),
    }))
    .filter((b) => b.text.length > 1)

  return { blocks, page, viewportWidth: viewport.width, viewportHeight: viewport.height }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 把 PDF 页面渲染到指定 canvas */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const viewport = page.getViewport({ scale })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
}

/** 翻译一批文本块，返回 index → 译文 */
export async function translateBlocks(
  blocks: PdfTextBlock[],
  options: Pick<PdfTranslateOptions, 'source' | 'target'> & {
    onProgress?: (done: number, total: number) => void
  },
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  const BATCH = 30
  const total = blocks.length

  for (let i = 0; i < blocks.length; i += BATCH) {
    const batch = blocks.slice(i, i + BATCH)
    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: batch.map((b) => ({ id: String(b.index), text: b.text })),
        source: options.source,
        target: options.target,
      })) as TranslateOutcome | undefined

      if (!outcome) continue
      for (const [id, text] of Object.entries(outcome.translations)) {
        result.set(Number(id), text)
      }
    } catch {
      // 单批失败不影响其他批次
    }
    options.onProgress?.(Math.min(i + BATCH, total), total)
  }

  return result
}

/**
 * 计算译文块在页面上的定位。
 *
 * 双语对照：译文挂在原文行下方，两行都可见。
 * 仅译文：译文覆盖原文行，把原文挡住（白底不透明）。
 */
export function layoutPdfBlock(
  block: PdfTextBlock,
  viewportWidth: number,
  viewportHeight: number,
  scale: number,
  mode: PdfLayoutMode,
): PdfBlockLayout {
  const pageW = viewportWidth * scale
  const lineH = Math.max(block.normHeight * viewportHeight * scale, 12)
  const left = Math.max(0, block.normX * pageW)
  // 译文宽度按原文宽度放宽 40%，保证不漏字
  const width = Math.min(
    Math.max(block.normWidth * pageW * 1.4, 120),
    Math.max(pageW - left - 8, 120),
  )

  const originalTop = block.normY * viewportHeight * scale
  // 双语模式下一行原文 + 一行译文所需高度
  const top = mode === 'bilingual' ? originalTop + lineH * 0.95 : originalTop

  return { left, top, width, minHeight: lineH }
}
