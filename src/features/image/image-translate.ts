import type { TranslateOutcome } from '@/core/translate/translator'

/**
 * 图片翻译（漫画 / 海报 / 截图）。
 *
 * 流程：图片 → base64 → 离屏文档 OCR → 翻译 → 覆盖层渲染译文。
 *
 * 关键设计：
 * - 覆盖层用绝对定位贴合原图，不修改原图本身（可随时还原）
 * - OCR 在离屏文档执行，不阻塞页面
 * - 同一图片只处理一次，用 WeakSet 去重
 */

export interface ImageTranslateOptions {
  source: string
  target: string
  /** OCR 语言，默认 eng */
  ocrLang: string
  /** 悬停时显示译文（否则常驻显示） */
  hoverOnly: boolean
}

const DEFAULTS: ImageTranslateOptions = {
  source: 'auto',
  target: 'zh-CN',
  ocrLang: 'eng',
  hoverOnly: false,
}

const processed = new WeakSet<HTMLImageElement>()
const OVERLAY_ATTR = 'data-bilens-image-overlay'

export class ImageTranslator {
  private options: ImageTranslateOptions

  constructor(options: Partial<ImageTranslateOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  update(options: Partial<ImageTranslateOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /** 翻译单张图片 */
  async translate(img: HTMLImageElement): Promise<void> {
    if (processed.has(img)) return
    processed.add(img)

    try {
      const dataUrl = await imageToDataUrl(img)
      if (!dataUrl) return

      const ocr = (await chrome.runtime.sendMessage({
        type: 'ocr',
        imageUrl: dataUrl,
        lang: this.options.ocrLang,
      })) as { text?: string; error?: string } | undefined

      const raw = ocr?.text?.trim()
      if (!raw) return

      // OCR 结果按行切分，去掉空行与噪音
      const lines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 1)
      if (lines.length === 0) return

      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items: lines.map((text, i) => ({ id: String(i), text })),
        source: this.options.source,
        target: this.options.target,
      })) as TranslateOutcome | undefined

      if (!outcome) return
      const translated = lines
        .map((original, i) => outcome.translations[String(i)] ?? original)
        .join('\n')

      renderOverlay(img, translated, this.options.hoverOnly)
    } catch {
      processed.delete(img)
    }
  }

  /** 批量翻译页面上所有符合条件的图片 */
  async translateAll(root: ParentNode = document): Promise<number> {
    const images = [...root.querySelectorAll('img')].filter(isTranslatableImage)
    let count = 0
    for (const img of images) {
      await this.translate(img)
      count += 1
    }
    return count
  }

  /** 绑定右键菜单入口：翻译鼠标下的图片 */
  attach(): () => void {
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return
      const el = e.target
      if (el instanceof HTMLImageElement && isTranslatableImage(el)) {
        e.preventDefault()
        void this.translate(el)
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }
}

/** 过滤掉图标、小图、表情等不该翻译的图片 */
export function isTranslatableImage(img: HTMLImageElement): boolean {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  // 太小的图标不翻译
  if (w < 200 || h < 80) return false
  // 长条形的多为装饰/分隔线
  const ratio = w / h
  if (ratio > 8 || ratio < 1 / 8) return false
  if (img.classList.contains('bilens-notranslate')) return false
  return true
}

/** 图片转 data URL；跨域图片走 canvas，失败则返回 null */
async function imageToDataUrl(img: HTMLImageElement): Promise<string | null> {
  // 已是 data URL 直接用
  if (img.src.startsWith('data:')) return img.src

  try {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    // 跨域污染 canvas 时退化为直接传 URL
    return img.src
  }
}

/** 在原图上叠一层译文浮层 */
function renderOverlay(img: HTMLImageElement, text: string, hoverOnly: boolean): void {
  const parent = img.parentElement
  if (!parent) return

  // 已有浮层则更新
  let overlay = parent.querySelector<HTMLElement>(`[${OVERLAY_ATTR}]`)
  if (overlay) {
    overlay.textContent = text
    return
  }

  const computed = getComputedStyle(parent)
  if (computed.position === 'static') parent.style.position = 'relative'

  overlay = document.createElement('div')
  overlay.setAttribute(OVERLAY_ATTR, '1')
  overlay.className = 'bilens-image-overlay'
  overlay.textContent = text

  if (hoverOnly) overlay.classList.add('bilens-image-overlay-hover')

  parent.appendChild(overlay)
}

/** 移除所有图片浮层 */
export function revertImageOverlays(root: ParentNode = document): void {
  root.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove())
}
