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
- OCR：`tesseract.js 7.0.0`（跑 offscreen document）
- PDF：`pdfjs-dist 6.3.289`
- EPUB：`epubjs 0.3.93`
- 正文抽取：`@mozilla/readability 0.6.0`
- 安全：`dompurify 3.4.15`

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
| 8 | 右键菜单 | 翻译本页 / 仅译文 / 输入框 / PDF / 视频字幕 / 图片 |
| 9 | 输入框翻译 | `Alt+I` / 右键 |
| 10 | 鼠标悬停翻译 | 设置页开关 |
| 11 | 划词翻译 | 设置页开关 |
| 12 | EPUB 翻译 | 拖入 `.epub` |
| 13 | 字幕文件翻译（srt/vtt/ass/lrc） | 拖入字幕文件 |
| 14 | 图片翻译（OCR） | `Alt` + 点击图片 |
| 15 | PDF 页内对照翻译 | 右键 PDF 链接 → 内置查看器 |
| 16 | 视频双语字幕 | `Alt+S` / 右键 / 自动接入 |

## 五、引擎

默认引擎为 `bing`（免费、无需 Key）。LLM 引擎统一走 OpenAI 兼容协议，
内置 8 家国内厂商预设 + OpenRouter + 本地 Ollama：

DeepSeek、Kimi、通义（阿里百炼）、智谱 GLM、硅基流动、
火山方舟、百度千帆、阶跃星辰。

## 六、开发

```bash
pnpm install
npx wxt prepare
npx tsc --noEmit     # 类型检查
npx wxt build        # 构建到 .output/chrome-mv3
npx wxt dev          # 开发模式
```

装载：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选 `.output/chrome-mv3`

## 七、不做的部分

BabelDOC 级保留排版 PDF、云端 AI 网关、会员订阅体系、本地 AI 防火墙（PII 脱敏）。

## 八、分析结论索引

架构与交互的调研结论统一存放在 `../reverse-immersive-translate/docs/analysis/`。
