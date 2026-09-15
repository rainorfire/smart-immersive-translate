/**
 * 译文缓存。
 *
 * 两级结构：内存 LRU（快，随 SW 生命周期） + chrome.storage.local（持久）。
 * 键为 sha256(text + source + target + provider + model)，任一项变化即失效。
 */

const PREFIX = 'bilens:cache:'
const INDEX_KEY = 'bilens:cache:__index__'
const MAX_ENTRIES = 3000
const MAX_BYTES = 4 * 1024 * 1024

const memory = new Map<string, string>()
const MEMORY_LIMIT = 800

export interface CacheKeyParts {
  text: string
  source: string
  target: string
  provider: string
  model?: string
}

export async function hashKey(parts: CacheKeyParts): Promise<string> {
  const raw = [parts.text, parts.source, parts.target, parts.provider, parts.model ?? ''].join('\u0000')
  const buffer = new TextEncoder().encode(raw)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function getCached(key: string): Promise<string | undefined> {
  const hit = memory.get(key)
  if (hit !== undefined) {
    // LRU 触碰：重新插入以更新顺序
    memory.delete(key)
    memory.set(key, hit)
    return hit
  }
  const stored = await chrome.storage.local.get(PREFIX + key)
  const value = stored[PREFIX + key] as string | undefined
  if (value !== undefined) setMemory(key, value)
  return value
}

export async function setCached(key: string, value: string): Promise<void> {
  setMemory(key, value)
  await chrome.storage.local.set({ [PREFIX + key]: value })
  await touchIndex(key, value.length)
}

function setMemory(key: string, value: string): void {
  memory.delete(key)
  memory.set(key, value)
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

/** 维护索引以便按 LRU 淘汰，防止存储无限增长 */
async function touchIndex(key: string, size: number): Promise<void> {
  const stored = await chrome.storage.local.get(INDEX_KEY)
  const index = (stored[INDEX_KEY] as Record<string, { at: number; size: number }>) ?? {}
  index[key] = { at: Date.now(), size }

  const keys = Object.keys(index)
  const totalBytes = Object.values(index).reduce((sum, e) => sum + e.size, 0)
  const overflow = keys.length > MAX_ENTRIES || totalBytes > MAX_BYTES

  if (overflow) {
    keys.sort((a, b) => (index[a]?.at ?? 0) - (index[b]?.at ?? 0))
    const removeCount = Math.max(1, Math.floor(keys.length * 0.2))
    const toRemove = keys.slice(0, removeCount)
    for (const k of toRemove) {
      delete index[k]
      memory.delete(k)
    }
    await chrome.storage.local.remove(toRemove.map((k) => PREFIX + k))
  }

  await chrome.storage.local.set({ [INDEX_KEY]: index })
}

export async function clearCache(): Promise<void> {
  memory.clear()
  const stored = await chrome.storage.local.get(INDEX_KEY)
  const index = (stored[INDEX_KEY] as Record<string, unknown>) ?? {}
  const keys = Object.keys(index).map((k) => PREFIX + k)
  if (keys.length > 0) await chrome.storage.local.remove(keys)
  await chrome.storage.local.remove(INDEX_KEY)
}

export async function getCacheStats(): Promise<{ entries: number; bytes: number }> {
  const stored = await chrome.storage.local.get(INDEX_KEY)
  const index = (stored[INDEX_KEY] as Record<string, { size: number }>) ?? {}
  const entries = Object.keys(index).length
  const bytes = Object.values(index).reduce((sum, e) => sum + (e.size ?? 0), 0)
  return { entries, bytes }
}
