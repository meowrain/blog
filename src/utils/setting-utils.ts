import { expressiveCodeConfig } from "@/config";
import type { LIGHT_DARK_MODE } from "@/types/config";
import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
} from "@constants/constants.ts";
import {
	type ReadingLayout,
	normalizeReadingLayout,
} from "@utils/reading-layout-core.ts";

export function getDefaultHue(): number {
	const fallback = "250";
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseInt(configCarrier?.dataset.hue || fallback);
}

export function getHue(): number {
	const stored = localStorage.getItem("hue");
	return stored ? Number.parseInt(stored) : getDefaultHue();
}

export function setHue(hue: number, save = true): void {
	if (save) {
		localStorage.setItem("hue", String(hue));
	}
	document.documentElement.style.setProperty("--hue", String(hue));
}

export function getRainbowMode(): boolean {
	const stored = localStorage.getItem("rainbow-mode");
	return stored === "true";
}

export function setRainbowMode(enabled: boolean): void {
	localStorage.setItem("rainbow-mode", String(enabled));
}

export function getRainbowSpeed(): number {
	const stored = localStorage.getItem("rainbow-speed");
	return stored ? Number.parseFloat(stored) : 5; // Default speed
}

export function setRainbowSpeed(speed: number): void {
	localStorage.setItem("rainbow-speed", String(speed));
}

export function getBgBlur(): number {
	const stored = localStorage.getItem("bg-blur");
	return stored ? Number.parseInt(stored) : 0; // Default blur is 0
}

export function setBgBlur(blur: number): void {
	localStorage.setItem("bg-blur", String(blur));
	const bgBox = document.getElementById("bg-box");
	if (bgBox) {
		// Retrieve existing hue-rotate value if any, or 0
		const currentFilter = bgBox.style.filter || "";
		const hueRotateMatch = currentFilter.match(/hue-rotate\((.*?)deg\)/);
		const hueRotate = hueRotateMatch ? hueRotateMatch[1] : "0";
		bgBox.style.setProperty(
			"filter",
			`blur(${blur}px) hue-rotate(${hueRotate}deg)`,
		);
	}
}

export function setBgHueRotate(hue: number): void {
	const bgBox = document.getElementById("bg-box");
	if (bgBox) {
		// Retrieve existing blur value
		const currentFilter = bgBox.style.filter || "";
		const blurMatch = currentFilter.match(/blur\((.*?)px\)/);
		const blur = blurMatch ? blurMatch[1] : getBgBlur();
		bgBox.style.setProperty("filter", `blur(${blur}px) hue-rotate(${hue}deg)`);
	}
}

export function getBgHueRotate(): number {
	const bgBox = document.getElementById("bg-box");
	if (bgBox) {
		const currentFilter = bgBox.style.filter || "";
		const hueRotateMatch = currentFilter.match(/hue-rotate\((.*?)deg\)/);
		return hueRotateMatch ? Number.parseInt(hueRotateMatch[1]) : 0;
	}
	return 0;
}

export function getHideBg(): boolean {
	const stored = localStorage.getItem("hide-bg");
	return stored === "true";
}

export function setHideBg(hide: boolean): void {
	localStorage.setItem("hide-bg", String(hide));
	const bgBox = document.getElementById("bg-box");
	if (bgBox) {
		bgBox.style.setProperty("display", hide ? "none" : "");
	}
}

export type FallingEffectType =
	| "off"
	| "sakura"
	| "rain"
	| "snow"
	| "maple"
	| "bubbles";

export const FALLING_EFFECT_OPTIONS: {
	value: Exclude<FallingEffectType, "off">;
	label: string;
	icon: string;
}[] = [
	{ value: "sakura", label: "樱花", icon: "material-symbols:local-florist" },
	{ value: "rain", label: "雨", icon: "material-symbols:rainy" },
	{ value: "snow", label: "雪", icon: "material-symbols:ac-unit" },
	{ value: "maple", label: "枫叶", icon: "material-symbols:eco" },
	{ value: "bubbles", label: "泡泡", icon: "material-symbols:bubble-chart" },
];

