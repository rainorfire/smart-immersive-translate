import type { UserConfig } from './types'

/**
 * 默认配置。
 * 注意：默认引擎选 bing 而非 google——google 免费端点已不可达（2026 实测）。
 */
export const DEFAULT_CONFIG: UserConfig = {
  engine: {
    provider: 'bing',
    concurrency: 4,
    maxTextLengthPerRequest: 1800,
    maxTextGroupLengthPerRequest: 4000,
  },
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto',
  mode: 'dual',
  position: 'after',
  translateDynamicContent: true,
  excludeTags: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'CANVAS', 'IFRAME'],
  enableSiteRules: true,
  enableCache: true,
  theme: 'bilens-theme-underline',
  enableHoverTranslate: true,
  enableInputTranslate: true,
  enableSelectionTranslate: true,
}

const STORAGE_KEY = 'bilens:config'

/** 读取配置，缺失字段用默认值补齐 */
export async function loadConfig(): Promise<UserConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const saved = stored[STORAGE_KEY] as Partial<UserConfig> | undefined
  if (!saved) return structuredClone(DEFAULT_CONFIG)
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...saved,
    engine: { ...DEFAULT_CONFIG.engine, ...saved.engine },
  }
}

export async function saveConfig(config: UserConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config })
}

/** 配置变更订阅，用于页面实时响应设置修改 */
export function onConfigChange(listener: (config: UserConfig) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return
    const saved = changes[STORAGE_KEY].newValue as Partial<UserConfig> | undefined
    if (!saved) return
    listener({
      ...structuredClone(DEFAULT_CONFIG),
      ...saved,
      engine: { ...DEFAULT_CONFIG.engine, ...saved.engine },
    })
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}
