import type { MatchedRule, SiteRule } from './types'
import { SITE_RULES } from './index'

/** 编译缓存：正则编译一次，避免重复开销 */
const regexCache = new Map<string, RegExp>()

function getRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern)
  if (cached) return cached
  try {
    const re = new RegExp(pattern)
    regexCache.set(pattern, re)
    return re
  } catch {
    return null
  }
}

/** 为当前 URL 找出匹配的站点规则，无匹配返回 null */
export function matchSiteRule(url: string, rules: SiteRule[] = SITE_RULES): MatchedRule | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const { hostname } = parsed

  for (const rule of rules) {
    if (rule.hostname) {
      const hosts = Array.isArray(rule.hostname) ? rule.hostname : [rule.hostname]
      if (hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
        return { rule, url }
      }
    }
    if (rule.regex) {
      const patterns = Array.isArray(rule.regex) ? rule.regex : [rule.regex]
      for (const p of patterns) {
        const re = getRegex(p)
        if (re?.test(url)) return { rule, url }
      }
    }
  }

  return null
}

/**
 * 按规则的 selectors / containerSelectors 收集待翻译根元素。
 * 两者都为空时返回空数组，由上层走全文兜底扫描。
 */
export function collectRuleRoots(rule: SiteRule, root: ParentNode = document): Element[] {
  const found = new Set<Element>()

  for (const selector of rule.selectors ?? []) {
    for (const el of safeQueryAll(root, selector)) found.add(el)
  }
  for (const selector of rule.containerSelectors ?? []) {
    for (const el of safeQueryAll(root, selector)) found.add(el)
  }

  if (rule.excludeSelectors?.length) {
    for (const selector of rule.excludeSelectors) {
      for (const el of safeQueryAll(root, selector)) {
        // 被排除的元素及其后代都移除
        for (const candidate of [...found]) {
          if (el.contains(candidate)) found.delete(candidate)
        }
      }
    }
  }

  return [...found].filter((el) => el.isConnected)
}

/** 非法选择器不应导致整体失败 */
function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return [...root.querySelectorAll(selector)]
  } catch {
    return []
  }
}
