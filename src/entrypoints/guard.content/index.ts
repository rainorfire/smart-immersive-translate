import { checkPageAllowed } from '@/core/dom/guard'

/**
 * 注入门禁（document_start，全 frame）。
 *
 * 职责：判定当前页面/iframe 是否值得翻译，通过后才动态加载主体。
 * 好处：主体代码不进无关页面，省内存、避免污染。
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: true,
  main() {
    // 子 frame：先向父 frame 探询可见性，父 frame 不响应则超时兜底放行
    if (window !== window.top) {
      let settled = false
      const token = Math.random().toString(36).slice(2)

      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; token?: string; visible?: boolean } | null
        if (data?.type !== 'bilens:frame-visibility' || data.token !== token) return
        settled = true
        window.removeEventListener('message', onMessage)
        if (data.visible) loadMain('iframe-visible')
      }

      window.addEventListener('message', onMessage, { capture: true })

      // 2s 超时兜底：父 frame 无法判定时按可见处理，避免漏翻
      window.setTimeout(() => {
        if (settled) return
        window.removeEventListener('message', onMessage)
        loadMain('iframe-timeout-fallback')
      }, 2000)

      try {
        window.parent.postMessage({ type: 'bilens:check-visibility', token }, '*')
      } catch {
        loadMain('postmessage-failed')
      }
      return
    }

    // 顶层 frame：直接判定
    const result = checkPageAllowed(location.href)
    if (result.allowed) loadMain('top-frame')
  },
})

let loaded = false

async function loadMain(reason: string): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const url = chrome.runtime.getURL('/main.js')
    const mod = (await import(/* @vite-ignore */ url)) as { runContentMain?: () => void }
    mod.runContentMain?.()
  } catch (e) {
    console.warn('[BiLens] 主体加载失败', reason, e)
  }
}
