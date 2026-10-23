import type { AUTO_MODE, DARK_MODE, LIGHT_MODE } from "@constants/constants";

export type SiteConfig = {
	title: string;
	subtitle: string;
	description?: string;
	keywords?: string[];

	lang: string;

	themeColor: {
		hue: number;
		fixed: boolean;
		forceDarkMode?: boolean;
	};
	banner: {
		enable: boolean;
		src: string;
		position?: "top" | "center" | "bottom";
		credit: {
			enable: boolean;
			text: string;
			url?: string;
		};
	};
	background: {
		enable: boolean;
		src: string;
		position?: "top" | "center" | "bottom";
		size?: "cover" | "contain" | "auto";
		repeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
		attachment?: "fixed" | "scroll" | "local";
		opacity?: number;
	};
	/**
	 * 磨砂玻璃（毛玻璃）外观。开启后卡片变成半透明并模糊背后的背景，
	 * 同时背景会叠一层跟随主题色的柔光色块。纯 CSS，不需要额外图片。
	 */
	frostedGlass?: {
		enable: boolean;
		blur?: number;
		opacity?: number;
		darkOpacity?: number;
	};
	toc: {
		enable: boolean;
		depth: 1 | 2 | 3;
	};

	favicon: Favicon[];
	officialSites?: (string | { url: string; alias: string })[];
};

export type Favicon = {
	src: string;
	theme?: "light" | "dark";
	sizes?: string;
};

export enum LinkPreset {
	Home = 0,
	Archive = 1,
}

export type NavBarLink = {
	name: string;
	url: string;
	external?: boolean;
	// 有 children 时，该链接会渲染成下拉菜单，url 仅作为占位
	children?: NavBarLink[];
};

export type NavBarConfig = {
	links: (NavBarLink | LinkPreset)[];
};

export type ProfileConfig = {
	avatar?: string;
	name: string;
	bio?: string;
	links: {
		name: string;
		url: string;
		icon: string;
	}[];
};

export type LicenseConfig = {
	enable: boolean;
	name: string;
	url: string;
};

export type MusicConfig = {
	/**
	 * 音乐页要展示的网易云歌单。id 就是歌单分享链接里 id= 后面那串数字。
	 * 私密歌单、会员歌需要在部署环境里配 NETEASE_COOKIE，见 README 的「音乐页」。
	 */
	playlists: {
		id: string;
		/** 可选：覆盖显示名；留空就用网易云返回的歌单名 */
		name?: string;
	}[];
};

export type ImageFallbackConfig = {
	enable: boolean;
	originalDomain: string;
	fallbackDomain: string;
};

export type UmamiConfig = {
	enable: boolean;
	baseUrl: string;
	shareId: string;
	timezone: string;
};



export type LIGHT_DARK_MODE =
	| typeof LIGHT_MODE
	| typeof DARK_MODE
	| typeof AUTO_MODE;

export type BlogPostData = {
	body: string;
	title: string;
	published: Date;
	description: string;
	tags: string[];
	category?: string | string[];
	draft?: boolean;
	image?: string;
	series?: string;
	seriesOrder?: number;
	prevTitle?: string;
	prevSlug?: string;
	nextTitle?: string;
	nextSlug?: string;
};

export type ExpressiveCodeConfig = {
	theme: string;
};

export type GitHubEditConfig = {
	enable: boolean;
	baseUrl: string;
};

/** 双链（wikilink）：正文里写 `[[slug]]` 生成站内链接 + 文末反向链接面板。 */
export type WikiLinkConfig = {
	/** 关掉后 `[[slug]]` 原样显示成文本，不生成任何节点 */
	enable: boolean;
	/** 文章底部展示「反向链接」卡片 */
	backlinks: boolean;
	/** 文章底部展示「本文引用了」卡片（本期先不做，只留开关） */
	outlinks: boolean;
	/** 反向链接最多展示几条 */
	maxBacklinks: number;
	/** 构建时对不存在的 slug / 锚点打印 `console.warn` */
	brokenLinkWarn: boolean;
};

// Category types
export type CategoryPath = string[];
export type CategoryPathString = string;

export interface CategoryNode {
	name: string;
	path: CategoryPath;
	pathString: string;
	url: string;
	count: number;
	children?: CategoryNode[];
}

export interface CategoryTree {
	[key: string]: CategoryNode;
}
