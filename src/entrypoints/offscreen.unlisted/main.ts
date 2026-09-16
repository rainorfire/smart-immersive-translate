import { createWorker } from 'tesseract.js'
import { AudioSlicer, getTabAudioStream, keepAudioAudible } from '@/core/audio/capture'

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

/**
 * 音频捕获会话状态。
 *
 * 离屏文档是唯一持有 MediaStream 的上下文（SW 里没有 DOM），
 * 因此流的生命周期必须绑在这一层，由顶部 frame 通过消息驱动。
 */
let captureSession: {
  stream: MediaStream
  audioContext: AudioContext
  slicer: AudioSlicer
} | null = null

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
    if (msg.type === 'audio-start') {
      void startAudioCapture(msg as AudioStartMessage)
        .then((r) => sendResponse(r))
        .catch((e: unknown) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        )
      return true
    }
    if (msg.type === 'audio-stop') {
      stopAudioCapture()
      sendResponse({ ok: true })
      return false
    }
    return false
  })
}

interface AudioStartMessage {
  type: 'audio-start'
  /** SW 用 chrome.tabCapture.getMediaStreamId 换来的流 ID */
  streamId: string
  /** 切片时长（秒） */
  chunkSeconds: number
  /** 是否把标签页音频接回扬声器（不接用户就听不到视频原声） */
  keepAudible: boolean
}

/**
 * 启动标签页音频捕获。
 *
 * 返回 `{ ok, chunks }`；音频切片通过 `audio-chunk` 消息持续回推给 SW，
 * 由 SW 转给发起翻译的标签页（离屏文档本身不知道是哪个标签页发起的）。
 */
async function startAudioCapture(
  msg: AudioStartMessage,
): Promise<{ ok: boolean; error?: string }> {
  stopAudioCapture()
  try {
    const stream = await getTabAudioStream(msg.streamId)
    const audioContext = new AudioContext()
    if (msg.keepAudible) keepAudioAudible(stream, audioContext)

    const slicer = new AudioSlicer({
      chunkSeconds: Math.max(1, msg.chunkSeconds || 6),
      onChunk: ({ blob, startedAt, duration }) => {
        void blobToChunk(blob, startedAt, duration).then((chunk) => {
          chrome.runtime.sendMessage({ type: 'audio-chunk', chunk }).catch(() => {})
        })
      },
    })
    slicer.start(stream)
    captureSession = { stream, audioContext, slicer }
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `音频捕获失败：${message}` }
  }
}

function stopAudioCapture(): void {
  if (!captureSession) return
  captureSession.slicer.stop()
  for (const track of captureSession.stream.getTracks()) track.stop()
  void captureSession.audioContext.close().catch(() => {})
  captureSession = null
}

/** Blob → 可通过消息传递的音频片段（ArrayBuffer 可结构化克隆） */
async function blobToChunk(
  blob: Blob,
  startedAt: number,
  duration: number,
): Promise<{ data: ArrayBuffer; mimeType: string; startedAt: number; duration: number }> {
  const data = await blob.arrayBuffer()
  return { data, mimeType: blob.type || 'audio/webm', startedAt, duration }
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
