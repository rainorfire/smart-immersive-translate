# smart-immersive-translate 技术方案

> 状态：待评审
> 目标：功能对齐沉浸式翻译 1.33.1 核心能力，**代码 100% 自研**
> 依据：`../old-immersive-translate/`（MPL-2.0 开源版）、`../reverse-immersive-translate/`（1.33.1 反编译分析）

## 一、边界声明

| 项 | 决定 |
|---|---|
| 可参考 | 开源版代码（MPL-2.0）、反编译产物的**架构与交互设计** |
| 禁止 | 复制 1.33.1 的任何代码进本工程 |
| 设计复用 | 类名契约、消息协议、配置模型等**行为接口**可沿用（非版权对象） |
| 昵称 | 本工程独立品牌，不使用 "Immersive Translate" 名称与图标 |

## 二、功能对齐清单

按「对齐 1.33.1」拆解，共 16 项，分 6 个阶段交付。

| # | 功能 | 对齐源 | 阶段 | 难度 |
|---|---|---|---|---|
| 1 | 网页整页双语翻译 | 老版+新版 | P0 | 中 |
| 2 | 动态内容增量翻译 | 老版+新版 | P0 | 中 |
| 3 | 仅译文模式切换 | 新版 | P0 | 低 |
| 4 | 多引擎适配层 | 新版(30+) | P0 | 中 |
| 5 | 站点规则系统 | 老版(43条) | P1 | 低 |
| 6 | 双语样式主题(18种) | 新版 | P1 | 低 |
| 7 | 快捷键组 | 老版+新版 | P1 | 低 |
| 8 | 右键菜单 | 老版 | P1 | 低 |
| 9 | 输入框翻译 | 新版 | P1 | 低 |
| 10 | 鼠标悬停翻译 | 新版 | P1 | 中 |
| 11 | 划词翻译 | 新版 | P2 | 低 |
| 12 | EPUB 翻译 | 新版 | P2 | 中 |
| 13 | 字幕文件翻译(srt/ass/vtt/lrc) | 新版 | P2 | 中 |
| 14 | 图片翻译(OCR) | 新版 | P3 | 高 |
| 15 | PDF 页内对照翻译 | 新版(降级) | P4 | 高 |
| 16 | 视频双语字幕 | 新版 | P5 | 高 |

### 明确不做

| 项 | 原因 |
|---|---|
| BabelDOC 保留排版 PDF | 依赖服务端重排算力，浏览器内做不到 |
| 云端 AI 网关（`aigw1.*`） | 商业基础设施，自研走「用户自带 Key」 |
| 会员/订阅体系 | 无商业诉求 |
| 本地 AI 防火墙（PII 脱敏） | 依赖其自研 wasm 模型 |
| 漫画翻译 | 与图片翻译同构，P3 完成后按需扩展 |

## 三、技术栈（版本已核实，2026-09-15）

| 层 | 选型 | 版本 | 说明 |
|---|---|---|---|
| 脚手架 | WXT | 0.21.4 | Vite 内核，MV3 + 多浏览器；peer 支持 vite ^8 / TS >=5.4 |
| 构建 | Vite | 8.3.0 | WXT 内置 |
| 语言 | TypeScript | 7.0.2 | |
| 包管理 | pnpm | 10.32.1 | |
| 运行时 | Node | 22.22.3 | |
| PDF | pdfjs-dist | 6.3.289 | |
| OCR | tesseract.js | 7.0.0 | 必须跑 offscreen |
| EPUB | epubjs | 0.3.93 | |
| 正文抽取 | @mozilla/readability | 0.6.0 | |
| 净化 | dompurify | 3.4.15 | 回填译文必须过净化 |

**UI 方案**：核心 UI（popup/options）用原生 TS + CSS 变量，不引入框架。
理由：扩展 UI 体量小，框架会显著抬高包体（对比 1.33.1 的 3.5MB options.js）。
若后续需复杂界面（侧边栏 AI 助手），再局部引入 `svelte 5.57.0`。

