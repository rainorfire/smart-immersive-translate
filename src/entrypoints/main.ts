import { loadConfig } from '@/shared/config'
import { collectTextBlocks } from '@/core/dom/walker'
import {
  hasRendered,
  renderError,
  renderLoading,
  renderTranslation,
  revertAll,
  setTranslationOnly,
  pruneDetached,
  targetOf,
} from '@/core/render/renderer'
import { shouldTranslateFrame } from '@/core/dom/guard'
import { collectRuleRoots, matchSiteRule } from '@/rules/sites/matcher'
import { InputTranslator } from '@/features/input/input-translate'
import { HoverTranslator } from '@/features/hover/hover-translate'
import { SelectionTranslator } from '@/features/selection/selection-translate'
import { mountFileDropZone } from '@/features/file/file-translate-ui'
import { ImageTranslator } from '@/features/image/image-translate'
import { VideoSubtitleController } from '@/features/video/video-subtitle'
import { SpeechSubtitleController } from '@/features/video/speech-subtitle'
import { SubtitleOverlay } from '@/features/video/renderer'
import type { TranslateOutcome } from '@/core/translate/translator'
import type { UserConfig, TranslatableItem } from '@/shared/types'
import type { RenderTarget } from '@/core/render/renderer'

/**
 * 内容主体。
 *
 * 注意：这不是内容脚本，而是由门禁 `guard.content.ts` 动态 import 的普通脚本。
 * 只有这样主体代码才不会进入无关页面——这是省内存的核心设计。
 *
 * 职责：抽取文本 → 请求 SW 翻译 → 原位渲染双语。
 */

export default defineUnlistedScript(() => {
  runContentMain()
})

