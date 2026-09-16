/**
 * PDF 页面判定与内置查看器地址。
 *
 * 为什么不能只看后缀：arxiv 这类站点的 PDF 路径是 `/pdf/2609.16097`，
 * 没有 `.pdf` 后缀，但浏览器渲染的就是 PDF 文档。
 *
 * 判定顺序（对齐参考实现的 documentType 判定）：
 * 1. URL 以 `.pdf` 结尾 → 直接认定
 * 2. `data:` 协议的 MIME 是 `application/pdf` → 认定
 * 3. 仍不确定时读 `document.contentType`（PDF 页面上它就是 application/pdf）
 */

/** URL 是否能直接判定为 PDF 文档（不读 document.contentType） */
export function isPdfUrl(href: string | undefined | null): boolean {
  if (!href) return false
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.protocol === 'data:') {
    const head = (url.pathname.split(',')[0] ?? '').toLowerCase().split(';')[0]
    return head === 'application/pdf'
  }
  return url.pathname.toLowerCase().endsWith('.pdf')
}

/** 扩展内置 PDF 查看器的打开地址（带 file 参数） */
export function pdfViewerUrl(target: string): string {
  return chrome.runtime.getURL(`/pdf.html?file=${encodeURIComponent(target)}`)
}

/**
 * 判定标签页是不是 PDF 文档，覆盖无 `.pdf` 后缀的情况。
 *
 * 回退靠 `document.contentType`：PDF 页面没有可读的 DOM 文本
 * （由 Chrome 内置查看器渲染），contentType 是唯一可靠信号。
 * 注入失败（受限页面/未授权）时返回 false，绝不抛错打断调用方。
 */
export async function detectTabIsPdf(tabId: number, tabUrl?: string): Promise<boolean> {
  if (isPdfUrl(tabUrl)) return true
  if (!chrome.scripting) return false
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.contentType,
    })
    return results?.[0]?.result === 'application/pdf'
  } catch {
    return false
  }
}

/** 当前活动标签页若是 PDF，返回它的 URL，否则 null */
export async function detectActiveTabPdf(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) return null
  return (await detectTabIsPdf(tab.id, tab.url)) ? tab.url : null
}
