import { parseSubtitle, detectFormat } from '@/features/subtitle/parser'
import type { SubtitleTrack, VideoCue, VideoSubtitleRule } from './types'

/**
 * 字幕轨提取。
 *
 * 三条路径按优先级尝试：
 * 1. native：<video> 的原生 textTracks（含完整时间轴，最可靠）
 * 2. fetch ：站点公开字幕接口 / VTT 链接（YouTube timedtext 等）
 * 3. dom   ：轮询站点字幕容器（通用兜底，只有当前句，无时间轴）
 */

/**
 * 从原生 textTracks 提取字幕。
 *
 * 关键点：站点默认关闭字幕时，track.cues 是**空的**（未加载）。
 * 把 mode 设为 'hidden' 会触发浏览器加载 cues 但不显示，
 * 这正是我们要的——既拿到字幕又不和覆盖层打架。
 */
export async function extractNativeTrack(video: HTMLVideoElement): Promise<SubtitleTrack | null> {
  const tracks = video.textTracks
  if (!tracks || tracks.length === 0) return null

  // 1. 已经有 cues 的轨道直接用（正在显示的最优先）
  let chosen: TextTrack | null = null
  for (const track of tracks) {
    if (track.mode === 'showing' && track.cues?.length) {
      chosen = track
      break
    }
  }
  if (!chosen) {
    for (const track of tracks) {
      if (track.cues?.length) {
        chosen = track
        break
      }
    }
  }
  if (chosen) return buildTrackFromCues(chosen)

  // 2. 没有 cues：尝试触发加载（字幕/翻译类轨道）
  for (const track of tracks) {
    if (track.kind === 'captions' || track.kind === 'subtitles') {
      const loaded = await loadTrackCues(track)
      if (loaded) return buildTrackFromCues(track)
    }
  }

  return null
}

/** 把轨道 mode 设为 hidden 触发加载，等待 cues 就绪（带超时） */
function loadTrackCues(track: TextTrack, timeoutMs = 2500): Promise<boolean> {
  if (track.cues?.length) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      track.removeEventListener('load', onLoad)
      track.removeEventListener('cuechange', onCue)
      window.clearTimeout(timer)
      resolve(ok)
    }
    const onLoad = (): void => done(Boolean(track.cues?.length))
    const onCue = (): void => {
      if (track.cues?.length) done(true)
    }
    const timer = window.setTimeout(() => done(Boolean(track.cues?.length)), timeoutMs)

    track.addEventListener('load', onLoad)
    track.addEventListener('cuechange', onCue)

    try {
      // hidden = 加载但不显示，避免和自研覆盖层重叠
      track.mode = 'hidden'
    } catch {
      done(false)
    }
  })
}

function buildTrackFromCues(chosen: TextTrack): SubtitleTrack | null {
  if (!chosen.cues?.length) return null

  const cues: VideoCue[] = []
  for (const cue of chosen.cues) {
    if (!(cue instanceof VTTCue)) continue
    const text = stripTags(cue.text).trim()
    if (!text) continue
    cues.push({ start: cue.startTime, end: cue.endTime, text })
  }
  if (cues.length === 0) return null

  return {
    kind: 'native',
    language: chosen.language || 'unknown',
    origin: 'video.textTracks',
    cues,
  }
}

/**
 * YouTube 字幕抓取。
 *
 * 路径：watch 页 → ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer
 *      → baseUrl（timedtext）→ 抓 XML → 解析 <text start dur>
 *
 * 说明：这是页面自身公开的字幕数据，不需要额外权限，也不破解签名。
 */
export async function fetchYouTubeTrack(
  doc: Document = document,
): Promise<SubtitleTrack | null> {
  const baseUrl = findYouTubeCaptionUrl(doc)
  if (!baseUrl) return null

  try {
    const res = await fetch(baseUrl)
    if (!res.ok) return null
    const xml = await res.text()
    const cues = parseYouTubeXml(xml)
    if (cues.length === 0) return null
    return { kind: 'fetch', language: 'en', origin: 'youtube:timedtext', cues }
  } catch {
    return null
  }
}

