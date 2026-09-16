# BiLens / 笔镜

自研浏览器双语翻译扩展。**TypeScript + Vite(WXT) + Manifest V3**，代码全部自研（6016 行 / 42 个文件）。

> 包名 `bilens`，扩展名 `BiLens - 双语网页翻译`。

## 一、参考对象与边界

| 对象 | 位置 | 许可 | 怎么用 |
|---|---|---|---|
| 官方归档开源版 0.0.41 | `../old-immersive-translate/` | MPL-2.0 | 可读、可参考、可复用（须遵守 MPL） |
| 1.33.1 反编译归档 | `../reverse-immersive-translate/` | 闭源 | **仅供架构/行为研究**，禁止复制代码 |

> 1.33.1 为闭源商业软件，其反编译原料**不进入本工程**，
> 也不作为构建依赖或源码来源。详见 `../reverse-immersive-translate/README.md`。

## 二、目录

```
README.md                  本文件
docs/technical-design.md   技术方案（功能清单/架构/选型/风险）
src/
  entrypoints/   background | guard.content | main | offscreen.unlisted
                 pdf.unlisted | popup | options
  core/          engine（引擎适配层）| translate（分段/并发/重试/缓存）
                 dom（抽取/门禁）| render（双语渲染）| offscreen（OCR 调度）
  features/      input | hover | selection | subtitle | epub | file
                 image | pdf | video
  rules/sites/   站点规则表（45 条）
  shared/        config | types | languages
public/          inject.css | tesseract/ | pdf/
```

## 三、技术栈（已核实版本）

- 脚手架：`WXT 0.21.4`（Vite 内核，MV3 + 多浏览器）
- 引擎层：自研 Provider 适配层，OpenAI 兼容协议为一等公民
- 缓存：`chrome.storage.local` + 内存 LRU，键 `sha256(text+sl+tl+engine)`
- OCR：`tesseract.js 7.0.0`（跑 offscreen document，识别资源本地化）
- PDF：`pdfjs-dist 6.3.289`
- EPUB：`epubjs 0.3.93`（解包/重打包另用 `jszip 3.10.2`）
- UI：原生 TS + CSS 变量，不引框架

**安全说明**：译文一律经 `textContent` 写入 DOM，不解析 HTML，
从根上避免注入类问题（比「先插入再净化」更彻底）。

## 四、功能清单（16 项，全部已实现）

| # | 功能 | 入口 |
|---|---|---|
| 1 | 网页整页双语翻译 | 弹窗 / `Alt+A` / 右键 |
| 2 | 动态内容增量翻译 | 自动（MutationObserver，500ms 节流） |
| 3 | 仅译文模式 | 弹窗 / `Alt+W` / 右键 |
| 4 | 多引擎适配层 | 弹窗 / 设置页（bing + OpenAI 兼容） |
| 5 | 站点规则系统 | 自动（45 条规则） |
| 6 | 双语样式主题（18 种） | 设置页 |
| 7 | 快捷键组 | `Alt+A` / `Alt+W` / `Alt+I` / `Alt+S` |
| 8 | 右键菜单 | 翻译本页 / 仅译文 / 输入框 / PDF / 视频字幕 / AI 字幕 / 图片 |
| 9 | 输入框翻译 | `Alt+I` / 右键 |
| 10 | 鼠标悬停翻译 | 设置页开关 |
| 11 | 划词翻译 | 设置页开关 |
| 12 | EPUB 翻译 | 拖入 `.epub` |
| 13 | 字幕文件翻译（srt/vtt/ass/lrc） | 拖入字幕文件 |
| 14 | 图片翻译（OCR） | `Alt` + 点击图片 |
| 15 | PDF 页内对照翻译 | 右键 PDF 链接 → 内置查看器 |
| 16 | 视频双语字幕 | `Alt+S` / 右键 / 自动接入 |
| 17 | **视频 AI 字幕（语音识别）** | 右键菜单 / 弹窗按钮（无字幕轨的视频靠它转写） |

> 快捷键只声明了 4 条 —— Chrome 对 `commands.suggested_key` 有**上限 4 条**，
> 超出会让整个扩展被拒载（`Too many shortcuts specified`，实测踩过）。
> 因此第 17 项 AI 字幕的入口是右键菜单与弹窗按钮，不再占用全局快捷键。

## 五、引擎

默认引擎为 `bing`（免费、无需 Key）。LLM 引擎统一走 OpenAI 兼容协议，
内置 8 家国内厂商预设 + OpenRouter + 本地 Ollama：

DeepSeek、Kimi、通义（阿里百炼）、智谱 GLM、硅基流动、
火山方舟、百度千帆、阶跃星辰。

## 五之二、语音翻译（AI 字幕）

**两套配置完全解耦**：文本翻译走「翻译引擎」区块（`config.engine`），
语音翻译走独立的「语音翻译（AI 字幕）」区块（`config.asr`）。
换 ASR 引擎不影响文本翻译，反之亦然。

