/** 站点规则定义 */

export interface SiteRule {
  /** 规则名，便于调试 */
  name?: string
  /** 精确匹配的域名（不含协议） */
  hostname?: string | string[]
  /** 正则匹配完整 URL */
  regex?: string | string[]
  /** 优先翻译这些选择器命中的元素（正文区域） */
  selectors?: string[]
  /** 在这些容器内部查找文本 */
  containerSelectors?: string[]
  /** 这些选择器命中的元素不翻译 */
  excludeSelectors?: string[]
  /** 该站点是否启用语言检测 */
  detectLanguage?: boolean
  /** 是否跳过站点规则的后备全文扫描 */
  noFallback?: boolean
}

export interface MatchedRule {
  rule: SiteRule
  /** 命中的具体 URL */
  url: string
}
