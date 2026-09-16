import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  modules: [],
  vite: () => ({
    build: {
      rollupOptions: {
        // 本地 Whisper（C 路）的运行时按需加载，不参与打包：
        // 它连同 onnxruntime-web 的 wasm 会把包体从 14MB 顶到 140MB（实测）。
        external: ['@huggingface/transformers'],
      },
    },
  }),
  manifestVersion: 3,
  manifest: {
    // 文案走 _locales（已声明 default_locale，必须配套 _locales 目录，
    // 否则 Chrome 直接拒绝加载）
    name: '__MSG_extName__',
    short_name: '__MSG_extShortName__',
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    // tabCapture：捕获标签页音频做语音识别（AI 字幕）必需。
    // 注意：这是新增的敏感权限，Chrome 会在安装/更新时提示。
    permissions: [
      'storage',
      'activeTab',
      'contextMenus',
      'offscreen',
      'scripting',
      'tabCapture',
    ],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        // 主体脚本、样式、OCR/PDF 资源需对页面可见，供动态加载
        resources: [
          'main.js',
          'inject.css',
          'tesseract/*',
          // 本地 Whisper（C 路）：按需安装的运行时，需对扩展页可见
          'whisper/*',
          'offscreen.html',
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
      'toggle-video-subtitle': {
        suggested_key: { default: 'Alt+S', mac: 'Alt+S' },
        description: '翻译视频字幕',
      },
      // 注意：Chrome 对 commands 的 suggested_key 有**上限 4 条**
      // （超出会让整个扩展被拒载，报 "Too many shortcuts specified"）。
      // 现已用满 4 条，因此 AI 字幕不再声明全局快捷键，
      // 入口改为：右键菜单 + popup 按钮 + options 页说明。
      'toggle-speech-subtitle': {
        description: 'AI 字幕（语音识别）',
      },
    },
  },
})
