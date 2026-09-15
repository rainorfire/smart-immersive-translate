import { loadConfig, saveConfig } from '@/shared/config'
import { TARGET_LANGUAGES } from '@/shared/languages'
import type { VendorPreset } from '@/core/engine/vendors'
import type { TranslateProvider } from '@/core/engine/provider'
import type { TranslationMode, TranslationPosition } from '@/shared/types'

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
const dynamicCheck = $<HTMLInputElement>('dynamic')
const cacheCheck = $<HTMLInputElement>('cache')
const cacheInfo = $<HTMLParagraphElement>('cache-info')
const statusEl = $<HTMLSpanElement>('status')

let vendors: VendorPreset[] = []

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
  sourceSelect.innerHTML += TARGET_LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`,
  ).join('')

  engineSelect.value = config.engine.provider
  vendorSelect.value = config.engine.vendor ?? 'deepseek'
  modelInput.value = config.engine.model ?? ''
  baseUrlInput.value = config.engine.baseUrl ?? ''
  apiKeyInput.value = config.engine.apiKey ?? ''
  targetSelect.value = config.targetLanguage
  sourceSelect.value = config.sourceLanguage
  modeSelect.value = config.mode
  positionSelect.value = config.position
  dynamicCheck.checked = config.translateDynamicContent
  cacheCheck.checked = config.enableCache

  applyEngineVisibility()
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

engineSelect.addEventListener('change', () => {
  applyEngineVisibility()
})

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
  config.translateDynamicContent = dynamicCheck.checked
  config.enableCache = cacheCheck.checked
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

async function refreshCacheInfo(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({ type: 'cache-stats' })) as {
    entries: number
    bytes: number
  }
  cacheInfo.textContent = `已缓存 ${stats.entries} 条译文，约 ${(stats.bytes / 1024).toFixed(1)} KB`
}

void init()
