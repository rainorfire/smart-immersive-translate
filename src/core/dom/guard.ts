/**
 * 注入门禁判定。
 *
 * 设计借鉴自反编译分析：主体代码不进无关页面。
 * 门禁在 document_start 全 frame 执行，判定通过才动态 import 主体。
 */

/** 这些域名一律不注入 */
const BLOCKED_HOSTS = [
  'chrome.google.com',
  'chromewebstore.google.com',
  'microsoftedge.microsoft.com',
  'addons.mozilla.org',
  'accounts.google.com',
  'login.microsoftonline.com',
  'localhost',
  '127.0.0.1',
]

/** 挑战页/验证页特征，注入无意义还可能触发风控 */
const CHALLENGE_HINTS = ['cloudflare', 'challenge-platform', 'cf-challenge']

export interface GuardResult {
  allowed: boolean
  reason?: string
}

export function checkPageAllowed(href: string, html?: string): GuardResult {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { allowed: false, reason: 'invalid-url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
    return { allowed: false, reason: 'unsupported-protocol' }
  }

  if (url.protocol !== 'file:' && BLOCKED_HOSTS.includes(url.hostname)) {
    return { allowed: false, reason: 'blocked-host' }
  }

  if (html) {
    const sample = html.slice(0, 4000).toLowerCase()
    if (CHALLENGE_HINTS.some((h) => sample.includes(h))) {
      return { allowed: false, reason: 'challenge-page' }
    }
  }

  return { allowed: true }
}

/** 元素是否有可见面积 */
export function hasVisibleSize(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 1 && rect.height > 1
}

/**
 * 判断嵌入的 iframe 是否值得翻译。
 * 隐藏 iframe（广告位、埋点、tracking）跳过，避免白干活。
 */
export function shouldTranslateFrame(el: HTMLIFrameElement): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1) return false

  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return true
}
