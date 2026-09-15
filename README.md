# smart-immersive-translate

自研浏览器双语翻译扩展。**TypeScript + Vite(WXT) + Manifest V3**，代码全部自研。

## 一、参考对象与边界

| 对象 | 位置 | 许可 | 怎么用 |
|---|---|---|---|
| 官方归档开源版 0.0.41 | `../old-immersive-translate/` | MPL-2.0 | 可读、可参考、可复用（须遵守 MPL） |
| 1.33.1 反编译归档 | `../reverse-immersive-translate/` | 闭源 | **仅供架构/行为研究**，禁止复制代码 |

> 1.33.1 为闭源商业软件，其反编译原料**不进入本工程**，
> 也不作为构建依赖或源码来源。详见 `../reverse-immersive-translate/README.md`。

## 二、目录

```
README.md    本文件
docs/        工程设计文档（待补：技术方案/模块设计）
src/         源码（待建）
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

## 四、里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | MV3 骨架 + 引擎适配层 + 网页双语翻译 | 3–5 人日 |
| P1 | 站点规则 / 动态内容 / 快捷键 / 输入框 / 悬停翻译 | 5–8 人日 |
| P2 | EPUB + 字幕文件翻译 | 4–6 人日 |
| P3 | 图片翻译（tesseract.js + offscreen） | 5–8 人日 |
| P4 | PDF 页内对照层翻译 | 8–15 人日 |
| P5 | 视频双语字幕 | 8–15 人日 |

**建议首批只做 P0 + P1。**

## 五、不做的部分

BabelDOC 级保留排版 PDF、云端 AI 网关、会员订阅体系、本地 AI 防火墙（PII 脱敏）。

## 六、分析结论索引

架构与交互的调研结论统一存放在 `../reverse-immersive-translate/docs/analysis/`。
