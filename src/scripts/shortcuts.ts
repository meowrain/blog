import { getReadingLayout, setReadingLayout } from "../utils/setting-utils";
import {
	type ParsedShortcut,
	formatShortcutTokens,
	matchesShortcut,
	normalizeKeyName,
	parseShortcut,
} from "../utils/shortcuts-core";

/**
 * 站级快捷键中心。
 *
 * 所有 document 级 keydown 都从这里分发：注册项带 `when` 条件、优先级和
 * 「是否允许在输入框 / 弹层中触发」，避免各模块各挂一个监听、互相抢键。
 * 帮助面板复用 ArticleShare 的 `<dialog>` 模式，列表由注册表实时生成。
 */

export type ShortcutHandler = (event: KeyboardEvent) => unknown;

export interface ShortcutEntry {
	id: string;
	/** 单键或组合键，支持 `mod+k`、`Shift+ArrowRight`、`?`；可传多个备选 */
	key?: string | string[];
	/** 两步序列，例如 ["g", "h"] */
	sequence?: string[];
	label?: string;
	group?: string;
	handler: ShortcutHandler;
	/** 条件不满足时整条快捷键跳过 */
	when?: () => boolean;
	allowInEditable?: boolean;
	/** 默认在弹层打开时禁用；弹层自己的快捷键要显式打开 */
	whenLayerOpen?: boolean;
	priority?: number;
	preventDefault?: boolean;
	stopPropagation?: boolean;
	hiddenInHelp?: boolean;
}

interface InternalEntry extends ShortcutEntry {
	order: number;
	parsedKeys: ParsedShortcut[];
}

interface ShortcutCenter {
	entries: InternalEntry[];
	nextOrder: number;
	pendingSequence: string[] | null;
	pendingTimer: number | null;
	listenerBound: boolean;
	globalsMounted: boolean;
	triggerBound: boolean;
	openHelp: (() => void) | null;
}

const CENTER_KEY = Symbol.for("meowrain.blog.shortcuts");
const SEQUENCE_TIMEOUT = 900;
const GROUP_ORDER = ["导航", "阅读", "播放", "游戏", "帮助"];
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

function center(): ShortcutCenter {
	const store = globalThis as unknown as Record<
		symbol,
		ShortcutCenter | undefined
	>;
	let instance = store[CENTER_KEY];
	if (!instance) {
		instance = {
			entries: [],
			nextOrder: 0,
			pendingSequence: null,
			pendingTimer: null,
			listenerBound: false,
			globalsMounted: false,
			triggerBound: false,
			openHelp: null,
		};
		store[CENTER_KEY] = instance;
	}
	return instance;
}

function toInternal(entry: ShortcutEntry, order: number): InternalEntry {
	const specs =
		entry.key === undefined
			? []
			: Array.isArray(entry.key)
				? entry.key
				: [entry.key];
	return { ...entry, order, parsedKeys: specs.map(parseShortcut) };
}

export function registerShortcut(entry: ShortcutEntry): () => void {
	const state = center();
	ensureListener(state);

	const internal = toInternal(entry, state.nextOrder++);
	const existing = state.entries.findIndex((item) => item.id === entry.id);
	if (existing >= 0) {
		internal.order = state.entries[existing].order;
		state.entries[existing] = internal;
	} else {
		state.entries.push(internal);
	}

	return () => {
		const index = state.entries.findIndex((item) => item.id === entry.id);
		if (index >= 0) state.entries.splice(index, 1);
	};
}

function ensureListener(state: ShortcutCenter): void {
	if (state.listenerBound || typeof document === "undefined") return;
	state.listenerBound = true;
	document.addEventListener("keydown", (event) => dispatch(state, event), {
		capture: true,
	});
	window.addEventListener("blur", () => clearPending(state));
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
	return Boolean(
		target.closest(
			'[contenteditable="true"], [role="textbox"], [role="combobox"]',
		),
	);
}

/** 搜索面板、设置面板、目录抽屉、图片查看器、对话框打开时，站级快捷键让路 */
function isOverlayOpen(): boolean {
	if (typeof document === "undefined") return false;
	if (document.body?.classList.contains("find-panel-open")) return true;
	return Boolean(
		document.querySelector(
			"dialog[open], #search-panel:not(.float-panel-closed), #display-setting:not(.float-panel-closed), #nav-menu-panel:not(.float-panel-closed), #lightbox:not(.hidden), mobile-toc.is-open",
		),
	);
}