export function runContentMain(): void {
  let translating = false
  let translated = false
  let observer: MutationObserver | null = null
  let currentConfig: UserConfig | null = null
  const detachers: Array<() => void> = []
  const inputTranslator = new InputTranslator()
  const hoverTranslator = new HoverTranslator()
  const selectionTranslator = new SelectionTranslator()
  const imageTranslator = new ImageTranslator()
  const videoController = new VideoSubtitleController()
  // AI 字幕（语音识别）：视频没有字幕轨时的兜底能力。
  // 与 videoController 共用一套覆盖层组件，但音频链路完全独立。
  const speechOverlay = new SubtitleOverlay({
    source: 'auto',
    target: 'zh-CN',
    bilingual: true,
    fontSize: 26,
  })
  const speechController = new SpeechSubtitleController(
    { source: 'auto', target: 'zh-CN', bilingual: true },
    speechOverlay,
  )

  const run = async (): Promise<void> => {
    if (translating) return
    translating = true
    try {
      const config = await loadConfig()
      currentConfig = config
      injectStyles()
      await translatePage(config)
      translated = true
      if (config.translateDynamicContent) startObserver(config)
      setupFeatures(config)
    } finally {
      translating = false
    }
  }

  /** 按配置挂载各交互功能，重复调用不会重复挂载 */
  function setupFeatures(config: UserConfig): void {
    if (detachers.length > 0) {
      inputTranslator.update({
        source: config.sourceLanguage,
        target: config.targetLanguage,
      })
      hoverTranslator.update({
        source: config.sourceLanguage,
        target: config.targetLanguage,
      })
      hoverTranslator.setTheme(config.theme)
      selectionTranslator.update({
        source: config.sourceLanguage,
        target: config.targetLanguage,
      })
      imageTranslator.update({
        source: config.sourceLanguage,
        target: config.targetLanguage,
        ocrLang: config.ocrLanguage,
      })
      videoController.update({
        source: config.sourceLanguage,
        target: config.targetLanguage,
        bilingual: config.videoSubtitleBilingual,
        fontSize: config.videoSubtitleFontSize,
      })
      syncSpeech(config)
      return
    }

    inputTranslator.update({ source: config.sourceLanguage, target: config.targetLanguage })
    hoverTranslator.update({ source: config.sourceLanguage, target: config.targetLanguage })
    hoverTranslator.setTheme(config.theme)
    selectionTranslator.update({ source: config.sourceLanguage, target: config.targetLanguage })
    imageTranslator.update({
      source: config.sourceLanguage,
      target: config.targetLanguage,
      ocrLang: config.ocrLanguage,
    })
    videoController.update({
      source: config.sourceLanguage,
      target: config.targetLanguage,
      bilingual: config.videoSubtitleBilingual,
      fontSize: config.videoSubtitleFontSize,
    })

    syncSpeech(config)
    if (config.enableInputTranslate) detachers.push(inputTranslator.attach())
    if (config.enableHoverTranslate) detachers.push(hoverTranslator.attach())
    if (config.enableSelectionTranslate) detachers.push(selectionTranslator.attach())
    // 文件翻译（EPUB / 字幕 / 文本）：拖入即翻译
    detachers.push(
      mountFileDropZone({
        source: config.sourceLanguage,
        target: config.targetLanguage,
        bilingual: true,
      }),
    )
    // 图片翻译：Alt + 点击图片
    detachers.push(imageTranslator.attach())
    // 视频双语字幕：页面有 video 时自动接入
    if (config.enableVideoSubtitle) maybeAttachVideoSubtitle()
  }

  /** 让 AI 字幕控制器跟随最新配置（语音配置与文本配置各自独立） */
  function syncSpeech(config: UserConfig): void {
    speechController.update({
      source: config.sourceLanguage,
      target: config.targetLanguage,
      bilingual: config.videoSubtitleBilingual,
      onError: (message) => setBanner(`AI 字幕：${message}`, true),
      onState: (state) => {
        if (state.message) setBanner(`AI 字幕：${state.message}`, false)
      },
    })
    speechOverlay.update({
      bilingual: config.videoSubtitleBilingual,
      fontSize: config.videoSubtitleFontSize,
    })
  }

  /** 页面右下角的轻量状态条（AI 字幕的进度与错误提示） */
  let banner: HTMLElement | null = null
  let bannerTimer: number | null = null
  function setBanner(text: string, isError: boolean): void {
    if (!banner) {
      banner = document.createElement('div')
      banner.className = 'bilens-video-banner'
      document.documentElement.appendChild(banner)
    }
    banner.textContent = text
    banner.toggleAttribute('data-error', isError)
    if (bannerTimer !== null) window.clearTimeout(bannerTimer)
    bannerTimer = window.setTimeout(() => {
      banner?.remove()
      banner = null
      bannerTimer = null
    }, isError ? 6000 : 3000)
  }

  /** 切换 AI 字幕（语音识别）开关 */
  async function toggleSpeechSubtitle(): Promise<void> {
    if (speechController.isActive) {
      speechController.stop()
      setBanner('AI 字幕已停止', false)
      return
    }
    const state = await speechController.start()
    setBanner(`AI 字幕：${state.message}`, !state.active)
    // 无字幕轨时的自动降级：AI 字幕起来后不再跑『翻译已有字幕轨』
    if (state.active && videoController.isActive) videoController.stop()
  }

  const revert = (): void => {
    stopObserver()
    revertAll(document)
    videoController.stop()
    speechController.stop()
    banner?.remove()
    banner = null
    translated = false
  }

  /**
   * 视频字幕：页面有 <video> 时才挂载。
   * 首次可能还没加载出播放器（SPA 异步渲染），用短期轮询兜底。
   */
  function maybeAttachVideoSubtitle(attempt = 0): void {
    if (!currentConfig?.enableVideoSubtitle) return
    const video = document.querySelector('video')
    if (video) {
      void videoController.start(document).then((state) => {
        if (!state.active && attempt < 5) {
          window.setTimeout(() => maybeAttachVideoSubtitle(attempt + 1), 2000)
        }
      })
      return
    }
    if (attempt < 10) {
      window.setTimeout(() => maybeAttachVideoSubtitle(attempt + 1), 1500)
    }
  }

  const startObserver = (config: UserConfig): void => {
    if (observer) return
    if (!document.body) return
    let timer: number | null = null
    const pending = new Set<Element>()

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) pending.add(node as Element)
        }
      }
      if (pending.size === 0 || timer !== null) return
      // 节流：500ms 内的变更合并成一次翻译，防翻译风暴
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
    } else if (msg.type === 'toggle-translation-only') {
      void toggleMode()
    } else if (msg.type === 'translate-input-box') {
      void inputTranslator.translateFocused()
    } else if (msg.type === 'translate-images') {
      void imageTranslator.translateAll()
    } else if (msg.type === 'toggle-video-subtitle') {
      void toggleVideoSubtitle()
    } else if (msg.type === 'translate-video-subtitles-all') {
      void videoController.translateAll()
    } else if (msg.type === 'toggle-speech-subtitle') {
      void toggleSpeechSubtitle()
    } else if (msg.type === 'speech-chunk') {
      // 离屏文档回推的音频片段 → 送 ASR
      speechController.pushChunk(
        (message as { chunk: { data: ArrayBuffer; mimeType: string; startedAt: number; duration: number } }).chunk,
      )
    } else if (msg.type === 'config-changed') {
      if (translated) {
        revert()
        void run()
      }
    }
  })

  /** 切换双语/仅译文模式，不重新请求翻译 */
  async function toggleMode(): Promise<void> {
    if (!currentConfig) return
    const next = currentConfig.mode === 'dual' ? 'translation-only' : 'dual'
    currentConfig.mode = next
    // 真正隐藏/恢复原文。旧实现只设了个属性，而 CSS 里没有对应规则，等于空转。
    setTranslationOnly(next === 'translation-only')
  }

  /** 视频字幕开关 */
  async function toggleVideoSubtitle(): Promise<void> {
    if (videoController.isActive) {
      videoController.stop()
      return
    }
    await videoController.start(document)
  }

  // ---- iframe 可见性协商：回应子 frame 的探询 ----
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; token?: string } | null
    if (data?.type !== 'bilens:check-visibility' || !data.token) return
    if (!event.source) return
    const frame = findFrame(event.source as Window)
    const visible = frame ? shouldTranslateFrame(frame) : true
    ;(event.source as Window).postMessage(
      { type: 'bilens:frame-visibility', token: data.token, visible },
      '*',
    )
  })
}

