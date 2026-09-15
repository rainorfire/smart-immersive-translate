import type { SiteRule } from './types'

/**
 * 内置站点规则库。
 *
 * 覆盖官方归档开源版的全部规则，并做了扩充。
 * 规则只声明「哪些区域是正文」，不做任何翻译逻辑。
 */
export const SITE_RULES: SiteRule[] = [
  // ---------- 社交 / 资讯流 ----------
  {
    name: 'twitter',
    hostname: ['twitter.com', 'x.com', 'tweetdeck.twitter.com', 'mobile.twitter.com'],
    selectors: [
      '[data-testid="tweetText"]',
      '.tweet-text',
      '.js-quoted-tweet-text',
      '[data-testid="card.layoutSmall.detail"] > div:nth-child(2)',
      '[data-testid="card.layoutLarge.detail"] > div:nth-child(2)',
    ],
    excludeSelectors: ['[data-testid="sidebarColumn"]', 'nav'],
    detectLanguage: true,
  },
  {
    name: 'facebook',
    hostname: 'www.facebook.com',
    selectors: ['[data-ad-preview="message"]', '[role="article"]', '.userContent'],
    excludeSelectors: ['[role="banner"]', '[role="navigation"]'],
    detectLanguage: true,
  },
  {
    name: 'linkedin',
    hostname: ['www.linkedin.com', 'linkedin.com'],
    selectors: ['.feed-shared-update-v2__description', '.attributed-text-segment-list__content'],
    excludeSelectors: ['.global-nav', '.scaffold-layout-toolbar'],
    detectLanguage: true,
  },
  {
    name: 'reddit-new',
    hostname: ['www.reddit.com', 'reddit.com'],
    selectors: ['h1', '[data-click-id=body] h3', '[data-click-id=background] h3', 'shreddit-post'],
    containerSelectors: [
      '[data-testid=comment]',
      '[data-adclicklocation=media]',
      '.Comment__body',
      'faceplate-batch .md',
    ],
    detectLanguage: true,
  },
  {
    name: 'reddit-old',
    hostname: 'old.reddit.com',
    selectors: ['p.title > a'],
    containerSelectors: ['[role=main] .md-container', '.usertext-body'],
    detectLanguage: true,
  },
  {
    name: 'reddit-old-compact',
    regex: 'old\\.reddit\\.com.*/\\.compact$',
    selectors: ['.title > a'],
    containerSelectors: ['.usertext-body'],
    detectLanguage: true,
  },
  {
    name: 'hacker-news',
    hostname: ['news.ycombinator.com', 'hn.algolia.com'],
    selectors: ['.titleline > a', '.comment', '.toptext', 'a.hn-item-title', '.hn-comment-text'],
  },
  {
    name: 'lobsters',
    hostname: 'lobste.rs',
    selectors: ['.u-repost-of', '.story_text', '.comment_text', '.link-title'],
  },
  {
    name: 'producthunt',
    hostname: 'www.producthunt.com',
    selectors: ['[data-test="post-name"]', '[data-test="post-description"]', '[data-test="comment-body"]'],
  },
  {
    name: 'indiehackers',
    hostname: 'www.indiehackers.com',
    selectors: ['.post__title', '.post__body', '.comment__body'],
  },
  {
    name: 'daily-dev',
    hostname: 'app.daily.dev',
    selectors: ['article', '.post-content', '.comment-content'],
  },
  {
    name: 'discord',
    hostname: 'discord.com',
    containerSelectors: ['[class^="messageContent"]', '[class*="messageContent"]'],
    detectLanguage: true,
  },

  // ---------- 新闻媒体 ----------
  {
    name: 'nytimes',
    hostname: 'www.nytimes.com',
    selectors: ['section[name="articleBody"]', 'p.css-at4qt1', 'h1'],
    excludeSelectors: ['header', 'nav', 'aside'],
  },
  {
    name: 'reuters',
    hostname: 'www.reuters.com',
    selectors: ['[data-testid="paragraph-"]', 'article p', 'h1'],
    excludeSelectors: ['nav', 'header'],
  },
  {
    name: 'politico',
    hostname: 'www.politico.com',
    selectors: ['.story-text', '.story-main-content p', 'h1'],
  },
  {
    name: 'newyorker',
    hostname: 'www.newyorker.com',
    selectors: ['[data-testid="BodyWrapper"] p', 'article p', 'h1'],
  },
  {
    name: 'kyivindependent',
    hostname: 'kyivindependent.com',
    selectors: ['article p', '.entry-content p'],
  },
  {
    name: 'seekingalpha',
    hostname: 'seekingalpha.com',
    selectors: ['[data-test-id="article-body"] p', 'article p'],
  },
  {
    name: 'whatsonweibo',
    hostname: 'www.whatsonweibo.com',
    selectors: ['.entry-content p', 'article p'],
  },
  {
    name: 'lowendtalk',
    hostname: ['lowendtalk.com', 'lowendspirit.com'],
    selectors: ['.CommentBody', '.ItemDiscussion', '.Message.userContent'],
  },

  // ---------- 学术 / 出版 ----------
  {
    name: 'arxiv',
    hostname: 'arxiv.org',
    selectors: ['.abstract', '.title', 'blockquote.abstract'],
  },
  {
    name: 'nature',
    hostname: 'www.nature.com',
    selectors: ['[data-component="article-body"] p', 'article p', 'h1'],
  },
  {
    name: 'cell',
    hostname: 'www.cell.com',
    selectors: ['.article-section__content p', '.abstract p'],
  },
  {
    name: 'sciencedirect',
    hostname: 'www.sciencedirect.com',
    selectors: ['.abstract', '.body', 'section'],
  },
  {
    name: 'answers-microsoft',
    hostname: 'answers.microsoft.com',
    selectors: ['.thread-message-content-body', '.thread-title'],
  },

  // ---------- 代码 / 协作 ----------
  {
    name: 'github',
    hostname: ['github.com', 'gist.github.com'],
    selectors: [
      '.markdown-body p',
      '.markdown-body li',
      '.markdown-body h1',
      '.markdown-body h2',
      '.markdown-body h3',
      '.comment-body',
      '.js-issue-title',
      '.gh-header-title',
    ],
    excludeSelectors: ['header', 'nav', '.blob-code', 'pre', 'code'],
  },
  {
    name: 'notion',
    hostname: ['www.notion.so', 'notion.so'],
    selectors: ['.notion-page-content [contenteditable]', '.notion-text-block'],
    excludeSelectors: ['[contenteditable="true"]'],
  },
  {
    name: 'mail-google',
    hostname: 'mail.google.com',
    containerSelectors: ['.a3s', '.ii.gt'],
  },
  {
    name: 'youtube',
    hostname: 'www.youtube.com',
    selectors: ['#description-inline-expander', '#content-text', 'yt-formatted-string#content-text'],
    excludeSelectors: ['#comments', 'ytd-comment-thread-renderer'],
  },

  // ---------- 阅读 / 稍后读 ----------
  {
    name: 'readwise-reader',
    hostname: ['read.readwise.io', 'reader.960960.xyz'],
    selectors: ['.reader-content', 'article'],
  },
  {
    name: 'inoreader',
    hostname: 'www.inoreader.com',
    selectors: ['.article_content', '.article_title'],
  },
  {
    name: 'start-me',
    hostname: 'start.me',
    selectors: ['.widget-content', '.widget-title'],
  },
  {
    name: 'libreddit',
    hostname: ['libreddit.de', 'libreddit.kavin.rocks', 'redlib.catsarch.com'],
    selectors: ['.post_title', '.comment_body'],
    detectLanguage: true,
  },
  {
    name: 'zlibrary',
    regex: 'zlibrary\\w+\\.onion',
    selectors: ['.book-description', 'article'],
  },
  {
    name: '1paragraph',
    hostname: '1paragraph.app',
    selectors: ['.paragraph', 'article p'],
  },
  {
    name: 'readwise',
    hostname: 'readwise.io',
    selectors: ['.reader-content', 'article'],
  },

  // ---------- 创作 / 专栏 ----------
  {
    name: 'medium',
    hostname: ['medium.com', 'towardsdatascience.com'],
    selectors: ['article p', 'article h1', 'article h2'],
    excludeSelectors: ['nav', 'aside', 'footer'],
    detectLanguage: true,
  },
  {
    name: 'substack',
    hostname: 'substack.com',
    regex: '\\.substack\\.com',
    selectors: ['.available-content p', '.post-title'],
  },
  {
    name: 'getrevue',
    hostname: 'www.getrevue.co',
    selectors: ['.issue-content', '.issue-title'],
  },
  {
    name: 'urbandictionary',
    hostname: 'www.urbandictionary.com',
    selectors: ['.meaning', '.example'],
  },
  {
    name: 'wikipedia',
    hostname: ['en.wikipedia.org', 'de.wikipedia.org', 'ja.wikipedia.org', 'zh.wikipedia.org'],
    selectors: ['#mw-content-text p', '#mw-content-text li', '.mw-parser-output p'],
    excludeSelectors: ['.mw-editsection', 'nav', '.infobox'],
  },
  {
    name: 'quora',
    hostname: 'www.quora.com',
    selectors: ['.q-box .qt_read_only', '.qtext'],
  },
  {
    name: 'stack-overflow',
    hostname: [
      'stackoverflow.com',
      'superuser.com',
      'serverfault.com',
      'askubuntu.com',
      'math.stackexchange.com',
    ],
    selectors: ['.s-prose p', '.s-prose li', '.question-hyperlink'],
    excludeSelectors: ['pre', 'code', '.post-taglist'],
  },
  {
    name: 'dev-to',
    hostname: 'dev.to',
    selectors: ['#article-body p', '.crayons-article__header__meta'],
  },
  {
    name: 'hashnode',
    hostname: 'hashnode.dev',
    regex: '\\.hashnode\\.dev',
    selectors: ['.prose p', 'article p'],
  },
]
