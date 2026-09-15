/**
 * 离屏文档管理器（运行在 Service Worker 中）。
 *
 * MV3 的 SW 不能执行重计算，OCR 必须放到 offscreen document。
 * 这里负责：按需创建、消息转发、闲置回收。
 */

const OFFSCREEN_PATH = 'offscreen.html'
let creating: Promise<void> | null = null
let lastUsedAt = 0
const IDLE_TIMEOUT = 60_000

async function hasOffscreen(): Promise<boolean> {
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    })
    return contexts.length > 0
  }
  // 回退方案：通过 service worker 的 clients 判断
  const globalScope = self as unknown as {
    clients: { matchAll: () => Promise<Array<{ url: string }>> }
  }
  const clients = await globalScope.clients.matchAll()
  return clients.some((c) => c.url.includes(OFFSCREEN_PATH))
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return
  if (creating) {
    await creating
    return
  }

  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason?.DOM_PARSER ?? 'DOM_PARSER'],
        justification: '执行图片文字识别（OCR）与文档解析',
      })
    } catch (e) {
      // 已存在时会抛错，视为成功
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('Only a single offscreen')) throw e
    } finally {
      creating = null
    }
  })()

  await creating
}

export interface OcrResult {
  text: string
  error?: string
}

/** 请求 OCR：转发到离屏文档并等待结果 */
export async function requestOcr(imageUrl: string, lang: string): Promise<OcrResult> {
  await ensureOffscreen()
  lastUsedAt = Date.now()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return new Promise<OcrResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ text: '', error: 'OCR 超时' })
    }, 60_000)

    chrome.runtime
      .sendMessage({ type: 'ocr', id, imageUrl, lang })
      .then((res: unknown) => {
        clearTimeout(timeout)
        const r = res as { text?: string; error?: string } | undefined
        resolve({ text: r?.text ?? '', error: r?.error })
      })
      .catch((e: unknown) => {
        clearTimeout(timeout)
        resolve({ text: '', error: e instanceof Error ? e.message : String(e) })
      })
  })
}

/** 预热：提前加载 OCR 引擎，首次识别更快 */
export async function warmupOcr(lang: string): Promise<void> {
  try {
    await ensureOffscreen()
    await chrome.runtime.sendMessage({ type: 'ocr-warmup', lang })
  } catch {
    // 预热失败不影响主流程
  }
}

/** 闲置超过阈值则关闭离屏文档，释放内存 */
export async function maybeCloseOffscreen(): Promise<void> {
  if (lastUsedAt === 0) return
  if (Date.now() - lastUsedAt < IDLE_TIMEOUT) return
  try {
    await chrome.offscreen.closeDocument()
  } catch {
    // 已经关闭则忽略
  }
  lastUsedAt = 0
}
