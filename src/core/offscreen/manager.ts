/**
 * 离屏文档管理器（运行在 Service Worker 中）。
 *
 * MV3 的 SW 不能执行重计算，OCR 必须放到 offscreen document。
 * 这里负责：按需创建、消息转发、闲置回收。
 */

const OFFSCREEN_PATH = 'offscreen.html'
/** 音频捕获也需要离屏文档，且同样是长生命周期任务 */
export const AUDIO_OFFSCREEN_JUSTIFICATION = '捕获标签页音频做语音识别（AI 字幕）'
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

export async function ensureOffscreen(
  reason?: chrome.offscreen.Reason,
  justification?: string,
): Promise<void> {
  if (await hasOffscreen()) return
  if (creating) {
    await creating
    return
  }

  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        // USER_MEDIA 是 getUserMedia（音频捕获）必需的原因声明；
        // OCR 用 DOM_PARSER。同一个离屏文档可同时承载两者。
        reasons: [reason ?? chrome.offscreen.Reason?.DOM_PARSER ?? 'DOM_PARSER'],
        justification: justification ?? '执行图片文字识别（OCR）与文档解析',
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

/**
 * 启动标签页音频捕获。
 *
 * 链路：SW 拿 streamId（只有 SW 能调 tabCapture.setMediaStreamId 系列 API）
 *      → 交给离屏文档取流、切片 → 片段以消息回推。
 *
 * @param tabId 目标标签页
 * @param chunkSeconds 切片时长（秒）
 */
export async function startTabAudioCapture(
  tabId: number,
  chunkSeconds: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureOffscreen('USER_MEDIA' as chrome.offscreen.Reason, AUDIO_OFFSCREEN_JUSTIFICATION)
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
    const result = (await chrome.runtime.sendMessage({
      type: 'audio-start',
      streamId,
      chunkSeconds,
      keepAudible: true,
    })) as { ok: boolean; error?: string } | undefined
    return result ?? { ok: false, error: '离屏文档无响应' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // tabCapture 的平台限制：必须先「调用过扩展」（点扩展图标 / 右键菜单 /
    // 快捷键都会授予 activeTab），否则 Chrome 直接拒绝，报文是
    // "Extension has not been invoked for the current page"。
    // 这里把它翻译成用户能照做的动作，而不是抛英文原文。
    if (message.includes('not been invoked')) {
      return {
        ok: false,
        error: '请先点击浏览器工具栏的 BiLens 图标（或用右键菜单）再启动 AI 字幕——Chrome 要求先调用扩展才允许捕获标签页音频',
      }
    }
    if (message.includes('Cannot capture') || message.includes('Chrome pages')) {
      return { ok: false, error: '当前页面不允许捕获音频（Chrome 内部页/应用商店页不支持）' }
    }
    return { ok: false, error: message }
  }
}

/** 停止标签页音频捕获并关闭离屏文档 */
export async function stopTabAudioCapture(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'audio-stop' })
  } catch {
    // 离屏文档可能已关闭
  }
  await maybeCloseOffscreen(true)
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

/** 闲置超过阈值则关闭离屏文档，释放内存（force 用于停止音频后立即回收） */
export async function maybeCloseOffscreen(force = false): Promise<void> {
  if (!force && lastUsedAt === 0) return
  if (!force && Date.now() - lastUsedAt < IDLE_TIMEOUT) return
  try {
    await chrome.offscreen.closeDocument()
  } catch {
    // 已经关闭则忽略
  }
  lastUsedAt = 0
}