function plainSequenceToken(event: KeyboardEvent): string | null {
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
		return null;
	}
	return normalizeKeyName(event.key);
}

function clearPending(state: ShortcutCenter): void {
	state.pendingSequence = null;
	if (state.pendingTimer !== null) {
		window.clearTimeout(state.pendingTimer);
		state.pendingTimer = null;
	}
}

function waitForSequence(state: ShortcutCenter): void {
	if (state.pendingTimer !== null) window.clearTimeout(state.pendingTimer);
	state.pendingTimer = window.setTimeout(
		() => clearPending(state),
		SEQUENCE_TIMEOUT,
	);
}

function run(entry: InternalEntry, event: KeyboardEvent): boolean {
	const result = entry.handler(event);
	if (result === false) return false;

	if (entry.preventDefault !== false) event.preventDefault();
	if (entry.stopPropagation) event.stopPropagation();
	if (result instanceof Promise) void result;
	return true;
}

function dispatch(state: ShortcutCenter, event: KeyboardEvent): void {
	if (event.isComposing || event.defaultPrevented) return;

	const candidates = [...state.entries].sort(
		(a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order,
	);
	const editable = isEditableTarget(event.target);
	const overlayOpen = isOverlayOpen();
	const token = plainSequenceToken(event);

	const eligible = (entry: InternalEntry): boolean => {
		if (entry.when && !entry.when()) return false;
		if (editable && !entry.allowInEditable) return false;
		if (overlayOpen && !entry.whenLayerOpen) return false;
		return true;
	};

	// 1. 继续一个两步序列
	if (state.pendingSequence && token) {
		const pressed = [...state.pendingSequence, token];
		for (const entry of candidates) {
			if (!entry.sequence || entry.sequence.length < pressed.length) continue;
			if (!eligible(entry)) continue;
			const matches = pressed.every(
				(value, index) =>
					normalizeKeyName(entry.sequence?.[index] ?? "") === value,
			);
			if (!matches) continue;

			if (entry.sequence.length === pressed.length) {
				clearPending(state);
				if (run(entry, event)) return;
			} else {
				state.pendingSequence = pressed;
				waitForSequence(state);
				return;
			}
		}
		// 没接上就丢掉前缀，当前键继续按普通快捷键处理
		clearPending(state);
	}

	// 2. 单键 / 组合键
	for (const entry of candidates) {
		if (!entry.parsedKeys.length) continue;
		if (
			!entry.parsedKeys.some((shortcut) => matchesShortcut(event, shortcut))
		) {
			continue;
		}
		if (!eligible(entry)) continue;
		if (run(entry, event)) return;
	}

	// 3. 记录序列的第一步
	if (!token) return;
	for (const entry of candidates) {
		if (!entry.sequence?.length) continue;
		if (normalizeKeyName(entry.sequence[0]) !== token) continue;
		if (!eligible(entry)) continue;
		state.pendingSequence = [token];
		waitForSequence(state);
		return;
	}
}

function isMacPlatform(): boolean {
	return (
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad/.test(navigator.userAgent)
	);
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
	);
}

function scrollPage(direction: 1 | -1): void {
	const step = Math.max(64, Math.round(window.innerHeight * 0.12));
	window.scrollBy({
		top: direction * step,
		behavior: prefersReducedMotion() ? "auto" : "smooth",
	});
}

function navigateTo(path: string): void {
	const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
	const target = `${base}${path.startsWith("/") ? path : `/${path}`}` || "/";
	const swup = (
		window as unknown as {
			swup?: { navigate?: (url: string) => unknown };
		}
	).swup;
	if (typeof swup?.navigate === "function") {
		swup.navigate(target);
	} else {
		window.location.assign(target);
	}
}

function focusSearch(): void {
	document.dispatchEvent(new CustomEvent("site:focus-search"));
}

function toggleFocusLayout(): void {
	setReadingLayout(getReadingLayout() === "focus" ? "standard" : "focus");
}

/** 标准布局下不接管 Esc，让弹层 / 浏览器默认行为照常 */
function exitReadingLayout(): boolean | undefined {
	if (getReadingLayout() === "standard") return false;
	setReadingLayout("standard");
	return undefined;
}

