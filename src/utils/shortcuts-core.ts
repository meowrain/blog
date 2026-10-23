/**
 * 快捷键解析与匹配的纯逻辑，方便单测；DOM 侧见 `src/scripts/shortcuts.ts`。
 *
 * 规格串示例：`?`、`/`、`j`、`mod+k`、`Shift+ArrowRight`、`space`。
 * 序列（如 `g h`）由调用方拆成两步，不在这个模块里处理。
 */

export interface ParsedShortcut {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
	meta: boolean;
}

export interface ShortcutKeyEvent {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
	space: " ",
	esc: "Escape",
	left: "ArrowLeft",
	right: "ArrowRight",
	up: "ArrowUp",
	down: "ArrowDown",
};

const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Escape: "Esc",
	Enter: "Enter",
	Tab: "Tab",
};

export function normalizeKeyName(key: string): string {
	const alias = KEY_ALIASES[key.toLowerCase()];
	if (alias) return alias;
	return key.length === 1 ? key.toLowerCase() : key;
}

export function parseShortcut(spec: string): ParsedShortcut {
	// `+` 本身也是键，直接按分隔符拆会得到空 token
	if (spec === "+") {
		return {
			key: "+",
			mod: false,
			shift: false,
			alt: false,
			ctrl: false,
			meta: false,
		};
	}

	const tokens = spec
		.split("+")
		.map((token) => token.trim())
		.filter(Boolean);
	const keyToken = tokens.pop() ?? "";

	let mod = false;
	let shift = false;
	let alt = false;
	let ctrl = false;
	let meta = false;

	for (const token of tokens) {
		switch (token.toLowerCase()) {
			case "mod":
				mod = true;
				break;
			case "shift":
				shift = true;
				break;
			case "alt":
			case "option":
				alt = true;
				break;
			case "ctrl":
			case "control":
				ctrl = true;
				break;
			case "meta":
			case "cmd":
			case "command":
				meta = true;
				break;
		}
	}

	return { key: normalizeKeyName(keyToken), mod, shift, alt, ctrl, meta };
}

function isLetterOrDigit(key: string): boolean {
	return /^[a-z0-9]$/i.test(key);
}

export function matchesShortcut(
	event: ShortcutKeyEvent,
	shortcut: ParsedShortcut,
): boolean {
	if (normalizeKeyName(event.key) !== shortcut.key) return false;

	if (shortcut.mod) {
		// mod 在 mac 上是 ⌘，其他平台是 Ctrl；两种都认，避免平台判断写错导致快捷键失灵
		if (!event.metaKey && !event.ctrlKey) return false;
	} else {
		if (shortcut.ctrl !== event.ctrlKey) return false;
		if (shortcut.meta !== event.metaKey) return false;
	}

	if (shortcut.alt !== event.altKey) return false;

	// 字母/数字键要求 Shift 状态精确匹配；`?`、`/` 这类字符本身已经包含 Shift 语义，
	// 比较 key 就够了，否则 `?` 永远匹配不上。
	if (isLetterOrDigit(shortcut.key)) {
		if (shortcut.shift !== event.shiftKey) return false;
	} else if (shortcut.shift && !event.shiftKey) {
		return false;
	}

	return true;
}

function displayKey(key: string): string {
	if (KEY_LABELS[key]) return KEY_LABELS[key];
	return key.length === 1 ? key.toUpperCase() : key;
}

/** 把规格串拆成用于 `<kbd>` 的显示片段，例如 `mod+k` -> ["⌘", "K"] */
export function formatShortcutTokens(spec: string, isMac: boolean): string[] {
	const shortcut = parseShortcut(spec);
	const tokens: string[] = [];

	if (shortcut.mod) tokens.push(isMac ? "⌘" : "Ctrl");
	if (shortcut.meta && !shortcut.mod) tokens.push(isMac ? "⌘" : "Meta");
	if (shortcut.ctrl && !shortcut.mod) tokens.push("Ctrl");
	if (shortcut.alt) tokens.push(isMac ? "⌥" : "Alt");
	if (shortcut.shift) tokens.push(isMac ? "⇧" : "Shift");
	tokens.push(displayKey(shortcut.key));

	return tokens;
}
