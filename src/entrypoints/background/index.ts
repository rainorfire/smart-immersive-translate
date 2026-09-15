import { loadConfig, onConfigChange } from '@/shared/config'
import { translateItems } from '@/core/translate/translator'
import { clearCache, getCacheStats } from '@/core/translate/cache'
import { listProviders } from '@/core/engine/registry'
import { VENDOR_PRESETS } from '@/core/engine/vendors'
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

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'bilens-translate-page' || !tab?.id) return
    chrome.tabs.sendMessage(tab.id, { type: 'toggle-translate-page' }).catch(() => {})
  })

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
    default:
      return { error: `未知消息类型：${msg.type}` }
  }
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
  })
}
