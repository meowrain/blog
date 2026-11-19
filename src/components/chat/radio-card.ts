/**
 * `radio_play` 的工具结果 → 播放卡数据。
 *
 * 返回体（见 agents/assistant/_radio.ts）：
 * {
 *   card: {
 *     title: "深夜代码电台",
 *     tracks: [{ id, name, artists, cover, duration, trial?, intro }]
 *   },
 *   rejected?: string[],
 *   warning?: string
 * }
 *
 * 解析失败就返回 null，不出卡片 —— 原始内容还在「查看返回内容」里。
 */

export interface RadioTrack {
	id: string;
	name: string;
	artists: string;
	cover: string;
	/** 秒 */
	duration: number;
	trial: boolean;
	intro: string;
}

export interface RadioCard {
	title: string;
	tracks: RadioTrack[];
}

function str(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 秒 → m:ss，播放卡上显示时长用 */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "";
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function toolRadioCard(content?: string): RadioCard | null {
	if (!content) return null;
	try {
		const parsed = JSON.parse(content);
		const rawTracks = parsed?.card?.tracks;
		if (!Array.isArray(rawTracks)) return null;

		const seen = new Set<string>();
		const tracks: RadioTrack[] = [];
		for (const item of rawTracks) {
			const id = str(item?.id);
			const name = str(item?.name);
			// 没有 id 或歌名的条目播不了，直接丢掉
			if (!id || !name || seen.has(id)) continue;
			seen.add(id);
			tracks.push({
				id,
				name,
				artists: str(item?.artists),
				cover: str(item?.cover),
				duration: Number(item?.duration) || 0,
				trial: Boolean(item?.trial),
				intro: str(item?.intro),
			});
		}
		if (!tracks.length) return null;

		return { title: str(parsed?.card?.title) || "电台", tracks };
	} catch {
		return null;
	}
}

/** 播放卡 → 播放器队列。duration 是秒，Track 里要毫秒。 */
export function toRadioQueue(card: RadioCard) {
	return {
		title: card.title,
		tracks: card.tracks.map((track) => ({
			id: track.id,
			name: track.name,
			artists: track.artists || "未知歌手",
			album: "",
			cover: track.cover,
			duration: track.duration * 1000,
		})),
		intros: card.tracks.map((track) => track.intro),
	};
}
