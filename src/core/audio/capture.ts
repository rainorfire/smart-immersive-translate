/**
 * 标签页音频捕获。
 *
 * MV3 标准链路（双上下文协作）：
 *   内容脚本 → SW 调 `chrome.tabCapture.getMediaStreamId({targetTabId})`
 *            → 把 streamId 交给离屏文档
 *            → 离屏文档 `getUserMedia({video:false, audio:{...chromeMediaSource}})`
 *            → 拿到 MediaStream 后切片 → 送 ASR
 *
 * 为什么必须在离屏文档取流：MV3 的 Service Worker 里没有 DOM 与
 * `navigator.mediaDevices`，拿不到 MediaStream。离屏文档是扩展自有的、
 * 有 DOM 的上下文，正好承载这类长生命周期媒体任务（OCR 已在用它）。
 */

/** tabCapture 的音频约束（Chrome 专有字段，类型定义里没有，这里显式声明） */
interface TabCaptureConstraints {
  audio: {
    mandatory: {
      chromeMediaSource: string
      chromeMediaSourceId: string
    }
  }
  video: boolean
}

/** 用 streamId 在离屏文档里取到标签页音频流 */
export async function getTabAudioStream(streamId: string): Promise<MediaStream> {
  const constraints: TabCaptureConstraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  }
  // 类型定义里没带 mandatory 形态，这里走 unknown 转换
  return navigator.mediaDevices.getUserMedia(
    constraints as unknown as MediaStreamConstraints,
  )
}

/**
 * 把标签页音频接回扬声器。
 *
 * 关键：`getUserMedia` 抓到标签页音频后，原标签页的声音会被「接管」而静音。
 * 必须把流再输出到一个 AudioContext，用户才听得到视频原声。
 * 这是 tabCapture 最容易被忽略的一步。
 */
export function keepAudioAudible(stream: MediaStream, ctx: AudioContext): void {
  const source = ctx.createMediaStreamSource(stream)
  source.connect(ctx.destination)
}

/** 音频切片器：把流按固定时长切成 Blob，供 batch 型 ASR 逐段识别 */
export interface AudioSlicerOptions {
  /** 每片时长（秒） */
  chunkSeconds: number
  /** 每片实际开始时刻（秒）由调用方维护 */
  onChunk: (chunk: { blob: Blob; startedAt: number; duration: number }) => void
  /** MIME 类型，默认 webm/opus（Chrome 原生支持、体积小） */
  mimeType?: string
}

export class AudioSlicer {
  private recorder: MediaRecorder | null = null
  private startedAt = 0
  private timer: number | null = null
  private stopped = false

  constructor(private options: AudioSlicerOptions) {}

  /** 开始切片（周期性重启 MediaRecorder，每段时间产出一个完整文件） */
  start(stream: MediaStream): void {
    this.stopped = false
    const mimeType = this.options.mimeType ?? pickMimeType()
    const begin = (): void => {
      if (this.stopped) return
      const parts: BlobPart[] = []
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      this.recorder = recorder
      this.startedAt = performance.now()
      const startedAt = this.startedAt

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) parts.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(parts, { type: mimeType || 'audio/webm' })
        if (blob.size > 0) {
          this.options.onChunk({
            blob,
            startedAt: startedAt / 1000,
            duration: (performance.now() - startedAt) / 1000,
          })
        }
        begin()
      }
      recorder.start()
      this.timer = window.setTimeout(
        () => recorder.stop(),
        this.options.chunkSeconds * 1000,
      )
    }
    begin()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    try {
      if (this.recorder?.state !== 'inactive') this.recorder?.stop()
    } catch {
      // 已停止则忽略
    }
  }
}

/** 选一个浏览器支持的音频编码 */
function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}
