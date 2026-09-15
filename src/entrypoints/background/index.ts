import { loadConfig, onConfigChange } from '@/shared/config'
import { translateItems } from '@/core/translate/translator'
import { clearCache, getCacheStats } from '@/core/translate/cache'
import { listProviders } from '@/core/engine/registry'
import { VENDOR_PRESETS } from '@/core/engine/vendors'
import { maybeCloseOffscreen, requestOcr, warmupOcr } from '@/core/offscreen/manager'
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
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse)
    // 返回 true 表示异步响应
    return true
  })

  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenus()
  })

  // 点击 PDF 链接时，引导到扩展内置的 PDF 翻译查看器
  if (chrome.webNavigation) {
    // webNavigation 是可选权限，未授权时静默跳过
  }

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab?.id) return
    // PDF 场景：在当前标签打开翻译查看器
    if (info.menuItemId === 'bilens-translate-pdf') {
      const target = info.linkUrl || tab.url
      if (target) {
        chrome.tabs.create({
          url: chrome.runtime.getURL(`/pdf.html?file=${encodeURIComponent(target)}`),
        })
      }
      return
    }
    const map: Record<string, string> = {
      'bilens-translate-page': 'toggle-translate-page',
      'bilens-translation-only': 'toggle-translation-only',
      'bilens-translate-input': 'translate-input-box',
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
      }
      const type = map[command]
      if (!type) return
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type }).catch(() => {})
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

async function handleMessage(message: unknown): Promise<unknown> {
  const msg = message as { type?: string }
  switch (msg.type) {
    case 'translate':
      return handleTranslate(message as TranslateMessage)
    case 'get-config':
      return loadConfig()
    case 'get-providers':
      return { providers: listProviders(), vendors: VENDOR_PRESETS }
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
      targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*'],
    })
  })
}
