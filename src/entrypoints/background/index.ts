import { loadConfig, onConfigChange } from '@/shared/config'
import { translateItems } from '@/core/translate/translator'
import { clearCache, getCacheStats } from '@/core/translate/cache'
import { listProviders } from '@/core/engine/registry'
import { VENDOR_PRESETS } from '@/core/engine/vendors'
import {
  maybeCloseOffscreen,
  requestOcr,
  startTabAudioCapture,
  stopTabAudioCapture,
  warmupOcr,
} from '@/core/offscreen/manager'
import { listAsrProviders } from '@/core/asr/registry'
import { detectActiveTabPdf, detectTabIsPdf, pdfViewerUrl } from '@/core/pdf/detect'
import type { EngineConfig, TranslatableItem } from '@/shared/types'

/**
 * Service Worker。
 *
 * MV3 约束：SW 无常驻，所有状态必须外置。因此这里不保存运行时状态，
 * 配置与缓存一律走 chrome.storage。
 */

export interface TranslateMessage {
  type: 'translate'
  items: TranslatableItem[]
  source: string
  target: string
  engine?: EngineConfig
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 音频片段从离屏文档回推：转交给发起捕获的标签页（离屏文档不知道是谁发起的）
    if ((message as { type?: string })?.type === 'audio-chunk') {
      routeAudioChunk(message as AudioChunkMessage)
      sendResponse({ ok: true })
      return false
    }
    handleMessage(message, sender).then(sendResponse)
    // 返回 true 表示异步响应
    return true
  })

  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenus()
  })

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab?.id) return
    // PDF 场景：新标签打开内置翻译查看器
    if (info.menuItemId === 'bilens-translate-pdf') {
      const target = info.linkUrl || tab.url
      if (target) chrome.tabs.create({ url: pdfViewerUrl(target) }).catch(() => {})
      return
    }
    const map: Record<string, string> = {
      'bilens-translate-page': 'toggle-translate-page',
      'bilens-translation-only': 'toggle-translation-only',
      'bilens-translate-input': 'translate-input-box',
      'bilens-video-subtitle': 'toggle-video-subtitle',
      'bilens-speech-subtitle': 'toggle-speech-subtitle',
      'bilens-translate-images': 'translate-images',
    }
    const type = map[String(info.menuItemId)]
    if (type) chrome.tabs.sendMessage(tab.id, { type }).catch(() => {})
  })

  // 快捷键命令 → 转发给当前页面
  if (chrome.commands) {
    chrome.commands.onCommand.addListener(async (command) => {
      const map: Record<string, string> = {
        'toggle-translate-page': 'toggle-translate-page',
        'toggle-translation-only': 'toggle-translation-only',
        'translate-input-box': 'translate-input-box',
        'toggle-video-subtitle': 'toggle-video-subtitle',
        'toggle-speech-subtitle': 'toggle-speech-subtitle',
      }
      const type = map[command]
      if (!type) return
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return
      // PDF 页面没有内容脚本，消息转发是死路；这里改走内置查看器
      // （对齐参考实现：PDF 页面上按翻译键 → translatePdfWithNewTab）
      if (type === 'toggle-translate-page' && (await detectTabIsPdf(tab.id, tab.url))) {
        if (tab.url) chrome.tabs.create({ url: pdfViewerUrl(tab.url) }).catch(() => {})
        return
      }
      chrome.tabs.sendMessage(tab.id, { type }).catch(() => {})
    })
  }

  // 配置变更时通知所有页面刷新译文
  onConfigChange(() => {
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'config-changed' }).catch(() => {})
      }
    })
  })
})

/** 离屏文档回推的音频片段 */
export interface AudioChunkMessage {
  type: 'audio-chunk'
  chunk: { data: ArrayBuffer; mimeType: string; startedAt: number; duration: number }
}

/** 当前正在做语音识别的标签页（音频片段要回推给它） */
let speechTabId: number | null = null

function routeAudioChunk(message: AudioChunkMessage): void {
  if (speechTabId === null) return
  chrome.tabs
    .sendMessage(speechTabId, {
      type: 'speech-chunk',
      chunk: message.chunk,
    })
    .catch(() => {})
}

