import type { VideoCue } from './types'

/**
 * 时间轴对齐。
 *
 * 职责：
 * 1. 二分查找当前时刻对应的 cue（播放时高频调用，必须 O(log n)）
 * 2. 把「零散 DOM 字幕」按时间窗口合并成稳定 cue
 * 3. 时间轴校正（视频拖动、倍速播放后仍能对齐）
 */

/** 二分查找当前时刻所在 cue；找不到返回 null */
export function findCueAt(cues: VideoCue[], time: number): VideoCue | null {
  if (cues.length === 0) return null

  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const cue = cues[mid] as VideoCue
    if (time < cue.start) hi = mid - 1
    else if (time > cue.end) lo = mid + 1
    else return cue
  }
  return null
}

/** 找出该时刻之后即将出现的 cue（用于预加载/预翻译） */
export function findNextCue(cues: VideoCue[], time: number): VideoCue | null {
  for (const cue of cues) {
    if (cue.start > time) return cue
  }
  return null
}

/**
 * 合并极短的连续 cue。
 *
 * 很多站点的字幕是按词切分的（YouTube 自动字幕尤其明显），
 * 逐条翻译既浪费额度又读不通，这里按时间间隔合并成完整句子。
 */
export function mergeShortCues(cues: VideoCue[], maxGap = 0.6, maxLength = 200): VideoCue[] {
  if (cues.length === 0) return []
  const merged: VideoCue[] = []
  let current: VideoCue = { ...(cues[0] as VideoCue) }

  for (let i = 1; i < cues.length; i += 1) {
    const cue = cues[i] as VideoCue
    const gap = cue.start - current.end
    const combined = `${current.text} ${cue.text}`.trim()
    // 间隔够小且合并后不过长 → 继续拼接
    if (gap <= maxGap && combined.length <= maxLength) {
      current = { ...current, end: cue.end, text: combined }
    } else {
      merged.push(current)
      current = { ...cue }
    }
  }
  merged.push(current)
  return merged
}

/**
 * DOM 字幕流合并器。
 *
 * DOM 方式拿不到时间轴，只能拿到「当前这句」。
 * 这里按「看到这句话时的播放时刻」打时间戳，并把同一句的重复推送去重，
 * 最终拼出一条近似时间轴。
 */
export class DomCueCollector {
  private cues: VideoCue[] = []
  private lastText = ''
  private lastStart = 0

  constructor(private readonly minDuration = 0.8) {}

  /** 收到一条 DOM 字幕文本，附带当时的播放时间 */
  push(text: string, time: number): void {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean || clean === this.lastText) return

    // 结束上一条
    const prev = this.cues[this.cues.length - 1]
    if (prev && prev.end === Number.POSITIVE_INFINITY) {
      prev.end = Math.max(time, prev.start + this.minDuration)
    }

    this.cues.push({ start: time, end: Number.POSITIVE_INFINITY, text: clean })
    this.lastText = clean
    this.lastStart = time
  }

  /** 收尾：把最后一条的结束时间补上 */
  finish(time?: number): VideoCue[] {
    const last = this.cues[this.cues.length - 1]
    if (last && last.end === Number.POSITIVE_INFINITY) {
      last.end = Math.max(time ?? last.start + 2, last.start + this.minDuration)
    }
    return this.cues
  }

  get size(): number {
    return this.cues.length
  }

  get lastPushTime(): number {
    return this.lastStart
  }
}

/**
 * 视频时间轴校正。
 *
 * 某些站点（尤其直播回放、HLS）currentTime 与字幕时间基准有偏移，
 * 这里记录第一次对齐时的差值，后续按差值补偿。
 */
export class TimelineCalibrator {
  private offset = 0
  private calibrated = false

  /** 用「已知正确的字幕时间」与「当前播放时间」校准 */
  calibrate(cue: VideoCue, currentTime: number): void {
    if (this.calibrated) return
    const expected = (cue.start + cue.end) / 2
    const diff = currentTime - expected
    // 偏差在合理范围内才采纳，避免单次抖动污染
    if (Math.abs(diff) > 0.3 && Math.abs(diff) < 10) {
      this.offset = diff
      this.calibrated = true
    }
  }

  /** 把播放时间换算成字幕时间 */
  toSubtitleTime(currentTime: number): number {
    return currentTime - this.offset
  }

  reset(): void {
    this.offset = 0
    this.calibrated = false
  }
}