function registerGlobals(state: ShortcutCenter): void {
	if (state.globalsMounted) return;
	state.globalsMounted = true;

	registerShortcut({
		id: "site.help",
		key: "?",
		group: "帮助",
		label: "打开键盘快捷键面板",
		priority: 60,
		handler: () => state.openHelp?.(),
	});
	registerShortcut({
		id: "site.search",
		key: "mod+k",
		group: "导航",
		label: "搜索文章",
		priority: 50,
		allowInEditable: true,
		handler: focusSearch,
	});
	registerShortcut({
		id: "site.search-slash",
		key: "/",
		group: "导航",
		label: "聚焦搜索框",
		priority: 40,
		handler: focusSearch,
	});
	registerShortcut({
		id: "site.home",
		sequence: ["g", "h"],
		group: "导航",
		label: "回到首页",
		priority: 30,
		handler: () => navigateTo("/"),
	});
	registerShortcut({
		id: "site.archive",
		sequence: ["g", "a"],
		group: "导航",
		label: "打开归档",
		priority: 30,
		handler: () => navigateTo("/archive/"),
	});
	registerShortcut({
		id: "site.scroll-down",
		key: "j",
		group: "阅读",
		label: "向下滚动",
		priority: 20,
		handler: () => scrollPage(1),
	});
	registerShortcut({
		id: "site.scroll-up",
		key: "k",
		group: "阅读",
		label: "向上滚动",
		priority: 20,
		handler: () => scrollPage(-1),
	});
	registerShortcut({
		id: "site.focus-layout",
		key: "f",
		group: "阅读",
		label: "切换沉浸阅读模式",
		priority: 20,
		handler: toggleFocusLayout,
	});
	registerShortcut({
		id: "site.exit-layout",
		key: "Escape",
		group: "阅读",
		label: "退出宽屏 / 沉浸模式",
		// 弹层打开时普通快捷键本来就不分发，弹层自己的 Esc 也在更高优先级
		priority: 5,
		handler: exitReadingLayout,
	});
}

function groupRank(group: string | undefined): number {
	const index = GROUP_ORDER.indexOf(group ?? "");
	return index >= 0 ? index : GROUP_ORDER.length;
}

export function getShortcutHelp(): ShortcutEntry[] {
	return center()
		.entries.filter(
			(entry) =>
				Boolean(entry.label) &&
				!entry.hiddenInHelp &&
				(!entry.when || entry.when()),
		)
		.sort(
			(a, b) => groupRank(a.group) - groupRank(b.group) || a.order - b.order,
		);
}

function appendKbds(parent: HTMLElement, tokens: string[]): void {
	for (const token of tokens) {
		const kbd = document.createElement("kbd");
		kbd.className =
			"inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-black/10 bg-black/[0.04] px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold text-90 dark:border-white/15 dark:bg-white/10";
		kbd.textContent = token;
		parent.appendChild(kbd);
	}
}

function renderKeys(entry: ShortcutEntry, isMac: boolean): HTMLElement {
	const wrapper = document.createElement("span");
	wrapper.className = "flex shrink-0 items-center gap-1";

	const specs =
		entry.key === undefined
			? []
			: Array.isArray(entry.key)
				? entry.key
				: [entry.key];

	if (entry.sequence?.length) {
		entry.sequence.forEach((step, index) => {
			if (index > 0) {
				const arrow = document.createElement("span");
				arrow.className = "text-[0.625rem] text-30";
				arrow.textContent = "then";
				wrapper.appendChild(arrow);
			}
			appendKbds(wrapper, formatShortcutTokens(step, isMac));
		});
		return wrapper;
	}

	specs.forEach((spec, index) => {
		if (index > 0) {
			const separator = document.createElement("span");
			separator.className = "px-0.5 text-[0.625rem] text-30";
			separator.textContent = "/";
			wrapper.appendChild(separator);
		}
		appendKbds(wrapper, formatShortcutTokens(spec, isMac));
	});

	return wrapper;
}

function renderHelp(container: HTMLElement | null): void {
	if (!container) return;

	const groups = new Map<string, ShortcutEntry[]>();
	for (const entry of getShortcutHelp()) {
		const group = entry.group || "其他";
		const list = groups.get(group) ?? [];
		list.push(entry);
		groups.set(group, list);
	}

	const isMac = isMacPlatform();
	const fragment = document.createDocumentFragment();

	for (const [group, entries] of groups) {
		const section = document.createElement("section");

		const heading = document.createElement("h3");
		heading.className =
			"mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-50";
		heading.textContent = group;

		const list = document.createElement("div");
		list.className = "divide-y divide-black/5 dark:divide-white/5";

		for (const entry of entries) {
			const row = document.createElement("div");
			row.className = "flex items-center justify-between gap-3 py-1.5";

			const label = document.createElement("span");
			label.className = "text-sm text-75";
			label.textContent = entry.label ?? "";

			row.append(label, renderKeys(entry, isMac));
			list.appendChild(row);
		}

		section.append(heading, list);
		fragment.appendChild(section);
	}

	container.replaceChildren(fragment);
}

