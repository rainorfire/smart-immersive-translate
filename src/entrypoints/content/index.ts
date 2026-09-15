import { loadConfig, onConfigChange } from '@/shared/config'
import { collectTextNodes, type CollectedNode } from '@/core/dom/walker'
import { renderError, renderLoading, renderTranslation, revertAll } from '@/core/render/renderer'
import type { TranslateOutcome } from '@/core/translate/translator'
import type { UserConfig } from '@/shared/types'

/**
 * 内容脚本主体。
 *
 * 职责：抽取文本 → 请求 SW 翻译 → 原位渲染双语。
 * 动态内容通过 MutationObserver 增量翻译，带节流以防翻译风暴。
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  async main() {
    let translating = false
    let translated = false
    let observer: MutationObserver | null = null

    const run = async (): Promise<void> => {
      if (translating) return
      translating = true
      try {
        const config = await loadConfig()
        await translatePage(config)
        translated = true
        if (config.translateDynamicContent) startObserver(config)
      } finally {
        translating = false
      }
    }

    const revert = (): void => {
      stopObserver()
      revertAll(document)
      translated = false
    }

    const startObserver = (config: UserConfig): void => {
      if (observer) return
      let timer: number | null = null
      const pending = new Set<Element>()

      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) pending.add(node as Element)
          }
        }
        if (pending.size === 0) return
        // 节流：500ms 内的变更合并成一次翻译
        if (timer !== null) return
        timer = window.setTimeout(() => {
          timer = null
          const roots = [...pending]
          pending.clear()
          void translateRoots(roots, config)
        }, 500)
      })

      observer.observe(document.body, { childList: true, subtree: true })
    }

    const stopObserver = (): void => {
      observer?.disconnect()
      observer = null
    }

    chrome.runtime.onMessage.addListener((message) => {
      const msg = message as { type?: string }
      if (msg.type === 'toggle-translate-page') {
        if (translated) revert()
        else void run()
      } else if (msg.type === 'config-changed') {
        if (translated) {
          revert()
          void run()
        }
      }
    })
  },
})

async function translatePage(config: UserConfig): Promise<void> {
  await translateRoots([document.body], config)
}

async function translateRoots(roots: Element[], config: UserConfig): Promise<void> {
  const collected: CollectedNode[] = []
  for (const root of roots) {
    if (!root.isConnected) continue
    collected.push(...collectTextNodes(root, { excludeTags: config.excludeTags }))
  }
  if (collected.length === 0) return

  for (const target of collected) renderLoading(target)

  const items = collected.map((c) => c.item)
  const outcome = (await chrome.runtime.sendMessage({
    type: 'translate',
    items,
    source: config.sourceLanguage,
    target: config.targetLanguage,
  })) as TranslateOutcome | undefined

  if (!outcome) {
    for (const target of collected) renderError(target, '翻译服务无响应')
    return
  }

  const byId = new Map(collected.map((c) => [c.item.id, c]))
  const renderOptions = { mode: config.mode, position: config.position }

  for (const [id, text] of Object.entries(outcome.translations)) {
    const target = byId.get(id)
    if (target) renderTranslation(target, text, renderOptions)
  }
  for (const [id, reason] of Object.entries(outcome.failed)) {
    const target = byId.get(id)
    if (target) renderError(target, reason)
  }
}