## 四、架构设计

### 4.1 参考的核心设计（来自反编译分析）

1. **门禁前置 + 动态注入**：轻量 `content_guard` 在 `document_start` 全 frame 执行，
   判定通过后用 `chrome.runtime.getURL()` **动态 `import()`** 加载主体
   → 好处：主体不进无关页面，省内存、避免污染
2. **iframe 可见性协商**：父子帧 `postMessage` + `IntersectionObserver`
   + 宽高<=1 判定 + 2s 超时兜底 → 隐藏 iframe 不翻译
3. **配置版本戳**：`xxx.add_v.[1.30.2]` 形态支持远端配置按版本增量叠加
   （自研简化为 `schemaVersion` + 迁移函数，不引入远端下发）
4. **引擎长度参数**：适配层必须暴露 `maxTextGroupLengthPerRequest`
   与 `maxTextLengthPerRequest`，因为各引擎 batch 能力差异巨大
5. **DOM 契约**：`immersive-translate-target-*` 类名体系 + CSS 变量主题

### 4.2 进程模型

| 上下文 | 入口 | 职责 |
|---|---|---|
| Service Worker | `entrypoints/background` | 引擎调度、缓存、配置、快捷键、菜单 |
| 内容门禁 | `entrypoints/content-guard` | 前置判定，决定是否注入主体 |
| 内容主体 | `entrypoints/content`（动态导入） | DOM 分析、分段、双语渲染 |
| 离屏文档 | `entrypoints/offscreen` | OCR / wasm 重计算 |
| 弹窗 | `entrypoints/popup` | 快捷开关、引擎切换 |
| 设置页 | `entrypoints/options` | 全量配置 |

**关键约束**：MV3 Service Worker 无常驻，所有状态必须外置到
`chrome.storage.local`，禁止依赖 SW 内存变量。

### 4.3 目录结构

```
src/
  entrypoints/          background | content-guard | content | offscreen | popup | options
  core/
    engine/             适配层 + providers/（每引擎一个文件）
    translate/          分段、批处理、并发控制、重试、缓存
    inject/             双语 DOM 渲染、主题、还原
    dom/                节点遍历、可译性判定、Readability 抽取
  rules/sites/          站点规则（TS 定义 + 内置表）
  features/             input | hover | selection | epub | subtitle | image | pdf | video
  shared/               config、storage、i18n、logger、types
  assets/               styles（CSS 变量主题）
```

### 4.4 引擎适配层接口（草案）

```ts
interface TranslateProvider {
  id: string
  name: string
  maxTextLengthPerRequest: number
  maxTextGroupLengthPerRequest: number
  concurrency: number
  requiresAuth: boolean
  translate(req: TranslateRequest): Promise<TranslateResult>
  detect?(text: string): Promise<string>
}
```

**首批实现（P0）**：`bing`（免费兜底）+ `openai-compatible`（一站式接
DeepSeek / Kimi / 通义 / 智谱 / SiliconFlow / Ollama / OpenRouter）。

**引擎默认值修正**：实测老版默认的 `google` 链路 2026 年已不可达
（`translate.googleapis.com` 返回 000）、`yandex` 403、`deepl` 429，
因此默认引擎设为 `bing`，与 1.33.1 的做法一致。

## 五、执行计划

| 阶段 | 交付物 | 验收标准 | 预估 |
|---|---|---|---|
| P0 | MV3 骨架 + 引擎层 + 网页双语 | 任意英文网页一键出双语，可切原文 | 3–5 人日 |
| P1 | 规则/样式/快捷键/输入框/悬停 | Twitter、Reddit、GitHub 规则命中 | 5–8 人日 |
| P2 | EPUB + 字幕文件 | 一本 EPUB、一份 srt 输出可读 | 4–6 人日 |
| P3 | 图片翻译 | 一张英文海报出中文覆盖层 | 5–8 人日 |
| P4 | PDF 页内对照 | PDF 逐页双语，滚动不卡 | 8–15 人日 |
| P5 | 视频双语字幕 | YouTube 一个视频出双语字幕 | 8–15 人日 |

