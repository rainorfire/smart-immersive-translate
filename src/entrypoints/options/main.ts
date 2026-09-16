import { loadConfig, saveConfig } from '@/shared/config'
import { TARGET_LANGUAGES } from '@/shared/languages'
import { THEMES } from '@/core/render/renderer'
import type { VendorPreset } from '@/core/engine/vendors'
import type { TranslateProvider } from '@/core/engine/provider'
import type { TranslationMode, TranslationPosition, UserConfig } from '@/shared/types'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`缺少元素 #${id}`)
  return el as T
}

const engineSelect = $<HTMLSelectElement>('engine')
const vendorSelect = $<HTMLSelectElement>('vendor')
const modelInput = $<HTMLInputElement>('model')
const baseUrlInput = $<HTMLInputElement>('baseUrl')
const apiKeyInput = $<HTMLInputElement>('apiKey')
const engineHint = $<HTMLParagraphElement>('engine-hint')
const targetSelect = $<HTMLSelectElement>('target')
const sourceSelect = $<HTMLSelectElement>('source')
const modeSelect = $<HTMLSelectElement>('mode')
const positionSelect = $<HTMLSelectElement>('position')
const themeSelect = $<HTMLSelectElement>('theme')
const dynamicCheck = $<HTMLInputElement>('dynamic')
const cacheCheck = $<HTMLInputElement>('cache')
const cacheInfo = $<HTMLParagraphElement>('cache-info')
const statusEl = $<HTMLSpanElement>('status')
const videoEnabled = $<HTMLInputElement>('video-enabled')
const videoBilingual = $<HTMLInputElement>('video-bilingual')
const videoFontSize = $<HTMLInputElement>('video-font-size')
const videoFontSizeValue = $<HTMLSpanElement>('video-font-size-value')
const hoverEnabled = $<HTMLInputElement>('hover-enabled')
const inputEnabled = $<HTMLInputElement>('input-enabled')
const selectionEnabled = $<HTMLInputElement>('selection-enabled')
const imageEnabled = $<HTMLInputElement>('image-enabled')
const ocrLanguage = $<HTMLSelectElement>('ocr-language')
const pdfMode = $<HTMLSelectElement>('pdf-mode')
const siteRules = $<HTMLInputElement>('site-rules')

// ---- 语音翻译（AI 字幕）：与文本翻译配置完全独立的一组 ----
const asrEnabled = $<HTMLInputElement>('asr-enabled')
const asrProvider = $<HTMLSelectElement>('asr-provider')
const asrVendor = $<HTMLSelectElement>('asr-vendor')
const asrModel = $<HTMLInputElement>('asr-model')
const asrBaseUrl = $<HTMLInputElement>('asr-baseurl')
const asrKey = $<HTMLInputElement>('asr-key')
const asrReuseKey = $<HTMLInputElement>('asr-reuse-key')
const asrAppKey = $<HTMLInputElement>('asr-appkey')
const asrAkId = $<HTMLInputElement>('asr-akid')
const asrAkSecret = $<HTMLInputElement>('asr-aksecret')
const asrLocalModel = $<HTMLSelectElement>('asr-localmodel')
const asrLanguage = $<HTMLSelectElement>('asr-language')
const asrChunk = $<HTMLInputElement>('asr-chunk')
const asrAutoTranslate = $<HTMLInputElement>('asr-auto-translate')
const asrHint = $<HTMLParagraphElement>('asr-hint')

let vendors: VendorPreset[] = []

/** 语音识别引擎列表（由 SW 提供，与翻译引擎列表平行） */
let asrProviders: Array<{ id: string; name: string; mode: string; requiresAuth: boolean }> = []

/** 各 ASR 引擎需要的字段（按引擎类型显示/隐藏，避免一堆无关输入框） */
const ASR_FIELDS: Record<string, string[]> = {
  'openai-asr': ['asr-vendor-field', 'asr-model-field', 'asr-baseurl-field', 'asr-key-field'],
  'aliyun-nls': ['asr-appkey-field', 'asr-aksecret-field'],
  'tencent-asr': ['asr-akid-field', 'asr-aksecret-field'],
  'local-whisper': ['asr-localmodel-field'],
}