三条识别路线都支持：

| 路线 | 引擎 | 鉴权 | 特点 |
|---|---|---|---|
| A | `openai-asr`：OpenAI 兼容 `/audio/transcriptions` | 复用文本翻译的 Key | 硅基流动 SenseVoice / 通义 / Whisper 均可，**改动最小** |
| B | `aliyun-nls`：阿里云 NLS 实时识别 | AppKey + Token | WebSocket 流式，国内延迟最低 |
| B2 | `tencent-asr`：腾讯云语音识别 | SecretId / SecretKey | TC3-HMAC-SHA256 签名，扩展内用 WebCrypto 本地计算 |
| C | `local-whisper`：浏览器内 Whisper | 免 Key | 离线可用；运行时库需按需安装（见下） |

**数据流**

```
内容脚本 → SW：chrome.tabCapture.getMediaStreamId（只有 SW 能调）
        → 离屏文档：getUserMedia 取流 + 切片（复用既有 offscreen 机制）
        → 片段回推 SW → 回推标签页 → ASR 识别 → 文本翻译（复用既有链路与缓存）
        → 字幕覆盖层渲染（复用 SubtitleOverlay）
```

**三个必须知道的平台约束**（都实测确认过）：

1. **必须先「调用扩展」**：Chrome 要求用户先点过扩展图标 / 右键菜单 / 快捷键，
   才允许捕获标签页音频，否则报 `Extension has not been invoked for the current page`。
   扩展已把这条英文报错翻译成可照做的中文提示。
2. **C 路按需安装运行时**：`@huggingface/transformers` + `onnxruntime-web` 若打进
   主 bundle，会把包体从 14MB 顶到 **140MB**（wasm 被 base64 内联）；而 MV3 的 CSP
   又禁止从 CDN 加载远程代码。两条夹击下 C 路只能走「随扩展分发 + 按需安装」：

   ```bash
   node scripts/install-whisper-runtime.mjs   # 拷运行时到 public/whisper（约 13MB）
   npx wxt build                              # 重新构建后重新加载扩展
   ```

   没装时选 C 路会得到一条中文提示（告诉你去跑上面那条命令），
   而不是模块解析堆栈。已实测：装好后在扩展上下文里 `import` 成功，
   返回 `version 4.2.0`、`pipeline` 可用（MV3 CSP 合规）。
3. **`tabCapture` 是新增的敏感权限**，安装/更新时 Chrome 会多一条提示。

## 六、开发

```bash
pnpm install
npx wxt prepare
npx tsc --noEmit     # 类型检查
npx wxt build        # 构建到 .output/chrome-mv3
npx wxt zip          # 打包成可安装的 zip（.output/bilens-<ver>-chrome.zip）
npx wxt dev          # 开发模式

# 可选：启用 C 路（本地 Whisper 语音识别）的运行时
node scripts/install-whisper-runtime.mjs
```

装载：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选 `.output/chrome-mv3`

图标重绘：`python3 scripts/make_icons.py`（纯代码生成，不依赖外部素材）

## 七、打包分发

```bash
npx wxt zip
```

产物：`.output/bilens-<version>-chrome.zip`（约 7.8 MB；若装了 C 路运行时约 11 MB）。

**上架前必查两件事**（都已通过 Chrome 官方 `--pack-extension` 校验）：

1. `manifest.json` 必须在 zip **根目录**，不能套一层文件夹
2. 声明了 `default_locale` 就**必须**有对应的 `_locales/<locale>/messages.json`，
   否则 Chrome 报 `_locales subtree is missing` 并拒绝加载

## 七之二、网页译文的两条实测结论

「译文样式与原文一致」「超链接保持不变」是两条硬需求，实现要点：

1. **按 `<br>` 分段**：`<br>` 是作者显式写下的换行（X 推文、歌词、地址块都靠它），
   旧实现把它折叠成空格 → 整段挤成一坨（实测：原文 10 个 `<br>`，译文 0 个）。
   现在按它切段，且行内元素（如 `<span>第一行<br>第二行</span>`）也能正确拆行。
2. **样式快照**：原文的真实样式常设在**内层**元素上（X 推文正文挂在内层 span，
   外层容器只有默认值）。靠 `inherit` 继承会拿到外层默认样式（实测差 2px、颜色偏亮）。
   现在渲染时把正文节点的计算样式写成 `--bilens-src-*` 变量，主题仍可覆盖。

顺带修掉：引擎会把时间戳的 `00:00` 翻成全角 `00：00`，已在译文后处理里还原。

## 八、不做的部分

BabelDOC 级保留排版 PDF、云端 AI 网关、会员订阅体系、本地 AI 防火墙（PII 脱敏）。

## 九、分析结论索引

架构与交互的调研结论统一存放在 `../reverse-immersive-translate/docs/analysis/`。