export function getFallingEffect(): FallingEffectType {
	const stored = localStorage.getItem("falling-effect");
	return FALLING_EFFECT_OPTIONS.some((opt) => opt.value === stored)
		? (stored as Exclude<FallingEffectType, "off">)
		: "off";
}

export function setFallingEffect(effect: FallingEffectType): void {
	localStorage.setItem("falling-effect", effect);
	window.dispatchEvent(
		new CustomEvent("falling-effect-change", { detail: effect }),
	);
}

export function getDevMode(): boolean {
	const stored = localStorage.getItem("dev-mode");
	return stored === "true";
}

export function setDevMode(enabled: boolean): void {
	localStorage.setItem("dev-mode", String(enabled));
}

export function getDevServer(): string {
	const stored = localStorage.getItem("dev-server");
	return stored || "";
}

export function setDevServer(server: string): void {
	localStorage.setItem("dev-server", server);
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE) {
	switch (theme) {
		case LIGHT_MODE:
			document.documentElement.classList.remove("dark");
			break;
		case DARK_MODE:
			document.documentElement.classList.add("dark");
			break;
		case AUTO_MODE:
			if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
				document.documentElement.classList.add("dark");
			} else {
				document.documentElement.classList.remove("dark");
			}
			break;
	}
	document.documentElement.setAttribute(
		"data-theme",
		expressiveCodeConfig.theme,
	);
}

export function setTheme(theme: LIGHT_DARK_MODE): void {
	localStorage.setItem("theme", theme);
	applyThemeToDocument(theme);
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	return (localStorage.getItem("theme") as LIGHT_DARK_MODE) || DEFAULT_THEME;
}

export const DEFAULT_READING_FONT_SIZE = 1;
export const DEFAULT_READING_LINE_HEIGHT = 1.75;
export const DEFAULT_READING_CONTENT_WIDTH = 50;

function getStoredNumber(key: string, fallback: number): number {
	const raw = localStorage.getItem(key);
	if (raw === null) return fallback;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) ? value : fallback;
}

export function getReadingFontSize(): number {
	return getStoredNumber("reading-font-size", DEFAULT_READING_FONT_SIZE);
}

export function setReadingFontSize(size: number): void {
	localStorage.setItem("reading-font-size", String(size));
	document.documentElement.style.setProperty(
		"--reading-font-size",
		`${size}rem`,
	);
}

export function getReadingLineHeight(): number {
	return getStoredNumber("reading-line-height", DEFAULT_READING_LINE_HEIGHT);
}

export function setReadingLineHeight(height: number): void {
	localStorage.setItem("reading-line-height", String(height));
	document.documentElement.style.setProperty(
		"--reading-line-height",
		String(height),
	);
}

export function getReadingContentWidth(): number {
	return getStoredNumber(
		"reading-content-width",
		DEFAULT_READING_CONTENT_WIDTH,
	);
}

export function setReadingContentWidth(width: number): void {
	localStorage.setItem("reading-content-width", String(width));
	document.documentElement.style.setProperty(
		"--reading-content-width",
		`${width}rem`,
	);
}

/**
 * 阅读布局模式：写在 <html data-reading-layout> 上，样式和组件都靠它判断，
 * 不用在每个组件里读 localStorage。标准布局下移除属性，避免多一份默认态。
 */
export function applyReadingLayout(layout: ReadingLayout): void {
	const root = document.documentElement;
	if (layout === "standard") {
		root.removeAttribute("data-reading-layout");
	} else {
		root.setAttribute("data-reading-layout", layout);
	}
	// 设置面板的选中态、需要重新测量的组件都靠这个事件同步
	window.dispatchEvent(
		new CustomEvent("reading-layout-change", { detail: layout }),
	);
}

export function getReadingLayout(): ReadingLayout {
	return normalizeReadingLayout(localStorage.getItem("reading-layout"));
}

export function setReadingLayout(layout: ReadingLayout): void {
	const next = normalizeReadingLayout(layout);
	localStorage.setItem("reading-layout", next);
	applyReadingLayout(next);
}