async function init(): Promise<void> {
  const config = await loadConfig()
  const meta = (await chrome.runtime.sendMessage({ type: 'get-providers' })) as {
    providers: TranslateProvider[]
    vendors: VendorPreset[]
  }
  vendors = meta.vendors

  const asrMeta = (await chrome.runtime.sendMessage({ type: 'get-asr-providers' })) as {
    providers: Array<{ id: string; name: string; mode: string; requiresAuth: boolean }>
  }
  asrProviders = asrMeta.providers ?? []
  asrProvider.innerHTML = asrProviders
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')

  engineSelect.innerHTML = meta.providers
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')
  vendorSelect.innerHTML = vendors
    .map((v) => `<option value="${v.id}">${v.name}</option>`)
    .join('')
  targetSelect.innerHTML = TARGET_LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`,
  ).join('')
  sourceSelect.innerHTML += TARGET_LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`,
  ).join('')
  themeSelect.innerHTML = THEMES.map(
    (t) => `<option value="${t.id}">${t.label}</option>`,
  ).join('')
  asrVendor.innerHTML = vendors.map((v) => `<option value="${v.id}">${v.name}</option>`).join('')

  engineSelect.value = config.engine.provider
  vendorSelect.value = config.engine.vendor ?? 'deepseek'
  modelInput.value = config.engine.model ?? ''
  baseUrlInput.value = config.engine.baseUrl ?? ''
  apiKeyInput.value = config.engine.apiKey ?? ''
  targetSelect.value = config.targetLanguage
  sourceSelect.value = config.sourceLanguage
  modeSelect.value = config.mode
  positionSelect.value = config.position
  themeSelect.value = config.theme
  dynamicCheck.checked = config.translateDynamicContent
  cacheCheck.checked = config.enableCache
  videoEnabled.checked = config.enableVideoSubtitle
  videoBilingual.checked = config.videoSubtitleBilingual
  videoFontSize.value = String(config.videoSubtitleFontSize)
  videoFontSizeValue.textContent = `${config.videoSubtitleFontSize}px`
  hoverEnabled.checked = config.enableHoverTranslate
  inputEnabled.checked = config.enableInputTranslate
  selectionEnabled.checked = config.enableSelectionTranslate
  imageEnabled.checked = config.enableImageTranslate
  ocrLanguage.value = config.ocrLanguage
  pdfMode.value = config.pdfLayoutMode
  siteRules.checked = config.enableSiteRules

  // 语音翻译配置（独立一组）
  asrEnabled.checked = config.asr.enabled
  asrProvider.value = config.asr.provider
  asrVendor.value = config.asr.vendor ?? 'siliconflow'
  asrModel.value = config.asr.model ?? ''
  asrBaseUrl.value = config.asr.baseUrl ?? ''
  asrKey.value = config.asr.apiKey ?? ''
  asrReuseKey.checked = config.asr.reuseTranslationKey ?? true
  asrAppKey.value = config.asr.appKey ?? ''
  asrAkId.value = config.asr.accessKeyId ?? ''
  asrAkSecret.value = config.asr.accessKeySecret ?? ''
  asrLocalModel.value = config.asr.localModel ?? 'base'
  asrLanguage.value = config.asr.language
  asrChunk.value = String(config.asr.chunkSeconds)
  asrAutoTranslate.checked = config.asr.autoTranslate

  applyEngineVisibility()
  applyAsrVisibility()
  await refreshCacheInfo()
}

function applyEngineVisibility(): void {
  const isLlm = engineSelect.value === 'openai-compatible'
  for (const id of ['vendor-field', 'model-field', 'baseurl-field', 'apikey-field']) {
    $(id).hidden = !isLlm
  }
  const preset = vendors.find((v) => v.id === vendorSelect.value)
  if (preset) {
    if (!modelInput.value) modelInput.value = preset.model
    modelInput.placeholder = preset.model
    if (preset.baseUrl && !baseUrlInput.value) baseUrlInput.value = preset.baseUrl
    engineHint.textContent = [preset.note, preset.consoleUrl ? `Key 申请：${preset.consoleUrl}` : '']
      .filter(Boolean)
      .join(' · ')
  } else {
    engineHint.textContent = ''
  }
}