async function handleMessage(message: unknown, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  const msg = message as { type?: string }
  switch (msg.type) {
    case 'translate':
      return handleTranslate(message as TranslateMessage)
    case 'get-config':
      return loadConfig()
    case 'get-providers':
      return { providers: listProviders(), vendors: VENDOR_PRESETS }
    case 'get-asr-providers':
      return { providers: listAsrProviders().map((p) => ({ id: p.id, name: p.name, mode: p.mode, requiresAuth: p.requiresAuth })) }
    case 'speech-start': {
      // 发起方标签页必须在最前面且正在播放，getMediaStreamId 才有意义
      const tabId = sender?.tab?.id
      if (tabId === undefined) return { ok: false, error: '无法确定当前标签页' }
      const config = await loadConfig()
      speechTabId = tabId
      const result = await startTabAudioCapture(tabId, config.asr.chunkSeconds)
      if (!result.ok) speechTabId = null
      return result
    }
    case 'speech-stop':
      speechTabId = null
      await stopTabAudioCapture()
      return { ok: true }
    case 'open-pdf-viewer': {
      // 内容脚本/弹窗判定到 PDF 后，由 SW 统一开查看器（内容脚本不能建标签页）
      const url = (message as { url?: string }).url ?? sender?.tab?.url
      // 护栏：只接管真实文档地址。扩展自身页面（chrome-extension://）等一律拒绝，
      // 否则会把 popup/设置页当成 PDF 去解析（实测踩过 Invalid PDF structure）。
      if (!url || !/^(https?|file):/i.test(url)) {
        return { ok: false, error: '当前页面不是可翻译的 PDF' }
      }
      await chrome.tabs.create({ url: pdfViewerUrl(url) })
      return { ok: true }
    }
    case 'is-pdf-page':
      // 弹窗用：判定当前页是否 PDF，决定按钮文案
      return { isPdf: Boolean(await detectActiveTabPdf()) }
    case 'cache-stats':
      return getCacheStats()
    case 'clear-cache':
      await clearCache()
      return { ok: true }
    case 'ocr':
      return handleOcr(message as { imageUrl?: string; lang?: string })
    case 'ocr-warmup':
      await warmupOcr((message as { lang?: string }).lang ?? 'eng')
      return { ok: true }
    default:
      return { error: `未知消息类型：${msg.type}` }
  }
}

async function handleOcr(msg: { imageUrl?: string; lang?: string }) {
  if (!msg.imageUrl) return { text: '', error: '缺少图片数据' }
  const result = await requestOcr(msg.imageUrl, msg.lang ?? 'eng')
  // 每次 OCR 后评估是否可回收离屏文档
  setTimeout(() => void maybeCloseOffscreen(), 1000)
  return result
}

async function handleTranslate(msg: TranslateMessage) {
  const config = await loadConfig()
  const engine = msg.engine ?? config.engine
  return translateItems({
    items: msg.items,
    source: msg.source,
    target: msg.target,
    engine,
    useCache: config.enableCache,
  })
}

function setupContextMenus(): void {
  if (!chrome.contextMenus) return
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'bilens-translate-page',
      title: 'BiLens：翻译/还原本页',
      contexts: ['page'],
    })
    chrome.contextMenus.create({
      id: 'bilens-translation-only',
      title: 'BiLens：切换仅译文模式',
      contexts: ['page'],
    })
    chrome.contextMenus.create({
      id: 'bilens-translate-input',
      title: 'BiLens：翻译输入框',
      contexts: ['editable'],
    })
    chrome.contextMenus.create({
      id: 'bilens-translate-pdf',
      title: 'BiLens：用 PDF 翻译打开',
      contexts: ['link', 'page'],
      // 放宽到 *pdf*：arxiv 的 /pdf/2609.16097、openreview 的 /pdf?id= 都没有
      // `.pdf` 后缀，旧规则实测全部漏掉。
      targetUrlPatterns: ['*://*/*pdf*', '*://*/*PDF*'],
    })
    chrome.contextMenus.create({
      id: 'bilens-video-subtitle',
      title: 'BiLens：翻译视频字幕',
      contexts: ['video', 'page'],
    })
    chrome.contextMenus.create({
      id: 'bilens-speech-subtitle',
      title: 'BiLens：AI 字幕（语音识别，Beta）',
      contexts: ['video', 'page'],
    })
    chrome.contextMenus.create({
      id: 'bilens-translate-images',
      title: 'BiLens：翻译本页图片',
      contexts: ['page'],
    })
  })
}
