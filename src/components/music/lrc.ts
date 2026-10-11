/**
 * 网易云歌词（LRC）解析。
 *
 * 上游给的是标准 LRC 文本，但有两类行必须剔掉：
 *   - 元信息行：[by:xxx]、[offset:0] 这种没有正文的；
 *   - 无时间戳的文案行：`作词 : 杨明学` 这类只在开头出现一次，跟着滚会很难看。
 * 翻译（tlyric）与原文共用同一套时间戳，按毫秒对齐后挂到对应行上。
 */

export type LyricLine = {
	time: number;
	text: string;
	translation?: string;
};

function tagToSeconds(minutes: string, seconds: string, fraction = ""): number {
	const ms = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
	return Number(minutes) * 60 + Number(seconds) + ms / 1000;
}

/** 把一份 LRC 收集成 「毫秒 -> 文本」，同一时间戳只保留第一次出现的文本。 */
function collect(source: string): Map<number, string> {
	const collected = new Map<number, string>();
	if (!source) return collected;

	const tag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
	for (const raw of source.split("\n")) {
		const text = raw.replace(tag, "").trim();
		if (!text) continue;

		tag.lastIndex = 0;
		let match = tag.exec(raw);
		while (match) {
			const key = Math.round(tagToSeconds(match[1], match[2], match[3]) * 1000);
			if (!collected.has(key)) collected.set(key, text);
			match = tag.exec(raw);
		}
	}
	return collected;
}

export function parseLrc(lyric: string, tlyric = ""): LyricLine[] {
	const translations = collect(tlyric);
	const lines: LyricLine[] = [];
	for (const [time, text] of collect(lyric)) {
		lines.push({ time: time / 1000, text, translation: translations.get(time) });
	}
	return lines.sort((a, b) => a.time - b.time);
}

/** 二分找当前高亮行：最后一条 time <= currentTime 的歌词；都没到就返回 -1。 */
export function findActiveLine(lines: LyricLine[], currentTime: number): number {
	let low = 0;
	let high = lines.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lines[mid].time <= currentTime) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}