/** 按所选 ASR 引擎显示对应字段 + 给出该路的使用提示 */
function applyAsrVisibility(): void {
  const provider = asrProvider.value
  const visible = new Set(ASR_FIELDS[provider] ?? [])
  const allFields = [
    'asr-vendor-field', 'asr-model-field', 'asr-baseurl-field', 'asr-key-field',
    'asr-appkey-field', 'asr-akid-field', 'asr-aksecret-field', 'asr-localmodel-field',
  ]
  for (const id of allFields) $(id).hidden = !visible.has(id)
  // 复用文本 Key 只对 A 路有意义
  $('asr-reuse-field').hidden = provider !== 'openai-asr'
  asrKey.hidden = provider === 'openai-asr' && asrReuseKey.checked

  const preset = vendors.find((v) => v.id === asrVendor.value)
  if (provider === 'openai-asr') {
    if (preset && !asrBaseUrl.value) asrBaseUrl.value = preset.baseUrl
    asrHint.textContent =
      'A 路：走 OpenAI 兼容的 /audio/transcriptions，硅基流动 SenseVoice / 通义 / Whisper 均可用，直接复用文本翻译的 Key。'
  } else if (provider === 'aliyun-nls') {
    asrHint.textContent = 'B 路：阿里云 NLS 实时识别（WebSocket）。需 AppKey 与 Token（或 AccessKey）。'
  } else if (provider === 'tencent-asr') {
    asrHint.textContent = 'B 路：腾讯云语音识别（TC3 签名，扩展内本地计算）。需 SecretId / SecretKey。'
  } else {
    asrHint.textContent = 'C 路：浏览器内 Whisper，离线可用、免 Key；首次会下载模型（几十 MB），CPU 推理较慢。'
  }
}

engineSelect.addEventListener('change', () => {
  applyEngineVisibility()
})

asrProvider.addEventListener('change', applyAsrVisibility)
asrVendor.addEventListener('change', () => {
  const preset = vendors.find((v) => v.id === asrVendor.value)
  if (preset) asrBaseUrl.value = preset.baseUrl
  applyAsrVisibility()
})
asrReuseKey.addEventListener('change', applyAsrVisibility)

vendorSelect.addEventListener('change', () => {
  const preset = vendors.find((v) => v.id === vendorSelect.value)
  if (preset) {
    modelInput.value = preset.model
    baseUrlInput.value = preset.baseUrl
  }
  applyEngineVisibility()
})

$('save').addEventListener('click', async () => {
  const config = await loadConfig()
  config.engine.provider = engineSelect.value
  config.engine.vendor = vendorSelect.value
  config.engine.model = modelInput.value.trim()
  config.engine.baseUrl = baseUrlInput.value.trim()
  config.engine.apiKey = apiKeyInput.value.trim()
  config.targetLanguage = targetSelect.value
  config.sourceLanguage = sourceSelect.value
  config.mode = modeSelect.value as TranslationMode
  config.position = positionSelect.value as TranslationPosition
  config.theme = themeSelect.value
  config.translateDynamicContent = dynamicCheck.checked
  config.enableCache = cacheCheck.checked
  config.enableVideoSubtitle = videoEnabled.checked
  config.videoSubtitleBilingual = videoBilingual.checked
  config.videoSubtitleFontSize = Number(videoFontSize.value)
  config.enableHoverTranslate = hoverEnabled.checked
  config.enableInputTranslate = inputEnabled.checked
  config.enableSelectionTranslate = selectionEnabled.checked
  config.enableImageTranslate = imageEnabled.checked
  config.ocrLanguage = ocrLanguage.value
  config.pdfLayoutMode = pdfMode.value as 'bilingual' | 'translation-only'
  config.enableSiteRules = siteRules.checked

  // 语音翻译（独立一组，不回写 engine 的任何字段）
  config.asr = {
    ...config.asr,
    enabled: asrEnabled.checked,
    provider: asrProvider.value as UserConfig['asr']['provider'],
    vendor: asrVendor.value,
    model: asrModel.value.trim(),
    baseUrl: asrBaseUrl.value.trim(),
    apiKey: asrKey.value.trim(),
    reuseTranslationKey: asrReuseKey.checked,
    appKey: asrAppKey.value.trim(),
    accessKeyId: asrAkId.value.trim(),
    accessKeySecret: asrAkSecret.value.trim(),
    localModel: asrLocalModel.value as 'tiny' | 'base' | 'small',
    language: asrLanguage.value,
    chunkSeconds: Number(asrChunk.value) || 6,
    autoTranslate: asrAutoTranslate.checked,
  }

  await saveConfig(config)
  statusEl.textContent = '✓ 已保存'
  window.setTimeout(() => {
    statusEl.textContent = ''
  }, 2000)
})

$('clear-cache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear-cache' })
  await refreshCacheInfo()
  statusEl.textContent = '✓ 缓存已清空'
})

$('shortcut-settings').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
})

videoFontSize.addEventListener('input', () => {
  videoFontSizeValue.textContent = `${videoFontSize.value}px`
})

async function refreshCacheInfo(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({ type: 'cache-stats' })) as {
    entries: number
    bytes: number
  }
  cacheInfo.textContent = `已缓存 ${stats.entries} 条译文，约 ${(stats.bytes / 1024).toFixed(1)} KB`
}

void init()
