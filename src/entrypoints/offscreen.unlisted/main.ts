import { createWorker } from 'tesseract.js'

/**
 * 离屏文档（Offscreen Document）。
 *
 * 存在意义：MV3 的 Service Worker 不能长时间阻塞，
 * 而 OCR 是重计算任务，必须放到离屏文档执行。
 *
 * 消息协议：
 * - { type: 'ocr', id, imageUrl, lang } → { id, text, error? }
 * - { type: 'ocr-warmup', lang }        → { ok }
 */

let worker: Awaited<ReturnType<typeof createWorker>> | null = null
let workerLang = ''
let queue: Promise<unknown> = Promise.resolve()

// 离屏文档是 unlisted page，入口直接执行，无需 defineUnlistedScript
function bootstrap(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as { type?: string; id?: string; imageUrl?: string; lang?: string }
    if (msg.type === 'ocr') {
      // OCR 串行化：tesseract worker 不支持并发调用
      queue = queue.then(async () => {
        try {
          const text = await runOcr(msg.imageUrl ?? '', msg.lang ?? 'eng')
          sendResponse({ id: msg.id, text })
        } catch (e) {
          sendResponse({ id: msg.id, error: e instanceof Error ? e.message : String(e) })
        }
      })
      return true
    }
    if (msg.type === 'ocr-warmup') {
      void ensureWorker(msg.lang ?? 'eng').catch(() => {})
      sendResponse({ ok: true })
      return false
    }
    if (msg.type === 'ocr-dispose') {
      void disposeWorker()
      sendResponse({ ok: true })
      return false
    }
    return false
  })
}

bootstrap()

async function runOcr(imageUrl: string, lang: string): Promise<string> {
  if (!imageUrl) throw new Error('缺少图片数据')
  const w = await ensureWorker(lang)
  const result = await w.recognize(imageUrl)
  return result.data.text ?? ''
}

async function ensureWorker(lang: string) {
  if (worker && workerLang === lang) return worker
  if (worker) await disposeWorker()

  worker = await createWorker(lang, 1, {
    // 语言包从扩展内本地加载，避免依赖外部 CDN
    workerPath: chrome.runtime.getURL('/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('/tesseract/'),
    langPath: chrome.runtime.getURL('/tesseract/lang-data'),
    // 关闭日志噪音
    logger: () => {},
  })
  workerLang = lang
  return worker
}

async function disposeWorker(): Promise<void> {
  if (!worker) return
  try {
    await worker.terminate()
  } catch {
    // 忽略终止异常
  }
  worker = null
  workerLang = ''
}
