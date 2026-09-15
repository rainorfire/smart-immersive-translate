/**
 * 视频双语字幕的类型定义。
 *
 * 设计要点：字幕来源分三类，优先级从高到低——
 * 1. native   ：页面 <video> 的原生 textTracks（最准，带完整时间轴）
 * 2. fetch    ：从站点接口抓取字幕文件（YouTube timedtext、VTT URL）
 * 3. dom      ：监听站点的字幕 DOM 容器（通用兜底，兼容任意站点）
 */

export type SubtitleSourceKind = 'native' | 'fetch' | 'dom'

/** 一条字幕（时间轴 + 文本） */
export interface VideoCue {
  /** 起始时间（秒） */
  start: number
  /** 结束时间（秒） */
  end: number
  /** 原文 */
  text: string
  /** 译文，翻译完成后填充 */
  translation?: string
  /** 翻译失败原因 */
  failed?: string
}

/** 字幕轨（一整条字幕的全部 cue） */
export interface SubtitleTrack {
  kind: SubtitleSourceKind
  /** 语言代码（如 en） */
  language: string
  /** 轨道来源描述，用于诊断 */
  origin: string
  cues: VideoCue[]
}

/** 站点视频字幕规则 */
export interface VideoSubtitleRule {
  /** 规则名 */
  name: string
  /** 域名匹配 */
  hostname: string | string[]
  /** 视频元素选择器，默认 video */
  videoSelector?: string
  /** 播放器容器选择器（覆盖层的挂载点），默认视频的父元素 */
  containerSelector?: string
  /** 站点字幕容器的选择器（DOM 抓取方式用） */
  captionSelector?: string
  /** 字幕接口抓取方式 */
  fetchKind?: 'youtube' | 'vtt-link'
  /** 是否优先使用原生轨道 */
  preferNative?: boolean
}

export interface VideoSubtitleOptions {
  source: string
  target: string
  /** 双语：原文 + 译文；仅译文：只显示译文 */
  bilingual: boolean
  /** 覆盖层字号（px） */
  fontSize: number
}

export const DEFAULT_VIDEO_OPTIONS: VideoSubtitleOptions = {
  source: 'auto',
  target: 'zh-CN',
  bilingual: true,
  fontSize: 26,
}
