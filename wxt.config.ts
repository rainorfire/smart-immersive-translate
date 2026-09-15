import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  modules: [],
  manifestVersion: 3,
  manifest: {
    name: 'BiLens - 双语网页翻译',
    short_name: 'BiLens',
    description:
      '双语对照网页翻译扩展，支持整页/输入框/悬停翻译，可接入 DeepSeek、Kimi、通义、智谱等主流大模型与免费引擎。',
    default_locale: 'zh_CN',
    permissions: ['storage', 'activeTab', 'contextMenus', 'offscreen', 'scripting'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        // 主体脚本、样式、OCR/PDF 资源需对页面可见，供动态加载
        resources: [
          'main.js',
          'inject.css',
          'pdf/index.html',
          'tesseract/*',
          'ort/*',
        ],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      'toggle-translate-page': {
        suggested_key: { default: 'Alt+A', mac: 'Alt+A' },
        description: '翻译/还原当前页面',
      },
      'toggle-translation-only': {
        suggested_key: { default: 'Alt+W', mac: 'Alt+W' },
        description: '切换仅译文模式',
      },
      'translate-input-box': {
        suggested_key: { default: 'Alt+I', mac: 'Alt+I' },
        description: '翻译输入框',
      },
    },
  },
})
