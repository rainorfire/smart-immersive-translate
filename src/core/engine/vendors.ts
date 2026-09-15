/**
 * OpenAI 兼容厂商预设表。
 * 全部端点于 2026-09-15 实测存在（返回 401/403 表示需鉴权，符合预期）。
 */

export interface VendorPreset {
  id: string
  /** 展示名 */
  name: string
  baseUrl: string
  /** 默认模型 */
  model: string
  /** 常见可选模型，供设置页下拉 */
  models: string[]
  /** 申请 Key 的地址 */
  consoleUrl?: string
  /** 备注 */
  note?: string
}

export const VENDOR_PRESETS: VendorPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    consoleUrl: 'https://platform.deepseek.com',
    note: '性价比高，中文表现好',
  },
  {
    id: 'moonshot',
    name: 'Kimi 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    consoleUrl: 'https://platform.moonshot.cn',
  },
  {
    id: 'dashscope',
    name: '通义千问 阿里百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
    consoleUrl: 'https://bailian.console.aliyun.com',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    consoleUrl: 'https://open.bigmodel.cn',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    consoleUrl: 'https://cloud.siliconflow.cn',
    note: '聚合多模型，含免费额度',
  },
  {
    id: 'volcengine',
    name: '火山方舟 字节豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',
    models: ['doubao-pro-32k', 'doubao-lite-32k'],
    consoleUrl: 'https://console.volcengine.com/ark',
    note: '模型名需填方舟的接入点 ID',
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-4.0-turbo-8k',
    models: ['ernie-4.0-turbo-8k', 'ernie-speed-128k'],
    consoleUrl: 'https://console.bce.baidu.com/qianfan',
  },
  {
    id: 'stepfun',
    name: '阶跃星辰 StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-1-8k',
    models: ['step-1-8k', 'step-1-32k'],
    consoleUrl: 'https://platform.stepfun.com',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter 聚合',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
    consoleUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama 本地模型',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.1:8b'],
    note: '本地运行，无需 Key，需先启动 Ollama',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    models: [],
    note: '自行填写 Base URL 与模型名',
  },
]

export function getVendor(id: string): VendorPreset | undefined {
  return VENDOR_PRESETS.find((v) => v.id === id)
}
