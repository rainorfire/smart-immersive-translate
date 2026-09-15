import { translateSubtitleFile } from '../subtitle/translate-subtitle'
import { translateEpub } from '../epub/epub-translate'

/**
 * 文件翻译总入口。
 *
 * 支持格式：EPUB 电子书、字幕文件（srt/vtt/ass/lrc）、纯文本。
 * 交互：页面内拖入文件即开始翻译，完成后自动下载。
 */

const OVERLAY_ID = 'bilens-file-overlay'

const EPUB_EXT = ['.epub']
const SUBTITLE_EXT = ['.srt', '.vtt', '.ass', '.ssa', '.lrc']
const TEXT_EXT = ['.txt', '.md']
const ALL_EXT = [...EPUB_EXT, ...SUBTITLE_EXT, ...TEXT_EXT]

export interface FileTranslateOptions {
  source: string
  target: string
  bilingual: boolean
}

export function mountFileDropZone(options: FileTranslateOptions): () => void {
  const onDragOver = (e: DragEvent) => {
    if (!hasSupportedFile(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: DragEvent) => {
    const file = findSupportedFile(e)
    if (!file) return
    e.preventDefault()
    e.stopPropagation()
    void handleFile(file, options)
  }

  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('drop', onDrop, true)

  return () => {
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('drop', onDrop, true)
    document.getElementById(OVERLAY_ID)?.remove()
  }
}

function hasSupportedFile(e: DragEvent): boolean {
  return findSupportedFile(e) !== null
}

function findSupportedFile(e: DragEvent): File | null {
  const files = e.dataTransfer?.files
  if (!files?.length) return null
  for (const file of files) {
    if (ALL_EXT.some((ext) => file.name.toLowerCase().endsWith(ext))) return file
  }
  return null
}

async function handleFile(file: File, options: FileTranslateOptions): Promise<void> {
  const name = file.name.toLowerCase()
  showOverlay(`准备处理 ${file.name}…`, 0)

  try {
    if (EPUB_EXT.some((ext) => name.endsWith(ext))) {
      await handleEpub(file, options)
    } else if (SUBTITLE_EXT.some((ext) => name.endsWith(ext))) {
      await handleSubtitle(file, options)
    } else {
      await handlePlainText(file, options)
    }
  } catch (e) {
    showOverlay(`处理失败：${e instanceof Error ? e.message : String(e)}`, 1, 3500)
  }
}

async function handleEpub(file: File, options: FileTranslateOptions): Promise<void> {
  const buffer = await file.arrayBuffer()
  const result = await translateEpub(buffer, {
    source: options.source,
    target: options.target,
    bilingual: options.bilingual,
    onProgress: (done, total, chapter) => {
      showOverlay(`翻译 EPUB（${done}/${total}）：${chapter}`, total ? done / total : 0)
    },
  })

  downloadBlob(
    new Blob([result.data as BlobPart], { type: 'application/epub+zip' }),
    file.name.replace(/\.epub$/i, '.bilingual.epub'),
  )

  const note = result.failed > 0 ? `，${result.failed} 段失败` : ''
  showOverlay(
    `✓ EPUB 完成：${result.chapters} 章 / ${result.translated}/${result.paragraphs} 段${note}`,
    1,
    4000,
  )
}

async function handleSubtitle(file: File, options: FileTranslateOptions): Promise<void> {
  const content = await file.text()
  const result = await translateSubtitleFile(file.name, content, {
    source: options.source,
    target: options.target,
    bilingual: options.bilingual,
    onProgress: (done, total) => {
      showOverlay(`翻译字幕（${done}/${total}）…`, total ? done / total : 0)
    },
  })

  downloadBlob(
    new Blob([result.content], { type: 'text/plain;charset=utf-8' }),
    file.name.replace(/(\.[^.]+)$/, '.bilingual$1'),
  )

  const note = result.failed.length > 0 ? `，${result.failed.length} 条失败` : ''
  showOverlay(`✓ 字幕完成：${result.translated}/${result.total} 条${note}`, 1, 3500)
}

async function handlePlainText(file: File, options: FileTranslateOptions): Promise<void> {
  const text = await file.text()
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  if (paragraphs.length === 0) {
    showOverlay('文件内容为空', 1, 2500)
    return
  }

  const output: string[] = []
  const BATCH = 20

  for (let i = 0; i < paragraphs.length; i += BATCH) {
    const batch = paragraphs.slice(i, i + BATCH)
    const items = batch.map((p, k) => ({ id: String(i + k), text: p }))

    try {
      const outcome = (await chrome.runtime.sendMessage({
        type: 'translate',
        items,
        source: options.source,
        target: options.target,
      })) as { translations?: Record<string, string> } | undefined

      batch.forEach((original, k) => {
        const t = outcome?.translations?.[String(i + k)]
        output.push(options.bilingual && t ? `${original}\n${t}` : (t ?? original))
      })
    } catch {
      output.push(...batch)
    }

    showOverlay(
      `翻译文本（${Math.min(i + BATCH, paragraphs.length)}/${paragraphs.length}）…`,
      i / paragraphs.length,
    )
  }

  downloadBlob(
    new Blob([output.join('\n\n')], { type: 'text/plain;charset=utf-8' }),
    file.name.replace(/(\.[^.]+)$/, '.bilingual$1'),
  )
  showOverlay('✓ 文本翻译完成', 1, 3000)
}

function showOverlay(text: string, progress: number, autoHideMs?: number): void {
  let el = document.getElementById(OVERLAY_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = OVERLAY_ID
    el.className = 'bilens-subtitle-overlay'
    const label = document.createElement('div')
    label.className = 'bilens-subtitle-label'
    const bar = document.createElement('div')
    bar.className = 'bilens-subtitle-bar'
    const fill = document.createElement('div')
    fill.className = 'bilens-subtitle-fill'
    bar.appendChild(fill)
    el.append(label, bar)
    document.body.appendChild(el)
  }

  const label = el.querySelector('.bilens-subtitle-label')
  const fill = el.querySelector('.bilens-subtitle-fill')
  if (label) label.textContent = text
  if (fill) (fill as HTMLElement).style.width = `${Math.round(progress * 100)}%`
  if (autoHideMs) window.setTimeout(() => el?.remove(), autoHideMs)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000)
}
