import type { EngineConfig, TranslateRequest, TranslateResult } from '@/shared/types'

/**
 * 翻译引擎适配器接口。
 *
 * 设计要点（借鉴自反编译分析）：必须暴露两类长度上限，
 * 因为不同引擎的 batch 能力差异巨大——免费引擎可一次吞数千字符，
 * LLM 引擎则需按 token 严格控制。
 */
export interface TranslateProvider {
  readonly id: string
  readonly name: string
  /** 单条文本长度上限（字符） */
  readonly maxTextLengthPerRequest: number
  /** 单次请求文本组总长度上限（字符） */
  readonly maxTextGroupLengthPerRequest: number
  /** 建议并发数 */
  readonly concurrency: number
  /** 是否需要鉴权 */
  readonly requiresAuth: boolean
  translate(req: TranslateRequest, config: EngineConfig): Promise<TranslateResult>
}

/** 引擎错误分类，便于上层做差异化重试与提示 */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rateLimit' | 'network' | 'quota' | 'unknown',
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/** 把 HTTP 状态码归一化成错误分类 */
export function classifyHttpStatus(status: number): EngineError {
  if (status === 401 || status === 403) {
    return new EngineError(`鉴权失败（${status}），请检查 API Key`, 'auth')
  }
  if (status === 429) {
    return new EngineError('请求过于频繁或额度用尽（429）', 'rateLimit')
  }
  if (status === 402) {
    return new EngineError('账户额度不足（402）', 'quota')
  }
  if (status >= 500) {
    return new EngineError(`服务端错误（${status}）`, 'network')
  }
  return new EngineError(`请求失败（${status}）`, 'unknown')
}
