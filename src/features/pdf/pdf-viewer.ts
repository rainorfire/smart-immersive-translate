import { loadConfig } from '@/shared/config'
import {
  extractPageBlocks,
  layoutPdfBlock,
  openPdf,
  renderPageToCanvas,
  translateBlocks,
  type PdfBlockLayout,
  type PdfLayoutMode,
  type PdfTextBlock,
} from './pdf-translate'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

/**
 * PDF 翻译查看器。
 *
 * 交互设计：
 * - 连续滚动：所有页面按序渲染，滚动即阅读，不用翻页
 * - 缩放：0.6–3.0 倍，重算 canvas 与译文对照层
 * - 双模式：双语对照（译文挂在原文行下方）/ 仅译文（白底覆盖原文行）
 * - 懒渲染：页面进入视口才渲染，长文档不卡
 *
 * 说明：不做「保留排版重排」——那需要服务端排版引擎。
 * 这里做页内对照层，原页外观完整保留，译文按原坐标贴合。
 */

interface PageState {
  number: number
  container: HTMLElement
  canvas: HTMLCanvasElement
  overlay: HTMLElement
  rendered: boolean
  blocks: PdfTextBlock[] | null
  texts: Map<number, string> | null
  width: number
  height: number
}

export interface PdfViewerCallbacks {
  onStatus?: (text: string) => void
  onPageChange?: (page: number, total: number) => void
}

export class PdfViewer {
  private doc: PDFDocumentProxy | null = null
  private pages: PageState[] = []
  private scale = 1.4
  private mode: PdfLayoutMode = 'bilingual'
  private aborted = false
  private readonly observer: IntersectionObserver

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: PdfViewerCallbacks = {},
  ) {
    // 页面进入视口才渲染，滚动长文档时避免一次性全部绘制
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const page = this.pages.find((p) => p.container === entry.target)
          if (page && !page.rendered) void this.renderPage(page)
        }
      },
      { rootMargin: '300px 0px' },
    )
  }

  get totalPages(): number {
    return this.doc?.numPages ?? 0
  }

  get currentScale(): number {
    return this.scale
  }

  get layoutMode(): PdfLayoutMode {
    return this.mode
  }

  /** 载入 PDF 并调度渲染 */
  async load(data: ArrayBuffer): Promise<void> {
    this.observer.disconnect()
    this.pages = []
    this.root.innerHTML = ''

    this.doc = await openPdf(data)
    this.callbacks.onStatus?.(`共 ${this.doc.numPages} 页`)

    for (let n = 1; n <= this.doc.numPages; n += 1) {
      const container = document.createElement('div')
      container.className = 'page-wrap'
      container.dataset.page = String(n)

      const placeholder = document.createElement('div')
      placeholder.className = 'page-placeholder'
      placeholder.textContent = `第 ${n} 页`

      const canvas = document.createElement('canvas')
      canvas.hidden = true

      const overlay = document.createElement('div')
      overlay.className = 'pdf-overlay'

      container.append(placeholder, canvas, overlay)
      this.root.appendChild(container)

      this.pages.push({
        number: n,
        container,
        canvas,
        overlay,
        rendered: false,
        blocks: null,
        texts: null,
        width: 0,
        height: 0,
      })
      this.observer.observe(container)
    }
  }

  /** 设置缩放倍率，重绘所有已渲染页面 */
  setScale(scale: number): void {
    this.scale = Math.min(3, Math.max(0.6, scale))
    for (const page of this.pages) {
      if (page.rendered) void this.renderPage(page, true)
    }
  }

  /** 切换双语 / 仅译文，不重新请求翻译 */
  setMode(mode: PdfLayoutMode): void {
    if (this.mode === mode) return
    this.mode = mode
    for (const page of this.pages) {
      if (page.texts) this.paintOverlay(page)
    }
  }

  /** 翻译指定页（已翻译则跳过） */
  async translatePage(pageNumber: number, force = false): Promise<void> {
    const page = this.pages[pageNumber - 1]
    if (!page || !this.doc) return
    if (page.texts && !force) return

    const blocks = await this.ensureBlocks(page)
    if (!blocks || blocks.length === 0) return

    const config = await loadConfig()
    const texts = await translateBlocks(blocks, {
      source: config.sourceLanguage,
      target: config.targetLanguage,
      onProgress: (done, total) => {
        this.callbacks.onStatus?.(`第 ${pageNumber} 页 ${done}/${total}`)
      },
    })

    page.texts = texts
    this.paintOverlay(page)
  }

  /** 翻译全部页面，按页串行以避免触发引擎限流 */
  async translateAll(
    onProgress?: (page: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<{ done: number; total: number; aborted: boolean }> {
    const total = this.totalPages
    this.aborted = false
    let done = 0
    for (let n = 1; n <= total; n += 1) {
      if (this.aborted || shouldStop?.()) {
        return { done, total, aborted: true }
      }
      onProgress?.(n, total)
      await this.translatePage(n)
      done = n
    }
    this.callbacks.onStatus?.('全文翻译完成')
    return { done, total, aborted: false }
  }

  /** 中止全文翻译（已完成的页面结果保留） */
  abort(): void {
    this.aborted = true
  }

  /** 跳转到指定页 */
  scrollToPage(pageNumber: number): void {
    const page = this.pages[pageNumber - 1]
    page?.container.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  destroy(): void {
    this.observer.disconnect()
    this.pages = []
    this.doc = null
  }

  // ---------- 内部实现 ----------

  /** 提取页面文本块（结果缓存，供缩放/模式切换复用） */
  private async ensureBlocks(page: PageState): Promise<PdfTextBlock[] | null> {
    if (page.blocks) return page.blocks
    if (!this.doc) return null
    try {
      const { blocks, viewportWidth, viewportHeight } = await extractPageBlocks(
        this.doc,
        page.number,
      )
      page.blocks = blocks
      page.width = viewportWidth
      page.height = viewportHeight
      return blocks
    } catch {
      return null
    }
  }

  /** 渲染单页到 canvas（force 为真时强制重绘，用于缩放） */
  private async renderPage(page: PageState, force = false): Promise<void> {
    if (page.rendered && !force) return
    if (!this.doc) return
    page.rendered = true

    try {
      const proxy: PDFPageProxy = await this.doc.getPage(page.number)
      // 文本块复用缓存，避免每次缩放都重新解析
      await this.ensureBlocks(page)

      await renderPageToCanvas(proxy, page.canvas, this.scale)
      page.canvas.hidden = false
      page.container.querySelector('.page-placeholder')?.remove()
      page.container.style.width = `${page.canvas.width}px`
      page.container.style.height = `${page.canvas.height}px`
      this.paintOverlay(page)
    } catch {
      page.rendered = false
    }
  }

  /** 把译文按原坐标画到对照层 */
  private paintOverlay(page: PageState): void {
    page.overlay.innerHTML = ''
    if (!page.texts || !page.blocks) return

    for (const block of page.blocks) {
      const translated = page.texts.get(block.index)
      if (!translated) continue

      const layout: PdfBlockLayout = layoutPdfBlock(
        block,
        page.width,
        page.height,
        this.scale,
        this.mode,
      )

      const el = document.createElement('div')
      el.className = 'pdf-target'
      if (this.mode === 'translation-only') el.classList.add('pdf-target-only')
      el.textContent = translated
      el.style.left = `${layout.left}px`
      el.style.top = `${layout.top}px`
      el.style.width = `${layout.width}px`
      el.style.minHeight = `${layout.minHeight}px`
      page.overlay.appendChild(el)
    }
  }
}
