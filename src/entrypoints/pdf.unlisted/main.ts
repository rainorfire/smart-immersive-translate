import { loadConfig } from '@/shared/config'
import { PdfViewer } from '@/features/pdf/pdf-viewer'
import type { PdfLayoutMode } from '@/features/pdf/pdf-translate'

/**
 * PDF 翻译查看器页面入口。
 *
 * 三种打开方式：
 * 1. 右键 PDF 链接 → 「用 BiLens PDF 翻译打开」
 * 2. 直接访问 pdf.html?file=<原始 URL>
 * 3. 页面内拖入 / 选择本地 PDF 文件
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`缺少元素 #${id}`)
  return el as T
}

const viewerEl = $<HTMLElement>('viewer')
const statusEl = $<HTMLElement>('status')
const pageInfo = $<HTMLElement>('page-info')
const zoomInfo = $<HTMLElement>('zoom-info')
const modeSelect = $<HTMLSelectElement>('mode')
const prevBtn = $<HTMLButtonElement>('prev')
const nextBtn = $<HTMLButtonElement>('next')
const stopBtn = $<HTMLButtonElement>('stop')

let translatingAll = false

const viewer = new PdfViewer(viewerEl, {
  onStatus: (text) => {
    statusEl.textContent = text
  },
})

async function init(): Promise<void> {
  bindControls()
  trackVisiblePage()

  // 应用设置页里的默认显示模式
  const config = await loadConfig()
  modeSelect.value = config.pdfLayoutMode
  viewer.setMode(config.pdfLayoutMode)

  const params = new URLSearchParams(location.search)
  const fileUrl = params.get('file')
  if (fileUrl) {
    await loadFromUrl(fileUrl)
  } else {
    mountDropZone()
  }
}

function mountDropZone(): void {
  const hint = document.createElement('div')
  hint.className = 'drop-hint'
  hint.textContent = '把 PDF 文件拖到这里，或点击选择文件'

  const pick = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      await loadBuffer(await file.arrayBuffer(), file.name)
    })
    input.click()
  }

  hint.addEventListener('click', pick)
  viewerEl.appendChild(hint)
  updateNavEnabled()

  document.addEventListener('dragover', (e) => {
    e.preventDefault()
    hint.classList.add('drop-hint-active')
  })
  document.addEventListener('dragleave', () => hint.classList.remove('drop-hint-active'))
  document.addEventListener('drop', async (e) => {
    e.preventDefault()
    hint.classList.remove('drop-hint-active')
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    hint.remove()
    await loadBuffer(await file.arrayBuffer(), file.name)
  })
}

async function loadFromUrl(url: string): Promise<void> {
  statusEl.textContent = '加载中…'
  try {
    const res = await fetch(decodeURIComponent(url))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await loadBuffer(await res.arrayBuffer())
  } catch (e) {
    statusEl.textContent = `加载失败：${e instanceof Error ? e.message : String(e)}`
    mountDropZone()
  }
}

async function loadBuffer(data: ArrayBuffer, name?: string): Promise<void> {
  viewerEl.querySelector('.drop-hint')?.remove()
  try {
    statusEl.textContent = '解析中…'
    await viewer.load(data)
    document.title = name ? `${name} - BiLens PDF` : 'BiLens PDF 翻译'
    updatePageInfo()
    updateNavEnabled()
  } catch (e) {
    statusEl.textContent = `解析失败：${e instanceof Error ? e.message : String(e)}`
  }
}

let visiblePage = 1

/** 滚动时同步当前页显示 */
function trackVisiblePage(): void {
  window.addEventListener(
    'scroll',
    () => {
      const wraps = [...viewerEl.querySelectorAll<HTMLElement>('.page-wrap')]
      const mid = window.innerHeight / 2
      let closest: HTMLElement | undefined
      let minDist = Number.POSITIVE_INFINITY
      for (const wrap of wraps) {
        const rect = wrap.getBoundingClientRect()
        const dist = Math.abs(rect.top + rect.height / 2 - mid)
        if (dist < minDist) {
          minDist = dist
          closest = wrap
        }
      }
      const page = Number(closest?.dataset.page ?? '1')
      if (page !== visiblePage) {
        visiblePage = page
        updatePageInfo()
        updateNavEnabled()
      }
    },
    { passive: true },
  )
}

function updatePageInfo(): void {
  const total = viewer.totalPages
  pageInfo.textContent = total > 0 ? `${visiblePage} / ${total}` : '- / -'
  zoomInfo.textContent = `${Math.round(viewer.currentScale * 100)}%`
}

function updateNavEnabled(): void {
  const total = viewer.totalPages
  prevBtn.disabled = total === 0 || visiblePage <= 1
  nextBtn.disabled = total === 0 || visiblePage >= total
}

function bindControls(): void {
  prevBtn.addEventListener('click', () => {
    if (visiblePage <= 1) return
    visiblePage -= 1
    viewer.scrollToPage(visiblePage)
    updatePageInfo()
    updateNavEnabled()
  })

  nextBtn.addEventListener('click', () => {
    if (visiblePage >= viewer.totalPages) return
    visiblePage += 1
    viewer.scrollToPage(visiblePage)
    updatePageInfo()
    updateNavEnabled()
  })

  $('zoom-in').addEventListener('click', () => {
    viewer.setScale(viewer.currentScale + 0.2)
    updatePageInfo()
  })
  $('zoom-out').addEventListener('click', () => {
    viewer.setScale(viewer.currentScale - 0.2)
    updatePageInfo()
  })
  $('zoom-reset').addEventListener('click', () => {
    viewer.setScale(1.4)
    updatePageInfo()
  })

  modeSelect.addEventListener('change', () => {
    viewer.setMode(modeSelect.value as PdfLayoutMode)
  })

  $('translate-page').addEventListener('click', async () => {
    statusEl.textContent = '翻译本页…'
    await viewer.translatePage(visiblePage)
    statusEl.textContent = `第 ${visiblePage} 页完成`
  })

  $('translate-all').addEventListener('click', async () => {
    if (translatingAll || viewer.totalPages === 0) return
    translatingAll = true
    stopBtn.hidden = false
    try {
      await viewer.translateAll((page, total) => {
        statusEl.textContent = `翻译中 ${page}/${total}…`
      })
    } finally {
      translatingAll = false
      stopBtn.hidden = true
    }
  })

  stopBtn.addEventListener('click', () => {
    translatingAll = false
    viewer.abort()
    statusEl.textContent = '已中止（已完成的页面保留）'
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevBtn.click()
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') nextBtn.click()
    else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) $('zoom-in').click()
    else if ((e.metaKey || e.ctrlKey) && e.key === '-') $('zoom-out').click()
  })
}

void init()
