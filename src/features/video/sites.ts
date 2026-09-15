import type { VideoSubtitleRule } from './types'

/**
 * 视频站点字幕规则表。
 *
 * 站点清单对标 1.33.1 的 19 类站点（youtube / netflix / webvtt / khanacademy /
 * udemy / hulu / mubi / text_track / live / ebutt / disneyplus / fmp4.xml /
 * multi_attach_vtt / twitter / subsrt / xml / av / general）。
 *
 * 本表按「抽取方式」归一，不逐个硬编码播放器内部实现：
 * - 有原生 <track> 的站点走 native
 * - 有公开字幕接口的走 fetch
 * - 其余走 DOM 监听兜底
 */

export const VIDEO_SITE_RULES: VideoSubtitleRule[] = [
  // ---------- YouTube ----------
  {
    name: 'youtube',
    hostname: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'],
    videoSelector: 'video.html5-main-video, video',
    containerSelector: '#movie_player',
    captionSelector: '.ytp-caption-segment, .caption-window',
    fetchKind: 'youtube',
    preferNative: false,
  },

  // ---------- 长视频平台 ----------
  {
    name: 'netflix',
    hostname: 'netflix.com',
    videoSelector: 'video',
    containerSelector: '[data-uia="video-canvas"], .watch-video',
    captionSelector: '.player-timedtext, .player-timedtext-text-container span',
  },
  {
    name: 'disneyplus',
    hostname: 'disneyplus.com',
    videoSelector: 'video',
    captionSelector: '.hudson-subtitle-text, .dss-subtitle-renderer-cue',
  },
  {
    name: 'hulu',
    hostname: 'hulu.com',
    videoSelector: 'video',
    captionSelector: '.caption-text, .hulu-player-captions-cue',
  },
  {
    name: 'prime-video',
    hostname: 'primevideo.com',
    videoSelector: 'video',
    captionSelector: '.atvwebplayersdk-captions-text',
  },
  {
    name: 'hbomax',
    hostname: ['hbomax.com', 'max.com'],
    videoSelector: 'video',
    captionSelector: '.cueBox, .subtitle-renderer',
  },
  {
    name: 'mubi',
    hostname: 'mubi.com',
    videoSelector: 'video',
    captionSelector: '.subtitle, .captions',
  },

  // ---------- 在线教育 ----------
  {
    name: 'khanacademy',
    hostname: ['khanacademy.org', 'khanacademy.zendesk.com'],
    videoSelector: 'video',
    captionSelector: '.video-subtitle, .caption-container',
    preferNative: true,
  },
  {
    name: 'coursera',
    hostname: 'coursera.org',
    videoSelector: 'video',
    captionSelector: '.rc-CaptionsRenderer, .video-text-track-cue',
    preferNative: true,
  },
  {
    name: 'udemy',
    hostname: 'udemy.com',
    videoSelector: 'video',
    captionSelector: '.vjs-text-track-cue, .caption-display',
    preferNative: true,
  },

  // ---------- 通用视频站 ----------
  {
    name: 'vimeo',
    hostname: 'vimeo.com',
    videoSelector: 'video',
    captionSelector: '.vp-captions span, .vp-caption-text',
  },
  {
    name: 'bilibili',
    hostname: 'bilibili.com',
    videoSelector: 'video',
    containerSelector: '.bpx-player-video-wrap',
    captionSelector: '.bpx-player-subtitle-panel-text, .bpx-player-adv-danmaku',
  },
  {
    name: 'twitter',
    hostname: ['twitter.com', 'x.com'],
    videoSelector: 'video',
    captionSelector: '.Player-EngagementBarContainer + div span',
  },
  {
    name: 'dailymotion',
    hostname: 'dailymotion.com',
    videoSelector: 'video',
    captionSelector: '.dmp-TextCue, .dmp-Subtitle',
  },
  {
    name: 'twitch',
    hostname: 'twitch.tv',
    videoSelector: 'video',
    captionSelector: '.tw-caption-line',
  },
  {
    name: 'ted',
    hostname: 'ted.com',
    videoSelector: 'video',
    captionSelector: '.talk-transcript__fragment',
    preferNative: true,
  },
] as const

/** 按 URL 匹配视频站点规则，未命中返回 null（走通用兜底） */
export function matchVideoRule(url: string): VideoSubtitleRule | null {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return null
  }

  for (const rule of VIDEO_SITE_RULES) {
    const hosts = Array.isArray(rule.hostname) ? rule.hostname : [rule.hostname]
    if (hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) return rule
  }
  return null
}

/**
 * 通用字幕容器候选选择器。
 *
 * 用于「没有站点规则」的页面：多数自研播放器的字幕容器类名里
 * 会带 caption / subtitle / text-track 字样，按这些线索探测。
 * 不做盲扫，避免误把正文当字幕。
 */
export const GENERIC_CAPTION_SELECTORS = [
  '[class*="caption" i]',
  '[class*="subtitle" i]',
  '[class*="subtitles" i]',
  '[class*="text-track" i]',
  '[class*="texttrack" i]',
  '[id*="caption" i]',
  '[id*="subtitle" i]',
] as const

/**
 * 探测通用字幕容器：选出可见、有文本、且贴近视频的候选。
 * 返回选择器字符串（供 DomCueCollector 轮询）。
 */
export function detectGenericCaptionSelector(video: HTMLVideoElement): string | null {
  const doc = video.ownerDocument
  const videoRect = video.getBoundingClientRect()

  for (const selector of GENERIC_CAPTION_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }

    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue
      if (node === video || node.contains(video)) continue

      const rect = node.getBoundingClientRect()
      // 必须可见、有尺寸
      if (rect.width < 40 || rect.height < 8) continue
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      // 必须贴近视频区域（上下 60px 内）
      const nearVideo =
        rect.bottom > videoRect.top - 60 && rect.top < videoRect.bottom + 60
      if (!nearVideo) continue
      // 文本要短，长文多半是正文而非字幕
      const text = node.textContent?.trim() ?? ''
      if (text.length > 300) continue

      return selector
    }
  }

  return null
}
