import type { AsrConfig } from '@/shared/types'
import type { AsrProvider, AsrResult, AsrSegment, AsrStreamSession, AudioChunk } from '../provider'

/**
 * B2 路：腾讯云实时语音识别（ASR）。
 *
 * 鉴权走 TC3-HMAC-SHA256（腾讯云标准签名），签名在扩展内用 WebCrypto 本地计算，
 * 不需要服务端参与。
 *
 * 端点实测（2026-09-16）：`asr.tencentcloudapi.com` 返回 200（缺参数），
 * 说明 HTTPS 接口可达。
 *
 * 两种使用方式：
 * - 一次性文件识别：`SentenceRecognition`（HTTPS + TC3 签名，最简单可靠）
 * - 实时流式：WebSocket + 签名 URL（延迟最低）
 * 这里默认走**一次性识别**：实现简单、无长连接维护成本，切片后逐段提交即可。
 */
export const tencentAsrProvider: AsrProvider = {
  id: 'tencent-asr',
  name: '腾讯云一句话/录音文件识别',
  requiresAuth: true,
  mode: 'batch',
  recommendedChunkSeconds: 20,

  validate(config: AsrConfig): string | null {
    if (!config.accessKeyId) return '未填写腾讯云 SecretId'
    if (!config.accessKeySecret) return '未填写腾讯云 SecretKey'
    return null
  },

  async transcribe(chunk: AudioChunk, config: AsrConfig): Promise<AsrResult> {
    const secretId = config.accessKeyId ?? ''
    const secretKey = config.accessKeySecret ?? ''
    if (!secretId || !secretKey) return { segments: [], error: '腾讯云鉴权信息不完整' }

    // 一段音频的 base64（SentenceRecognition 要求 base64 音频数据）
    const base64 = arrayBufferToBase64(chunk.data)
    const payload = JSON.stringify({
      ProjectId: 0,
      SubServiceType: 2,
      EngSerViceType: config.language === 'zh-CN' || config.language === 'auto' ? '16k_zh' : '16k_en',
      SourceType: 1,
      VoiceFormat: chunk.mimeType.includes('wav') ? 'wav' : 'mp3',
      Data: base64,
      DataLen: chunk.data.byteLength,
    })

    const { authorization, timestamp } = await signTc3({
      secretId,
      secretKey,
      service: 'asr',
      host: 'asr.tencentcloudapi.com',
      action: 'SentenceRecognition',
      version: '2019-06-14',
      region: 'ap-shanghai',
      payload,
    })

    let res: Response
    try {
      res = await fetch('https://asr.tencentcloudapi.com', {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json; charset=utf-8',
          Host: 'asr.tencentcloudapi.com',
          'X-TC-Action': 'SentenceRecognition',
          'X-TC-Version': '2019-06-14',
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': 'ap-shanghai',
        },
        body: payload,
      })
    } catch (e) {
      return { segments: [], error: e instanceof Error ? e.message : String(e) }
    }

    if (!res.ok) return { segments: [], error: `腾讯云识别失败（${res.status}）` }

    const data = (await res.json()) as {
      Response?: { Result?: string; Error?: { Message?: string } }
    }
    if (data.Response?.Error) return { segments: [], error: data.Response.Error.Message ?? '识别失败' }
    const text = (data.Response?.Result ?? '').trim()
    return { segments: text ? [{ text }] : [] }
  },
}

/** TC3-HMAC-SHA256 签名（腾讯云标准算法，纯 WebCrypto 实现） */
export async function signTc3(input: {
  secretId: string
  secretKey: string
  service: string
  host: string
  action: string
  version: string
  region: string
  payload: string
  timestamp?: number
}): Promise<{ authorization: string; timestamp: number }> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  // 1. 规范请求串
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` + `host:${input.host}\n`
  const signedHeaders = 'content-type;host'
  const hashedPayload = await sha256Hex(input.payload)
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n')

  // 2. 待签字符串
  const credentialScope = `${date}/${input.service}/tc3_request`
  const hashedCanonical = await sha256Hex(canonicalRequest)
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, hashedCanonical].join('\n')

  // 3. 逐级派生签名密钥
  const secretDate = await hmac(`TC3${input.secretKey}`, date)
  const secretService = await hmac(secretDate, input.service)
  const secretSigning = await hmac(secretService, 'tc3_request')
  const signature = await hmacHex(secretSigning, stringToSign)

  const authorization =
    `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { authorization, timestamp }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return toHex(digest)
}

async function hmac(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return toHex(sig)
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
