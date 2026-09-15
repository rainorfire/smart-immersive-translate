import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  modules: [],
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
    permissions: ['storage', 'activeTab', 'contextMenus', 'offscreen', 'scripting'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        // 主体脚本、样式、OCR/PDF 资源需对页面可见，供动态加载
        resources: [
          'main.js',
          'inject.css',
          'tesseract/*',
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
    },
  },
})