**建议首批只做 P0 + P1（合计 8–13 人日）**，跑通「日常网页翻译」主场景后
再决定是否投入 P2–P5。

## 六、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 免费引擎随时失效 | 翻译不可用 | 引擎层可插拔，主推用户自配 Key 的 LLM 引擎 |
| MV3 SW 被回收 | 长任务中断 | 长任务下放 offscreen；状态外置 storage；幂等重试 |
| 动态内容导致翻译风暴 | 卡顿 | MutationObserver 节流 + 可见性判定 + 段落上限 |
| 回填译文引入 XSS | 安全 | 译文一律经 DOMPurify 净化后再入 DOM |
| 站点频繁改版 | 规则失效 | 规则表数据化，支持热更新式维护 |
| 包体膨胀 | 加载慢 | 功能按需动态 import；OCR/PDF 不进主包 |
| 与闭源版同质化 | 法律风险 | 独立命名/图标；代码自研；不复用其资源 |

## 七、待确认事项

**已确认（2026-09-15）**：

| # | 事项 | 决定 |
|---|---|---|
| 1 | 工程目录名 | ✅ 维持 `smart-immersive-translate` |
| 2 | git 初始化 | ✅ 执行，`reverse-immersive-translate/` 进 `.gitignore` |
| 3 | UI 方案 | ✅ 原生 TS + CSS 变量，不引框架 |
| 4 | P0 引擎 | ✅ `bing` + `openai-compatible`，且**必须支持国内主流模型** |
| 5 | 品牌命名 | ✅ 推荐 **BiLens / 笔镜**（npm 与 GitHub 均未占用） |

## 八、品牌命名：BiLens / 笔镜

### 推荐理由

- **Bi** = bilingual 双语，**Lens** = 沉浸式阅读的观看隐喻，直指「双语对照」这个核心能力
- 中文「**笔镜**」与 BiLens 谐音，字面是「下笔之镜」——镜子照出原文的另一种语言
- 与 "Immersive Translate" 无任何字面重叠，法律上干净
- npm `bilens` ✅ 未占用、GitHub 用户/组织名 `bilens` ✅ 未占用

### 备选

| 名称 | 中文 | npm 状态 | 备注 |
|---|---|---|---|
| `dualens` | 双镜 | ✅ 未占用 | 双语语义更直白 |
| `babellens` | 巴别镜 | ✅ 未占用 | 巴别塔典故，偏文化向 |
| `lingualens` | 语镜 | ✅ 未占用 | 通用，但少了「双语」的强指向 |

**落地约定**：包名 `bilens`，manifest `name` = `BiLens - 双语网页翻译`，
`short_name` = `BiLens`，图标自绘（不复用任何现有资源）。

## 九、国内主流模型支持矩阵（2026-09-15 实测）

八个国内厂商的端点**全部为 OpenAI 兼容协议**，可用同一适配器接入：

| 厂商 | Base URL | 连通性 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | ✅ 401（端点存在） |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` | ✅ 401 |
| 阿里百炼 通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | ✅ 401 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | ✅ 401 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | ✅ 401 |
| 字节 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | ✅ 401 |
| 百度千帆 | `https://qianfan.baidubce.com/v2` | ✅ 403 |
| 阶跃星辰 | `https://api.stepfun.com/v1` | ✅ 401 |

外加通用兜底：`OpenRouter`、以及本地 `Ollama`（`http://localhost:11434/v1`）。

**实现方式**：统一 `openai-compatible` 适配器 + 厂商预设表（base URL + 默认模型），
用户在设置页选厂商、填 Key 即可，无需为每家单独写适配器。
