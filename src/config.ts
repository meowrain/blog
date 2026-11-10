import type {
  ExpressiveCodeConfig,
  GitHubEditConfig,
  ImageFallbackConfig,
  LicenseConfig,
  MusicConfig,
  NavBarConfig,
  ProfileConfig,
  SiteConfig,
  StatsConfig,
  WikiLinkConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
  title: "MeowRain的技术博客",
  subtitle: "技术分享与实践",
  description:
    "分享软件开发、编程语言、框架和工具的技术博客，涵盖实用教程、最佳实践和行业动态，帮助开发者提升技能。",

  keywords: [],
  lang: "zh_CN", // 'en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'es', 'th'
  themeColor: {
    hue: 340, // Default hue for the theme color, from 0 to 360. e.g. red: 0, teal: 200, cyan: 250, pink: 345
    fixed: false, // Hide the theme color picker for visitors
    forceDarkMode: false, // Force dark mode and hide theme switcher
  },
  banner: {
    enable: false,
    src: "/xinghui.avif", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
    position: "center", // Equivalent to object-position, only supports 'top', 'center', 'bottom'. 'center' by default
    credit: {
      enable: true, // Display the credit text of the banner image
      text: "Pixiv @chokei", // Credit text to be displayed
      url: "https://www.pixiv.net/artworks/122782209", // (Optional) URL link to the original artwork or artist's page
    },
  },
  background: {
    // 随机二次元壁纸背景。关闭时 #bg-box 只显示跟随主题（明暗模式 + 主题色）的渐变。
    enable: true, // Enable background image
    src: "", // 随机模式关闭时的固定图片；随机模式开启后被忽略
    position: "center", // Background position: 'top', 'center', 'bottom'
    size: "cover", // Background size: 'cover', 'contain', 'auto'
    repeat: "no-repeat", // Background repeat: 'no-repeat', 'repeat', 'repeat-x', 'repeat-y'
    attachment: "fixed", // Background attachment: 'fixed', 'scroll', 'local'
    opacity: 0.8, // Background opacity (0-1)

    // 每次打开页面从下面随机挑几个源并发拉图；某个源挂了不影响其他的，
    // 第一张加载成功的就用，全部失败则回落到渐变背景（不会出现破图）。
    random: {
      enable: true,
      // {width} 会被替换成按屏幕宽度算出的像素值，不支持的源留空即可。
      // 顺序无所谓，每次加载都会重新洗牌。
      sources: [
        {
          name: "Starlight 图床 · 电脑壁纸",
          url: "https://t.alcy.cc/pc?w={width}",
          mobileUrl: "https://t.alcy.cc/mp?w={width}",
        },
        {
          name: "mwm.moe · 二次元壁纸",
          url: "https://t.mwm.moe/pc",
          mobileUrl: "https://t.mwm.moe/mp",
        },
        {
          name: "搏天图床 · 动漫壁纸",
          url: "https://api.btstu.cn/sjbz/api.php?lx=dongman&format=images&zsy=1920x1080",
        },
        {
          name: "dmoe · 动漫随机图",
          url: "https://www.dmoe.cc/random.php",
        },
      ],
      timeout: 6000, // 单张图多久加载不出来就放弃（毫秒）
      maxAttempts: 3, // 一次并发拉几个源
    },
  },

  frostedGlass: {
    // 磨砂玻璃外观：半透明卡片 + 背景柔光 + 毛玻璃模糊。
    // 喜欢现在的纯色卡片就把 enable 改成 false。
    enable: true,
    blur: 22, // 卡片背后模糊半径（px）
    opacity: 0.46, // 亮色模式卡片不透明度（0-1），越低越透、背景色越明显
    darkOpacity: 0.5, // 暗色模式卡片不透明度（0-1）
  },
  toc: {
    enable: true, // Display the table of contents on the right side of the post
    depth: 2, // Maximum heading depth to show in the table, from 1 to 3
  },
  favicon: [
    // Leave this array empty to use the default favicon
    {
      src: "https://q2.qlogo.cn/headimg_dl?dst_uin=2726730791&spec=0", // Path of the favicon, relative to the /public directory
      //   theme: 'light',              // (Optional) Either 'light' or 'dark', set only if you have different favicons for light and dark mode
      //   sizes: '32x32',              // (Optional) Size of the favicon, set only if you have favicons of different sizes
    },
  ],
  officialSites: [
    { url: "https://blog.meowrain.cn", alias: "EdgeOne CN" },
    { url: "https://blog2.meowrain.cn", alias: "Global" },
    { url: "https://www.meowrain.cn", alias: "Global" },
  ],
};

