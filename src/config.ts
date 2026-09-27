import type {
  ExpressiveCodeConfig,
  GitHubEditConfig,
  ImageFallbackConfig,
  LicenseConfig,
  NavBarConfig,
  ProfileConfig,
  SiteConfig,
  UmamiConfig,
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
    // 关闭随机图背景，改用跟随主题（明暗模式 + 主题色）的渐变背景，见 Layout.astro 中 #bg-box
    enable: false, // Enable background image
    // src: "https://riscv-nas.acetaffy.top/random?type=horizontal",
    // src: "https://t.alcy.cc/ycy", // Background image URL (supports HTTPS)
    position: "center", // Background position: 'top', 'center', 'bottom'
    size: "cover", // Background size: 'cover', 'contain', 'auto'
    repeat: "no-repeat", // Background repeat: 'no-repeat', 'repeat', 'repeat-x', 'repeat-y'
    attachment: "fixed", // Background attachment: 'fixed', 'scroll', 'local'
    opacity: 0.8, // Background opacity (0-1)
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
      name: "分类",
      url: "/category/",
      external: false,
    },
    {
      name: "相册",
      url: "/gallery/",
      external: false,
    },
    {
      name: "友链",
      url: "/friends/", // Internal links should not include the base path, as it is automatically added
      external: false, // Show an external link icon and will open in a new tab
    },
    {
      name: "赞助",
      url: "/sponsors/", // Internal links should not include the base path, as it is automatically added
      external: false, // Show an external link icon and will open in a new tab
    },
    // {
    //   name: "统计",
    //   url: "https://umami.acofork.com/share/CdkXbGgZr6ECKOyK", // Internal links should not include the base path, as it is automatically added
    //   external: true, // Show an external link icon and will open in a new tab
    // },
    // {
    //   name: "监控",
    //   url: "https://eoddos.2x.nz", // Internal links should not include the base path, as it is automatically added
    //   external: true, // Show an external link icon and will open in a new tab
    // },
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
      url: "https://status.meowrain.cn",
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

export const imageFallbackConfig: ImageFallbackConfig = {
  enable: false,
  originalDomain: "https://eopfapi.acofork.com/pic?img=ua",
  fallbackDomain: "https://eopfapi.acofork.com/pic?img=ua",
};

export const umamiConfig: UmamiConfig = {
  enable: true,
  baseUrl: "https://umami.acofork.com",
  shareId: "CdkXbGgZr6ECKOyK",
  timezone: "Asia/Shanghai",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
  theme: "github-dark",
};

export const gitHubEditConfig: GitHubEditConfig = {
  enable: true,
  baseUrl: "https://github.com/afoim/fuwari/blob/main/src/content/posts",
};

// todoConfig removed from here
