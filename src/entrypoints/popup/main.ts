import { loadConfig, saveConfig } from '@/shared/config'
import { TARGET_LANGUAGES } from '@/shared/languages'
import type { VendorPreset } from '@/core/engine/vendors'
import type { TranslateProvider } from '@/core/engine/provider'
import type { TranslationMode } from '@/shared/types'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`缺少元素 #${id}`)
  return el as T
}

const engineSelect = $<HTMLSelectElement>('engine')
const vendorRow = $<HTMLDivElement>('vendor-row')
const vendorSelect = $<HTMLSelectElement>('vendor')
const modelInput = $<HTMLInputElement>('model')
const apiKeyInput = $<HTMLInputElement>('apiKey')
const targetSelect = $<HTMLSelectElement>('target')
const modeSelect = $<HTMLSelectElement>('mode')
const statusEl = $<HTMLSpanElement>('status')
const cacheInfo = $<HTMLSpanElement>('cache-info')
const quickVideo = $<HTMLInputElement>('quick-video')
const quickImage = $<HTMLInputElement>('quick-image')
const quickHover = $<HTMLInputElement>('quick-hover')
const quickSelection = $<HTMLInputElement>('quick-selection')

let vendors: VendorPreset[] = []

/** 当前标签页是否是 PDF（决定主按钮文案与行为） */
let isPdf = false

async function init(): Promise<void> {
  const config = await loadConfig()
  const meta = (await chrome.runtime.sendMessage({ type: 'get-providers' })) as {
    providers: TranslateProvider[]
    vendors: VendorPreset[]
  }

  vendors = meta.vendors
  engineSelect.innerHTML = meta.providers
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')
  vendorSelect.innerHTML = vendors
    .map((v) => `<option value="${v.id}">${v.name}</option>`)
    .join('')
  targetSelect.innerHTML = TARGET_LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`,
  ).join('')

  engineSelect.value = config.engine.provider
  vendorSelect.value = config.engine.vendor ?? 'deepseek'
  modelInput.value = config.engine.model ?? ''
  apiKeyInput.value = config.engine.apiKey ?? ''
  targetSelect.value = config.targetLanguage
  modeSelect.value = config.mode
  quickVideo.checked = config.enableVideoSubtitle
  quickImage.checked = config.enableImageTranslate
  quickHover.checked = config.enableHoverTranslate
  quickSelection.checked = config.enableSelectionTranslate

  syncVendorRow()

  // 判定当前页是否 PDF：是则把主按钮换成「点击翻译 PDF」
  const pdfState = (await chrome.runtime
    .sendMessage({ type: 'is-pdf-page' })
    .catch(() => null)) as { isPdf?: boolean } | null
  isPdf = Boolean(pdfState?.isPdf)
  if (isPdf) $('translate').textContent = '点击翻译 PDF'

  const stats = (await chrome.runtime.sendMessage({ type: 'cache-stats' })) as {
    entries: number
  }
  cacheInfo.textContent = `缓存 ${stats.entries} 条`
}

function syncVendorRow(): void {
  vendorRow.hidden = engineSelect.value !== 'openai-compatible'
  const preset = vendors.find((v) => v.id === vendorSelect.value)
  if (preset) {
    modelInput.placeholder = preset.model || '模型名'
    if (!modelInput.value) modelInput.value = preset.model
  }
}

engineSelect.addEventListener('change', syncVendorRow)
vendorSelect.addEventListener('change', () => {
  modelInput.value = ''
  syncVendorRow()
})

$('save').addEventListener('click', async () => {
  const config = await loadConfig()
  config.engine.provider = engineSelect.value
  if (engineSelect.value === 'openai-compatible') {
    config.engine.vendor = vendorSelect.value
    config.engine.model = modelInput.value.trim()
    config.engine.apiKey = apiKeyInput.value.trim()
    const preset = vendors.find((v) => v.id === vendorSelect.value)
    if (preset) config.engine.baseUrl = preset.baseUrl
  }
  config.targetLanguage = targetSelect.value
  config.mode = modeSelect.value as TranslationMode
  await saveConfig(config)
  setStatus('已保存')
})

$('translate').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  // PDF 页面：内容脚本不在（PDF 无 DOM 文本），交由内置查看器翻译，
  // 按钮文案也随之为「点击翻译 PDF」（对齐参考实现的按钮切换）
  if (isPdf) {
    // 必须显式带 URL：真实 popup 里 sender.tab 为空，SW 无法推断目标
    const res = (await chrome.runtime.sendMessage({ type: 'open-pdf-viewer', url: tab.url })) as
      | { ok?: boolean; error?: string }
      | undefined
    setStatus(res?.ok ? '已打开 PDF 翻译' : (res?.error ?? '无法打开 PDF 翻译'))
    return
  }
  await chrome.tabs.sendMessage(tab.id, { type: 'toggle-translate-page' }).catch(() => {
    setStatus('当前页面不可翻译')
  })
})

$('translate-images').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  await chrome.tabs.sendMessage(tab.id, { type: 'translate-images' }).catch(() => {
    setStatus('当前页面不可翻译')
  })
  setStatus('正在翻译图片…')
})

$('translate-video').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  await chrome.tabs.sendMessage(tab.id, { type: 'toggle-video-subtitle' }).catch(() => {
    setStatus('当前页面不可翻译')
  })
  setStatus('视频字幕已切换')
})

$('speech-subtitle').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  await chrome.tabs.sendMessage(tab.id, { type: 'toggle-speech-subtitle' }).catch(() => {
    setStatus('当前页面不可用')
    return
  })
  setStatus('AI 字幕已切换')
})

/** 快捷开关：改动即保存，无需点保存按钮 */
for (const box of [quickVideo, quickImage, quickHover, quickSelection]) {
  box.addEventListener('change', async () => {
    const config = await loadConfig()
    config.enableVideoSubtitle = quickVideo.checked
    config.enableImageTranslate = quickImage.checked
    config.enableHoverTranslate = quickHover.checked
    config.enableSelectionTranslate = quickSelection.checked
    await saveConfig(config)
    setStatus('已更新')
  })
}

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage())

function setStatus(text: string): void {
  statusEl.textContent = text
  window.setTimeout(() => {
    statusEl.textContent = '就绪'
  }, 1500)
}

void init()
