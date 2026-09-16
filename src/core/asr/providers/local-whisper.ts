import type { AsrConfig } from '@/shared/types'
import type { AsrProvider, AsrResult, AsrSegment, AudioChunk } from '../provider'

/**
 * C 路：浏览器内 Whisper（WASM）。
 *
 * 特点：离线可用、免 Key、不计额度；代价是首次要下载模型 + CPU 推理较慢。
 *
 * 实现选型：`@huggingface/transformers`（transformers.js v3）的
 * `automatic-speech-recognition` 管线，WASM/WebGPU 后端。
 * 模型从 CDN 拉取并按浏览器的 HTTP 缓存长期复用（不打包进扩展，
 * 否则包体会从 7.8MB 涨到上百 MB）。
 *
 * 这里用**动态 import**：用户没选 C 路时，这段代码与 wasm 都不会加载。
 */

/**
 * 运行时代码的加载策略（这是 C 路的现实约束，必须说清）。
 *
 * 两个硬约束把 C 路的实现方式逼到了唯一解：
 * 1. MV3 的 CSP 禁止执行**远程代码**，所以「从 CDN import 库」不可行
 * 2. 直接把 @huggingface/transformers + onnxruntime-web 打进主包，
 *    实测包体从 14MB 涨到 **140MB**（wasm 被 base64 内联进 bundle）
 *
 * 因此运行时**不参与打包**，而是走「按需安装」：
 * 跑 `node scripts/install-whisper-runtime.mjs` 把运行时拷进 `public/whisper/`，
 * 它随扩展分发、在扩展自己的上下文里加载（不违反 MV3 的远程代码禁令），
 * 且只有真正用 C 路的人才会付出这 ~14MB 体积。
 *
 * 没装运行时也能选 C 路 —— 会得到一条中文提示告诉你去跑那条命令，
 * 而不是一堆模块解析堆栈。
 */
const RUNTIME_DIR = 'whisper'
const RUNTIME_ENTRY = `${RUNTIME_DIR}/transformers.min.js`

const MODEL_IDS: Record<string, string> = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
}

export const localWhisperProvider: AsrProvider = {
  id: 'local-whisper',
  name: '本地 Whisper（离线，免 Key）',
  requiresAuth: false,
  mode: 'batch',
  recommendedChunkSeconds: 15,

  validate(): string | null {
    return null
  },

  async transcribe(chunk: AudioChunk, config: AsrConfig): Promise<AsrResult> {
    try {
      const pipe = await getPipeline(config.localModel ?? 'base')

      const audio = await decodeToFloat32(chunk)

      const generateOptions: Record<string, unknown> = {
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      }
      if (config.language && config.language !== 'auto') {
        generateOptions.language = config.language
      }

      const output = (await pipe(audio, generateOptions)) as {
        text?: string
        chunks?: Array<{ timestamp?: [number, number]; text?: string }>
      }

      const chunks = output.chunks ?? []
      if (chunks.length > 0) {
        return {
          segments: chunks
            .map((c) => ({
              text: (c.text ?? '').trim(),
              start: c.timestamp?.[0],
              end: c.timestamp?.[1],
            }))
            .filter((s) => s.text.length > 0),
        }
      }
      const text = (output.text ?? '').trim()
      return { segments: text ? [{ text }] : [] }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // 运行时没装时给中文可操作提示，别把模块解析报错直接抛给用户
      const notInstalled =
        message.includes('Failed to resolve module') ||
        message.includes('Cannot find') ||
        message.includes('ERR_FILE_NOT_FOUND') ||
        message.includes('Failed to fetch dynamically imported module')
      if (notInstalled) {
        return {
          segments: [],
          error:
            '本地 Whisper 运行时未安装：在工程目录执行 `node scripts/install-whisper-runtime.mjs` 后重新加载扩展；' +
            '或改用 A 路（OpenAI 兼容）',
        }
      }
      return { segments: [], error: message }
    }
  },
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let cachedPipe: any = null
let cachedModelKey = ''

/** 懒加载识别管线（首次调用会下载模型，之后复用） */
async function getPipeline(model: string): Promise<any> {
  const modelId = MODEL_IDS[model] ?? MODEL_IDS['base'] ?? 'onnx-community/whisper-base'
  if (cachedPipe && cachedModelKey === modelId) return cachedPipe

  // 从扩展自身目录加载运行时（变量说明符让构建器不打包它）
  const entryUrl = chrome.runtime.getURL(RUNTIME_ENTRY)
  const mod: any = await import(/* @vite-ignore */ entryUrl)
  mod.env.allowLocalModels = false
  // onnxruntime 的 wasm 也从扩展内取，避免它回落到 CDN
  if (mod.env?.backends?.onnx?.wasm) {
    mod.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL(`${RUNTIME_DIR}/`)
  }
  cachedPipe = await mod.pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    device: 'wasm',
  })
  cachedModelKey = modelId
  return cachedPipe
}

/**
 * 把音频片段解码为 16kHz 单声道 Float32（Whisper 的输入要求）。
 * 用 OfflineAudioContext 由浏览器原生解码，兼容 webm/opus、wav、mp4。
 */
export async function decodeToFloat32(chunk: AudioChunk): Promise<Float32Array> {
  if (chunk.sampleRate === 16000) return new Float32Array(chunk.data)

  const ctx = new OfflineAudioContext(1, 16000, 16000)
  const decoded = await ctx.decodeAudioData(chunk.data.slice(0))
  const source = ctx.createBufferSource()
  source.buffer = decoded
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}

void ((): AsrSegment[] => [])
