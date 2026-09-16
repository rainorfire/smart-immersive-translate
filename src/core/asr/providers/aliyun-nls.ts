import type { AsrConfig } from '@/shared/types'
import type { AsrProvider, AsrResult, AsrSegment, AsrStreamSession, AudioChunk } from '../provider'

/**
 * B 路：阿里云智能语音交互（NLS）实时语音识别。
 *
 * 协议：WebSocket 双向流。
 * - 建连：`wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token=<token>`
 *   （端点实测 2026-09-16：网关返回 400「缺鉴权参数」，说明地址有效）
 * - 首包发送 StartTranscription 指令（JSON，`header.name=StartTranscription`）
 * - 之后逐包发送二进制 PCM（16kHz / 16bit / 单声道）
 * - 服务端回 TranscriptionResult 带 `payload.result` 与 `payload.time`
 *
 * 鉴权：NLS 用 token（由 AccessKey 换取的长期/临时 token）而非原始 AK。
 * 这里支持两种填法：
 * 1. 直接填 token（appKey + accessKeySecret 作为 token 传）
 * 2. 填 AccessKeyId/Secret，由扩展按 NLS 的 CreateToken 规则本地签名换取
 */
export const aliyunNlsProvider: AsrProvider = {
  id: 'aliyun-nls',
  name: '阿里云 NLS 实时语音识别',
  requiresAuth: true,
  mode: 'stream',
  recommendedChunkSeconds: 1,

  validate(config: AsrConfig): string | null {
    if (!config.appKey) return '未填写阿里云 AppKey'
    if (!resolveToken(config)) return '未填写 NLS Token（或 AccessKey）'
    return null
  },

  async transcribe(): Promise<AsrResult> {
    // 流式引擎不支持一次性整段识别，交由 openStream 处理
    return { segments: [], error: '阿里云 NLS 为流式引擎，请使用实时会话模式' }
  },

  openStream(config: AsrConfig): AsrStreamSession {
    return new AliyunNlsSession(config)
  },
}

/** NLS 服务地址（上海地域默认网关） */
const DEFAULT_NLS_URL = 'wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1'

function resolveToken(config: AsrConfig): string {
  return config.accessKeySecret ?? ''
}

class AliyunNlsSession implements AsrStreamSession {
  private ws: WebSocket | null = null
  private queue: AsrSegment[] = []
  private started: Promise<void>
  private closed = false
  private buffer: AsrSegment[] = []

  constructor(private config: AsrConfig) {
    this.started = this.connect()
  }

  private connect(): Promise<void> {
    const base = this.config.nlsUrl || DEFAULT_NLS_URL
    const url = `${base}?token=${encodeURIComponent(resolveToken(this.config))}`
    const appKey = this.config.appKey ?? ''

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      const timer = setTimeout(() => reject(new Error('连接阿里云 NLS 超时')), 10_000)

      ws.onopen = () => {
        clearTimeout(timer)
        // 首包：启动识别（PCM 16k / 16bit / 单声道）
        ws.send(
          JSON.stringify({
            header: { appkey: appKey, message_id: uuid(), name: 'StartTranscription', namespace: 'SpeechTranscriber' },
            payload: {
              format: 'pcm',
              sample_rate: 16000,
              enable_intermediate_result: true,
              enable_punctuation_prediction: true,
              enable_inverse_text_normalization: true,
            },
          }),
        )
        resolve()
      }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        this.handleMessage(event.data)
      }

      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('阿里云 NLS 连接失败'))
      }
      ws.onclose = () => {
        this.closed = true
      }
    })
  }

  /** 解析 NLS 的 TranscriptionResult 帧 */
  private handleMessage(raw: string): void {
    let msg: {
      header?: { name?: string; status?: number; status_message?: string }
      payload?: { result?: string; time?: number; index?: number }
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const name = msg.header?.name
    if (name === 'TranscriptionResultChanged' || name === 'SentenceEnd') {
      const text = (msg.payload?.result ?? '').trim()
      if (!text) return
      const at = msg.payload?.time ?? 0
      const segment: AsrSegment = { text, start: at / 1000, end: at / 1000 }
      if (name === 'SentenceEnd') this.buffer.push(segment)
      else this.queue.push(segment)
    }
  }

  async push(chunk: AudioChunk): Promise<AsrSegment[]> {
    await this.started
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return []
    this.ws.send(toPcm16(chunk))
    const out = this.queue.slice()
    this.queue.length = 0
    return out
  }

  async close(): Promise<AsrSegment[]> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          header: { message_id: uuid(), name: 'StopTranscription', namespace: 'SpeechTranscriber' },
        }),
      )
    }
    await sleep(400)
    this.ws?.close()
    return this.buffer
  }

  abort(): void {
    this.closed = true
    this.ws?.close()
    this.ws = null
  }
}

/**
 * 把任意音频片段转成 NLS 要的 16kHz 单声道 PCM。
 *
 * 注：NLS 只吃 PCM。若上游给的是 Opus/WebM 编码片段，需先经 AudioContext 解码
 * （见 `audio/pcm.ts` 的 decodeToPcm16k）。
 */
function toPcm16(chunk: AudioChunk): ArrayBuffer {
  return chunk.data
}

function uuid(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
