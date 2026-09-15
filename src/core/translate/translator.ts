import type { EngineConfig, TranslatableItem, TranslateRequest } from '@/shared/types'
import { getProvider } from '../engine/registry'
import { getCached, hashKey, setCached } from './cache'
import { buildBatches, mergeSplit } from './splitter'

export interface TranslateOptions {
  items: TranslatableItem[]
  source: string
  target: string
  engine: EngineConfig
  useCache: boolean
  /** 单批进度回调，用于 UI 进度条 */
  onBatchDone?: (done: number, total: number) => void
}

export interface TranslateOutcome {
  translations: Record<string, string>
  failed: Record<string, string>
}

/** 单批执行结果，供合并阶段汇总 */
interface BatchOutcome {
  items: TranslatableItem[]
  translations: Record<string, string>
  failed: Record<string, string>
}

/**
 * 翻译调度器：编排「缓存命中 → 分批 → 并发请求 → 失败重试 → 合并」全流程。
 */
export async function translateItems(options: TranslateOptions): Promise<TranslateOutcome> {
  const { items, source, target, engine, useCache } = options
  const translations: Record<string, string> = {}
  const failed: Record<string, string> = {}
  if (items.length === 0) return { translations, failed }

  const provider = getProvider(engine.provider)

  // 1. 查缓存
  const pending: TranslatableItem[] = []
  if (useCache) {
    const keys = await Promise.all(
      items.map((item) =>
        hashKey({ text: item.text, source, target, provider: provider.id, model: engine.model }),
      ),
    )
    const lookups = await Promise.all(keys.map((k) => getCached(k)))
    items.forEach((item, i) => {
      const cached = lookups[i]
      if (cached !== undefined) translations[item.id] = cached
      else pending.push(item)
    })
  } else {
    pending.push(...items)
  }

  if (pending.length === 0) return { translations, failed }

  // 2. 分批
  const maxTextLength = engine.maxTextLengthPerRequest ?? provider.maxTextLengthPerRequest
  const maxGroupLength =
    engine.maxTextGroupLengthPerRequest ?? provider.maxTextGroupLengthPerRequest
  const batches = buildBatches(pending, maxTextLength, maxGroupLength)

  // 3. 并发执行（受 provider.concurrency 约束）
  const concurrency = Math.max(1, engine.concurrency ?? provider.concurrency)
  const results: BatchOutcome[] = []
  let done = 0

  const queue = [...batches]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const batch = queue.shift()
      if (!batch) break
      const req: TranslateRequest = { items: batch, source, target }
      await runBatchWithRetry(provider, req, engine, results)
      done += 1
      options.onBatchDone?.(done, batches.length)
    }
  })
  await Promise.all(workers)

  // 4. 合并切片
  const rawTranslations: Record<string, string> = {}
  const rawFailed: Record<string, string> = {}
  for (const r of results) {
    Object.assign(rawTranslations, r.translations)
    Object.assign(rawFailed, r.failed)
  }

  const { merged, failed: missingIds } = mergeSplit(pending, rawTranslations)
  Object.assign(translations, merged)
  for (const id of missingIds) {
    failed[id] = rawFailed[id] ?? '翻译失败'
  }

  // 5. 回写缓存
  if (useCache) {
    await Promise.all(
      pending
        .filter((item) => merged[item.id] !== undefined)
        .map(async (item) => {
          const key = await hashKey({
            text: item.text,
            source,
            target,
            provider: provider.id,
            model: engine.model,
          })
          await setCached(key, merged[item.id] as string)
        }),
    )
  }

  return { translations, failed }
}

/** 单批执行，指数退避重试（仅对网络/限流类错误重试） */
async function runBatchWithRetry(
  provider: ReturnType<typeof getProvider>,
  req: TranslateRequest,
  engine: EngineConfig,
  results: BatchOutcome[],
  maxAttempts = 3,
): Promise<void> {
  let last: Omit<BatchOutcome, 'items'> = { translations: {}, failed: {} }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const outcome = await provider.translate(req, engine)
      const allFailed = Object.keys(outcome.translations).length === 0
      last = outcome
      if (!allFailed || attempt === maxAttempts) break
    } catch (e) {
      last = {
        translations: {},
        failed: Object.fromEntries(
          req.items.map((i) => [i.id, e instanceof Error ? e.message : String(e)]),
        ),
      }
      if (attempt === maxAttempts) break
    }
    // 指数退避：400ms / 800ms
    await sleep(400 * 2 ** (attempt - 1))
  }

  results.push({ items: req.items, ...last })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