export const navBarConfig: NavBarConfig = {
  links: [
    LinkPreset.Home,
    LinkPreset.Archive,
    {
      name: "内容",
      url: "#", // 分组入口，不可点击，仅作为下拉菜单的标题
      children: [
        {
          name: "系列",
          url: "/series/",
          external: false,
        },
        {
          name: "分类",
          url: "/category/",
          external: false,
        },
        {
          name: "标签",
          url: "/tags/",
          external: false,
        },
        {
          name: "碎碎念",
          url: "/notes/",
          external: false,
        },
        {
          name: "相册",
          url: "/gallery/",
          external: false,
        },
        {
          name: "追番",
          url: "/bangumi/",
          external: false,
        },
        {
          name: "音乐",
          url: "/music/",
          external: false,
        },
      ],
    },
    {
      name: "服务",
      url: "#", // 分组入口，不可点击，仅作为下拉菜单的标题
      children: [
        {
          name: "AI 助手",
          url: "/chat/",
          external: false,
        },
        {
          name: "监控",
          url: "/monitor/",
          external: false,
        },
        {
          name: "访问统计",
          url: "/stats/",
          external: false,
        },
      ],
    },
    {
      name: "关于",
      url: "#", // 分组入口，不可点击，仅作为下拉菜单的标题
      children: [
        {
          name: "关于我",
          url: "/about/",
          external: false,
        },
        {
          name: "项目",
          url: "/projects/",
          external: false,
        },
        {
          name: "友链",
          url: "/friends/",
          external: false,
        },
        {
          name: "赞助",
          url: "/sponsors/",
          external: false,
        },
      ],
    },
    // 旧的 Umami / 外部监控入口已停用，访问统计改为站内 /stats/（见上方「服务」分组）。
  ],
};

export const profileConfig: ProfileConfig = {
  avatar: "https://q1.qlogo.cn/g?b=qq&nk=782157532&s=640", // QQ 头像接口，s 可选 40/100/140/640
  name: "MeowRain",
  bio: "💕华风夏韵，洛水天依💕",
  links: [
    {
      name: "GitHub",
      icon: "fa6-brands:github",
      url: "https://github.com/meowrain",
    },
    {
      name: "我的OpenWebUI站",
      icon: "fa6-brands:airbnb",
      url: "https://ai.meowrain.cn",
    },
    {
      name: "服务器状态监控",
      icon: "fa6-solid:server",
      url: "https://status.acetaffy.mom",
    },
    {
      name: "bilibili",
      icon: "fa6-brands:bilibili",
      url: "https://space.bilibili.com/386388600",
    },
  ],
};
export const licenseConfig: LicenseConfig = {
  enable: true,
  name: "CC BY-NC-SA 4.0",
  url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

// 双链（wikilink）：正文里写 `[[slug]]` / `[[slug|文字]]` / `[[slug#小节标题]]`
// 会生成站内链接，并在被引用文章底部自动出「反向链接」卡片。
// enable: false 时双链完全不生效（原样显示成文本），适合临时排查渲染问题。
export const wikiLinkConfig: WikiLinkConfig = {
  enable: true,
  backlinks: true,
  outlinks: false, // 本期先不做「本文引用了」，留开关
  maxBacklinks: 20,
  brokenLinkWarn: true,
};

export const imageFallbackConfig: ImageFallbackConfig = {
  enable: false,
  originalDomain: "https://eopfapi.acofork.com/pic?img=ua",
  fallbackDomain: "https://eopfapi.acofork.com/pic?img=ua",
};

// 自建访问统计（cloud-functions/api/stats/[[default]].js + Blob 存储）。
// 关掉 enable 就不再上报、也不回填任何访问量。
export const statsConfig: StatsConfig = {
  enable: true,
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
  theme: "github-dark",
};

export const gitHubEditConfig: GitHubEditConfig = {
  enable: true,
  baseUrl: "https://github.com/afoim/fuwari/blob/main/src/content/posts",
};

// 动态 OG 分享图（cloud-functions/api/og/[[default]].js）所在的 EdgeOne Pages 域名。
// og:image 必须是绝对 URL 且指向部署了 Cloud Function 的域名；
// 注意不要用 astro.config 的 site（主域名是纯静态站，函数不部署在那）。
export const ogImageBase = "https://blog-edgeone.meowrain.cn";

// todoConfig removed from here

export const musicConfig: MusicConfig = {
  // 歌单 ID 就是网页版歌单地址里 id=xxxx 那串数字；私密歌单和会员歌需要在部署环境里
  // 配 NETEASE_COOKIE 才能完整播放，见 README 的「音乐页」。
  playlists: [
    { id: "158197454", name: "我喜欢的音乐" },
  ],
};