/** 从内联 JSON 或 <track> 标签中找 YouTube timedtext 地址 */
function findYouTubeCaptionUrl(doc: Document): string | null {
  // 1) 页面内联的 playerResponse
  const scripts = [...doc.querySelectorAll('script')]
  for (const script of scripts) {
    const content = script.textContent
    if (!content || !content.includes('captionTracks')) continue
    const match = /"captionTracks":(\[.*?\])/s.exec(content)
    if (!match?.[1]) continue
    try {
      const tracks = JSON.parse(match[1]) as Array<{ baseUrl?: string; languageCode?: string }>
      const url = tracks.find((t) => t.baseUrl)?.baseUrl
      if (url) return url.replace(/\\u0026/g, '&').replace(/\\\//g, '/')
    } catch {
      continue
    }
  }

  // 2) 玩家容器上的字幕轨（部分版本挂在 DOM 属性里）
  const player = doc.querySelector('#movie_player')
  const fromAttr = player?.getAttribute('data-caption-url')
  if (fromAttr) return fromAttr

  return null
}

/** 解析 YouTube timedtext XML：<text start="1.2" dur="2.3">内容</text> */
export function parseYouTubeXml(xml: string): VideoCue[] {
  const cues: VideoCue[] = []
  const re = /<text[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let m = re.exec(xml)
  while (m) {
    const start = Number(m[1])
    const dur = Number(m[2])
    const text = decodeEntities(stripTags(m[3] ?? '')).replace(/\s+/g, ' ').trim()
    if (text && Number.isFinite(start)) {
      cues.push({ start, end: start + (Number.isFinite(dur) ? dur : 2), text })
    }
    m = re.exec(xml)
  }
  cues.sort((a, b) => a.start - b.start)
  return cues
}

/** 依次尝试所有可用来源 */
export async function collectTrack(
  video: HTMLVideoElement,
  rule: VideoSubtitleRule | null,
): Promise<SubtitleTrack | null> {
  // 原生轨道时间轴最准，永远优先
  const native = await extractNativeTrack(video)
  if (native) return native

  if (rule?.fetchKind === 'youtube') {
    const yt = await fetchYouTubeTrack()
    if (yt) return yt
  }

  // 页面里直接挂的 <track src>（很多自建站会用）
  const vtt = await fetchTrackFromElements(video.ownerDocument)
  if (vtt) return vtt

  return null
}

/** 从页面 <track src="*.vtt|srt"> 抓取字幕文件 */
async function fetchTrackFromElements(doc: Document): Promise<SubtitleTrack | null> {
  const trackEls = [...doc.querySelectorAll('track[src]')]
  for (const el of trackEls) {
    const src = el.getAttribute('src')
    if (!src) continue
    try {
      const res = await fetch(src)
      if (!res.ok) continue
      const content = await res.text()
      const format = detectFormat(src, content)
      const parsed = parseSubtitle(content, format)
      const cues = cuesFromParsed(parsed.cues, format)
      if (cues.length > 0) {
        return { kind: 'fetch', language: 'unknown', origin: `track:${format}`, cues }
      }
    } catch {
      continue
    }
  }
  return null
}

/** 把字幕文件的 cue 转成带时间轴的 VideoCue */
function cuesFromParsed(
  cues: Array<{ meta: string; text: string }>,
  format: string,
): VideoCue[] {
  const result: VideoCue[] = []
  for (const cue of cues) {
    const range = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(
      cue.meta,
    )
    if (!range) continue
    const start = toSeconds(range[1], range[2], range[3], range[4])
    const end = toSeconds(range[5], range[6], range[7], range[8])
    const text = stripTags(cue.text).replace(/\s+/g, ' ').trim()
    if (!text) continue
    result.push({ start, end, text })
  }
  void format
  return result
}

function toSeconds(h?: string, m?: string, s?: string, ms?: string): number {
  return (
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0) +
    Number((ms ?? '0').padEnd(3, '0')) / 1000
  )
}

/** 去除字幕文本里的内联标签 */
export function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
