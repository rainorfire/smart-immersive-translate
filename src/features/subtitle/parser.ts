/**
 * 字幕文件解析与序列化。
 * 支持 srt / vtt / ass / lrc 四种格式。
 *
 * 设计原则：解析后只翻译「文本内容」，时间轴、序号、样式指令原样保留，
 * 回写时逐字还原，保证播放器兼容性。
 */

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'lrc'

export interface SubtitleCue {
  /** 在文件中的序号（用于回写定位） */
  index: number
  /** 时间轴等非文本内容，原样保留 */
  meta: string
  /** 待翻译的正文（可能含内联标签，如 <i>、{\an8}） */
  text: string
}

export interface ParsedSubtitle {
  format: SubtitleFormat
  cues: SubtitleCue[]
  /** 文件头（如 ass 的 [Script Info] 段），原样保留 */
  header: string
  /** 文件尾 */
  footer: string
}

/** 依据文件扩展名或内容判断格式 */
export function detectFormat(filename: string, content: string): SubtitleFormat {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'srt' || ext === 'vtt' || ext === 'ass' || ext === 'ssa' || ext === 'lrc') {
    return (ext === 'ssa' ? 'ass' : ext) as SubtitleFormat
  }
  const head = content.slice(0, 400).toUpperCase()
  if (head.includes('[SCRIPT INFO]') || head.includes('DIALOGUE:')) return 'ass'
  if (head.startsWith('WEBVTT')) return 'vtt'
  if (/^\[\d{2}:\d{2}/m.test(content)) return 'lrc'
  return 'srt'
}

export function parseSubtitle(content: string, format: SubtitleFormat): ParsedSubtitle {
  switch (format) {
    case 'srt':
      return parseSrt(content)
    case 'vtt':
      return parseVtt(content)
    case 'ass':
      return parseAss(content)
    case 'lrc':
      return parseLrc(content)
  }
}

export function serializeSubtitle(parsed: ParsedSubtitle, translations: Map<number, string>): string {
  switch (parsed.format) {
    case 'srt':
      return serializeSrt(parsed, translations)
    case 'vtt':
      return serializeVtt(parsed, translations)
    case 'ass':
      return serializeAss(parsed, translations)
    case 'lrc':
      return serializeLrc(parsed, translations)
  }
}

// ---------- SRT ----------

function parseSrt(content: string): ParsedSubtitle {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length < 2) continue
    const timeLineIndex = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIndex === -1) continue

    // 序号行由序列化阶段统一重建，这里只保留时间轴行
    const meta = lines[timeLineIndex] ?? ''
    const text = lines.slice(timeLineIndex + 1).join('\n')
    if (!text.trim()) continue

    cues.push({ index: cues.length, meta, text })
  }

  return { format: 'srt', cues, header: '', footer: '' }
}

function serializeSrt(parsed: ParsedSubtitle, translations: Map<number, string>): string {
  return (
    parsed.cues
      .map((cue, i) => {
        const text = translations.get(cue.index) ?? cue.text
        return `${i + 1}\n${cue.meta}\n${text}`
      })
      .join('\n\n') + '\n'
  )
}

// ---------- VTT ----------

function parseVtt(content: string): ParsedSubtitle {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const headerEnd = normalized.indexOf('\n\n')
  const header = headerEnd === -1 ? normalized : normalized.slice(0, headerEnd)
  const body = headerEnd === -1 ? '' : normalized.slice(headerEnd + 2)

  const blocks = body.split(/\n{2,}/)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length < 2) continue
    const timeLineIndex = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIndex === -1) continue

    // VTT 允许 cue 标识行（在时间轴之前），需要保留
    const cueId = lines.slice(0, timeLineIndex)
    const meta = [...cueId, lines[timeLineIndex] ?? ''].join('\n')
    const text = lines.slice(timeLineIndex + 1).join('\n')
    if (!text.trim()) continue

    cues.push({ index: cues.length, meta, text })
  }

  return { format: 'vtt', cues, header, footer: '' }
}

function serializeVtt(parsed: ParsedSubtitle, translations: Map<number, string>): string {
  const body = parsed.cues
    .map((cue) => {
      const text = translations.get(cue.index) ?? cue.text
      return `${cue.meta}\n${text}`
    })
    .join('\n\n')
  return `${parsed.header}\n\n${body}\n`
}

// ---------- ASS ----------

const ASS_TIME = /^Dialogue:\s*/

function parseAss(content: string): ParsedSubtitle {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const cues: SubtitleCue[] = []
  let firstDialogue = -1
  let lastDialogue = -1

  lines.forEach((line, i) => {
    if (!ASS_TIME.test(line)) return
    if (firstDialogue === -1) firstDialogue = i
    lastDialogue = i

    // Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,文本
    const payload = line.replace(ASS_TIME, '')
    const parts = payload.split(',')
    if (parts.length < 10) return
    const text = parts.slice(9).join(',')
    if (!text.trim()) return

    const meta = parts.slice(0, 9).join(',')
    cues.push({ index: cues.length, meta, text })
  })

  const header = firstDialogue === -1 ? normalized : lines.slice(0, firstDialogue).join('\n')
  const footer = lastDialogue === -1 ? '' : lines.slice(lastDialogue + 1).join('\n')

  return { format: 'ass', cues, header, footer }
}

function serializeAss(parsed: ParsedSubtitle, translations: Map<number, string>): string {
  const body = parsed.cues
    .map((cue) => {
      const text = translations.get(cue.index) ?? cue.text
      return `Dialogue: ${cue.meta},${text}`
    })
    .join('\n')

  const parts = [parsed.header.replace(/\n$/, ''), body]
  if (parsed.footer.trim()) parts.push(parsed.footer.replace(/^\n/, ''))
  return parts.join('\n')
}

// ---------- LRC ----------

const LRC_TAG = /^((?:\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/

function parseLrc(content: string): ParsedSubtitle {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const cues: SubtitleCue[] = []
  const other: string[] = []

  for (const line of lines) {
    const m = LRC_TAG.exec(line.trim())
    if (!m) {
      if (line.trim()) other.push(line)
      continue
    }
    const meta = m[1] ?? ''
    const text = (m[2] ?? '').trim()
    if (!text) continue
    cues.push({ index: cues.length, meta, text })
  }

  return { format: 'lrc', cues, header: other.join('\n'), footer: '' }
}

function serializeLrc(parsed: ParsedSubtitle, translations: Map<number, string>): string {
  const header = parsed.header.trim() ? `${parsed.header}\n` : ''
  const body = parsed.cues
    .map((cue) => `${cue.meta}${translations.get(cue.index) ?? cue.text}`)
    .join('\n')
  return `${header}${body}\n`
}

/**
 * 合并双语字幕：把译文追加到原文下方（同一条字幕内换行）。
 * 这是「双语字幕」的常见形态，播放器支持 \N 换行。
 */
export function mergeBilingual(
  parsed: ParsedSubtitle,
  translations: Map<number, string>,
): Map<number, string> {
  const merged = new Map<number, string>()
  for (const cue of parsed.cues) {
    const translation = translations.get(cue.index)
    if (!translation) continue
    const separator = parsed.format === 'ass' ? '\\N' : '\n'
    merged.set(cue.index, `${cue.text}${separator}${translation}`)
  }
  return merged
}