function animateIn(dialog: HTMLElement, panel: HTMLElement | null): void {
	if (prefersReducedMotion()) return;
	dialog.animate([{ opacity: 0 }, { opacity: 1 }], {
		duration: 220,
		easing: "ease-out",
	});
	panel?.animate(
		[
			{ opacity: 0, transform: "translateY(14px) scale(0.965)" },
			{ opacity: 1, transform: "translateY(0) scale(1)" },
		],
		{ duration: 300, easing: EASE_OUT },
	);
}

function animateOut(
	dialog: HTMLElement,
	panel: HTMLElement | null,
): Promise<Animation[]> {
	if (prefersReducedMotion()) return Promise.resolve([]);
	const animations = [
		dialog.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 180,
			easing: "ease-in",
			fill: "both",
		}),
		...(panel
			? [
					panel.animate(
						[
							{ opacity: 1, transform: "translateY(0) scale(1)" },
							{ opacity: 0, transform: "translateY(8px) scale(0.975)" },
						],
						{ duration: 150, easing: "ease-in", fill: "both" },
					),
				]
			: []),
	];
	return Promise.all(
		animations.map((animation) => animation.finished.catch(() => undefined)),
	).then(() => animations);
}

function mountHelpDialog(state: ShortcutCenter): void {
	const dialog = document.querySelector<HTMLDialogElement>(
		"[data-shortcuts-help-dialog]",
	);
	if (!dialog || dialog.dataset.bound === "true") return;
	dialog.dataset.bound = "true";

	const panel = dialog.querySelector<HTMLElement>(
		"[data-shortcuts-help-panel]",
	);
	const list = dialog.querySelector<HTMLElement>("[data-shortcuts-help-list]");
	const closeBtn = dialog.querySelector<HTMLButtonElement>(
		"[data-shortcuts-help-close]",
	);

	let scrollLocked = false;
	let bodyOverflow = "";
	let closing = false;
	let openToken = 0;

	const lockScroll = (): void => {
		if (scrollLocked) return;
		scrollLocked = true;
		bodyOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
	};

	const unlockScroll = (): void => {
		if (!scrollLocked) return;
		scrollLocked = false;
		document.body.style.overflow = bodyOverflow;
	};

	const open = (): void => {
		if (dialog.open) return;
		renderHelp(list);
		dialog.classList.remove("hidden");
		dialog.classList.add("flex");
		dialog.showModal();
		animateIn(dialog, panel);
		lockScroll();
	};

	const close = (): void => {
		if (closing) return;
		if (!dialog.open && dialog.classList.contains("hidden")) return;
		closing = true;
		const token = ++openToken;
		void animateOut(dialog, panel).then((animations) => {
			if (token !== openToken) return;
			dialog.classList.add("hidden");
			dialog.classList.remove("flex");
			for (const animation of animations) animation.cancel();
			if (dialog.open) dialog.close();
			unlockScroll();
			closing = false;
		});
	};

	const closeImmediately = (): void => {
		openToken += 1;
		closing = false;
		dialog.classList.add("hidden");
		dialog.classList.remove("flex");
		if (dialog.open) dialog.close();
		unlockScroll();
	};

	// Esc 默认立刻 close()，拦下来走统一退场动画
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		close();
	});

	dialog.addEventListener("close", () => {
		if (closing) return;
		dialog.classList.add("hidden");
		dialog.classList.remove("flex");
		unlockScroll();
	});

	// 点遮罩关闭；点在面板内部时 target 不是 dialog
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) close();
	});

	closeBtn?.addEventListener("click", close);

	const bindSwup = (): void => {
		window.swup?.hooks?.on("visit:start", closeImmediately);
	};
	if (window.swup?.hooks) bindSwup();
	else document.addEventListener("swup:enable", bindSwup, { once: true });

	state.openHelp = open;
}

function bindTrigger(state: ShortcutCenter): void {
	if (state.triggerBound) return;
	state.triggerBound = true;

	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (!target.closest("[data-shortcuts-help-trigger]")) return;
		event.preventDefault();
		state.openHelp?.();
	});
}

export function mountShortcuts(): void {
	if (typeof document === "undefined") return;
	const state = center();
	ensureListener(state);
	registerGlobals(state);
	mountHelpDialog(state);
	bindTrigger(state);
}
