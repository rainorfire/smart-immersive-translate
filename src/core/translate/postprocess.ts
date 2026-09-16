/**
 * 译文后处理。
 *
 * 引擎（尤其 LLM 系）会把原文里的半角符号「汉化」成全角，其中时间戳最典型：
 * 实测 `00:00` 被翻成 `00：00`，导致时间轴看起来全变了。
 * 这里只修「确定不该改」的模式，不做宽泛的标点转换，避免误伤中文标点。
 */

/** 数字之间的全角冒号还原为半角：`00：12` → `00:12` */
const FULLWIDTH_COLON_BETWEEN_DIGITS = /(\d)\s*\uff1a\s*(\d)/g

/** 数字之间的全角句点还原为半角：`3。14` → `3.14` */
const FULLWIDTH_DOT_BETWEEN_DIGITS = /(\d)\s*\u3002\s*(\d)/g

export function postprocessTranslation(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(FULLWIDTH_COLON_BETWEEN_DIGITS, '$1:$2')
  out = out.replace(FULLWIDTH_DOT_BETWEEN_DIGITS, '$1.$2')
  return out
}