/** 按站点规则确定翻译范围，无规则则全文兜底 */
async function translatePage(config: UserConfig): Promise<void> {
  if (!config.enableSiteRules) {
    await translateRoots([document.body], config)
    return
  }

  const matched = matchSiteRule(location.href)
  if (!matched) {
    await translateRoots([document.body], config)
    return
  }

  const roots = collectRuleRoots(matched.rule)
  if (roots.length === 0) {
    // 规则命中了站点但选择器没匹配到（改版等），走兜底
    if (!matched.rule.noFallback) await translateRoots([document.body], config)
    return
  }

  await translateRoots(roots, config)
}

function findFrame(source: Window): HTMLIFrameElement | null {
  for (const frame of document.querySelectorAll('iframe')) {
    if (frame.contentWindow === source) return frame
  }
  return null
}

let stylesInjected = false

/** 注入样式（走 web_accessible_resources 的 CSS 文件） */
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = chrome.runtime.getURL('/inject.css')
  document.documentElement.appendChild(link)
}

export async function translateRoots(roots: Element[], config: UserConfig): Promise<void> {
  const targets: RenderTarget[] = []
  const items: TranslatableItem[] = []
  // 顺带回收已脱离 DOM 的陈旧登记，避免无限滚动页面内存只增不减
  pruneDetached()
  // 同一段落可能被多个规则根重复覆盖；且每个 root 的抽取计数都从 n1 重新开始，
  // 直接拼接会导致 id 大面积重复（维基百科实测 3306 个节点仅 35 个唯一 id），
  // 下游 byId 映射会互相覆盖，绝大多数节点永远停在加载态。
  //
  // 这里以「段首节点」为唯一键：既去重，又给每段一个稳定 id。
  const seen = new Map<Text, RenderTarget>()
  for (const root of roots) {
    if (!root.isConnected) continue
    if (root.closest?.('.bilens-target-wrapper')) continue
    for (const block of collectTextBlocks(root, { excludeTags: config.excludeTags })) {
      const target = targetOf(block)
      const key = block.nodes[0]
      if (!key) continue
      if (seen.has(key)) continue
      // 已翻译过的段落不再重复请求（增量翻译反复触发时尤其重要）
      if (hasRendered(target)) continue
      seen.set(key, target)
      block.item.id = `n${seen.size}`
      targets.push(target)
      items.push(block.item)
    }
  }
  if (targets.length === 0) return

  for (const target of targets) renderLoading(target)

  let outcome: TranslateOutcome | undefined
  try {
    outcome = (await chrome.runtime.sendMessage({
      type: 'translate',
      items,
      source: config.sourceLanguage,
      target: config.targetLanguage,
    })) as TranslateOutcome | undefined
  } catch {
    outcome = undefined
  }

  if (!outcome) {
    for (const target of targets) renderError(target, '翻译服务无响应')
    return
  }

  const byId = new Map(items.map((item, i) => [item.id, targets[i] as RenderTarget]))
  const renderOptions = { mode: config.mode, position: config.position, theme: config.theme }

  for (const [id, text] of Object.entries(outcome.translations)) {
    const target = byId.get(id)
    if (target) renderTranslation(target, text, renderOptions)
  }
  for (const [id, reason] of Object.entries(outcome.failed)) {
    const target = byId.get(id)
    if (target) renderError(target, reason)
  }
}
