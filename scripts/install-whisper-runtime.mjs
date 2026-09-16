#!/usr/bin/env node
/**
 * 安装「本地 Whisper（C 路）」的运行时到 public/whisper/。
 *
 * 背景：为什么 C 路要单独一步？
 * - MV3 的 CSP 禁止执行远程代码，不能像网页那样从 CDN 加载 onnxruntime
 * - 直接把 @huggingface/transformers + onnxruntime-web 打进主 bundle，
 *   实测会把扩展从 14MB 顶到 140MB（wasm 被 base64 内联）
 *
 * 所以运行时**不进主包**，而是由本脚本拷进 public/whisper/，
 * 随扩展分发、只增 ~14MB，且只有选 C 路的用户才需要执行这一步。
 *
 * 用法：
 *   node scripts/install-whisper-runtime.mjs          # 安装（wasm 用 SIMD 版，体积最小）
 *   node scripts/install-whisper-runtime.mjs --check  # 只检查是否已安装
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'whisper')
const checkOnly = process.argv.includes('--check')

const REQUIRED = [
  ['node_modules/@huggingface/transformers/dist/transformers.min.js', 'transformers.min.js'],
]

/** onnxruntime-web 的 wasm 放在 pnpm 的嵌套目录里，这里动态找 */
function findOrtDist() {
  const base = join(root, 'node_modules', '.pnpm')
  if (!existsSync(base)) return null
  const dir = readdirSync(base).find((d) => d.startsWith('onnxruntime-web@'))
  if (!dir) return null
  return join(base, dir, 'node_modules', 'onnxruntime-web', 'dist')
}

/** 体积最小的可用组合：SIMD 版 wasm（约 12MB）+ 对应的 loader */
const ORT_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]

function report(installed) {
  if (!installed) {
    console.log('本地 Whisper 运行时：未安装')
    console.log('如需启用 C 路（离线语音识别），执行：node scripts/install-whisper-runtime.mjs')
    process.exit(checkOnly ? 1 : 0)
  }
  const size = readdirSync(dest).reduce((sum, f) => sum + statSync(join(dest, f)).size, 0)
  console.log(`本地 Whisper 运行时：已安装（${(size / 1024 / 1024).toFixed(1)} MB，${readdirSync(dest).length} 个文件）`)
  process.exit(0)
}

if (checkOnly) {
  report(existsSync(join(dest, 'transformers.min.js')))
}

mkdirSync(dest, { recursive: true })

for (const [from, to] of REQUIRED) {
  const src = join(root, from)
  if (!existsSync(src)) {
    console.error(`缺少依赖文件：${from}\n请先执行 pnpm install`)
    process.exit(1)
  }
  copyFileSync(src, join(dest, to))
  console.log(`✓ ${to}`)
}

const ortDist = findOrtDist()
if (!ortDist) {
  console.error('未找到 onnxruntime-web，请先执行 pnpm install')
  process.exit(1)
}
for (const file of ORT_FILES) {
  const src = join(ortDist, file)
  if (!existsSync(src)) {
    console.warn(`⚠ onnxruntime 缺少 ${file}（跳过）`)
    continue
  }
  copyFileSync(src, join(dest, file))
  console.log(`✓ ${file}`)
}

report(true)
