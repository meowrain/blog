import type { ToolDef, ToolResult } from '../_agent-loop';
import { artistMusic, rememberTracks, searchMusic, type MusicHit } from '../_music';

/**
 * `/assistant` 的电台工具 —— 两条：`radio_tracks` 找歌，`radio_play` 出播放卡。
 *
 * 为什么要分成两步而不是一条：
 * - 找歌可以来回搜（换关键词、换歌手），结果不用呈现给访客；
 * - 出卡需要模型为**每一首**写一句串词，那是它的活儿，不是搜索接口的活儿。
 * 合成一条的话，模型只能在拿到结果的同一轮里硬塞串词，搜错了也得带着错误答案出卡。
 *
 * ## 曲库
 *
 * 搜索走 `source=all`：网易云 + QQ 各问一遍再合并（见 agents/_music.ts 与
 * cloud-functions/_qqmusic.js）。两家的免费曲库不重合，只问一家会让
 * 「毛不易」「周杰伦」这类歌手里总有一半永远搜不到。结果里的 `source`
 * 只标注来源，出卡时原样带上，前端按它分流取播放地址。
 *
 * ## 这个电台的天花板（写在这里，免得以后有人以为它更聪明）
 *
 * 搜索接口按字面匹配，模型没听过这些歌，也没有音频特征。所以：
 * - 能做的：按歌手、歌名、题材词精确取歌，用搜索结果和歌词开头写串词；
 * - 不能做的：判断一首歌"是不是适合写代码"，也不能说"这首副歌很抓耳"。
 * 系统提示里对模型有同样的约束（见 index.ts 的 RADIO_RULES）。
 */

/** 串词长度上限：念出来 20–30 秒，等歌开始的耐心差不多就这么多 */
const MAX_INTRO_CHARS = 140;
/** 一次出卡最多几首 */
const MAX_PICKS = 8;
/** 一次搜索最多几首 */
const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 8;

/** 找歌 / 出卡共用的会话状态 —— id 白名单就靠它 */
export interface RadioCtx {
	origin: string;
	/** 本次请求里真实搜到过的曲目（id → 曲目） */
	heard: Map<string, MusicHit>;
	signal?: AbortSignal;
}

function toResult(hit: MusicHit): Record<string, unknown> {
	return {
		id: hit.id,
		name: hit.name,
		artists: hit.artists,
		...(hit.album ? { album: hit.album } : {}),
		duration: Math.round(hit.duration / 1000),
		...(hit.source ? { source: hit.source } : {}),
		...(hit.trial ? { trial: true } : {}),
		...(hit.sameName ? { sameName: true } : {}),
		...(hit.lyric ? { lyric: hit.lyric } : {}),
	};
}

const SEARCH_HINT =
	'这些是网易云 / QQ 音乐里真实存在、且确认能播放的曲目（source 标了来自哪家，id 原样带回即可）。' +
	'"适合XX"这类题材词按字面匹配，结果往往跑偏；要按氛围选歌，先用 web_search 查"XX 风格 歌手 推荐"，' +
	'拿到具体的歌手名/歌名再回来搜。挑好后用 radio_play 出播放卡，每首配一句串词。';

async function radioTracks(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as RadioCtx;
	const mode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : 'search';
	const query = typeof args.query === 'string' ? args.query.trim() : '';

	const limitRaw = Number(args.limit);
	const limit =
		Number.isFinite(limitRaw) && limitRaw > 0
			? Math.min(Math.trunc(limitRaw), MAX_LIMIT)
			: DEFAULT_LIMIT;

	try {
		if (mode === 'artist') {
			const name = typeof args.artist === 'string' ? args.artist.trim() : query;
			if (!name) {
				return { summary: '缺少歌手名', content: JSON.stringify({ error: 'mode=artist 需要 artist 或 query' }) };
			}
			const found = await artistMusic({ origin: state.origin, name, limit, signal: state.signal });
			if (!found.results.length) {
				return {
					summary: `没找到歌手「${name}」的歌`,
					content: JSON.stringify({
						query: name,
						count: 0,
						hint:
							'没搜到这个歌手，或者他的歌在这儿都放不了。换成歌手全名再试一次，' +
							'或者改用 mode:"search" 按歌名找。',
					}),
				};
			}
			rememberTracks(state.heard, found.results);
			return {
				summary: `「${found.artist?.name || name}」取了 ${found.results.length} 首`,
				content: JSON.stringify({
					artist: found.artist?.name || name,
					count: found.results.length,
					results: found.results.map(toResult),
					hint: SEARCH_HINT,
				}),
			};
		}

		if (mode !== 'search') {
			return {
				summary: `未知的 mode：${mode}`,
				content: JSON.stringify({ error: 'mode 只能是 search / artist', hint: '按关键词找用 search，按歌手找用 artist。' }),
			};
		}

		if (!query) {
			return { summary: '缺少 query 参数', content: JSON.stringify({ error: 'mode=search 需要 query' }) };
		}

		// 默认带歌词：模型没听过歌，只给歌名写出来的串词全是"希望你喜欢"
		const wantLyric = args.lyric !== false;
		const found = await searchMusic({ origin: state.origin, query, limit, lyric: wantLyric, signal: state.signal });
		if (!found.results.length) {
			return {
				summary: `搜「${query}」没有能放的歌`,
				content: JSON.stringify({
					query,
					count: 0,
					hint:
						'搜出来要么没有结果，要么都不能播放（无版权/下架）。换个说法再搜一次，' +
						'换成歌手名试试（mode:"artist"），或者先用 web_search 查一下这位歌手叫什么。两三次都不行就如实告诉访客。',
				}),
			};
		}

		rememberTracks(state.heard, found.results);
		return {
			summary: `搜「${query}」得到 ${found.results.length} 首能放的`,
			content: JSON.stringify({
				query,
				count: found.results.length,
				...(found.found && found.found > found.results.length
					? { note: `上游共 ${found.found} 条，其余不能播放已滤掉` }
					: {}),
				results: found.results.map(toResult),
				hint: SEARCH_HINT,
			}),
		};
	} catch (e) {
		const message = (e as Error).message || String(e);
		return {
			summary: `音乐搜索失败：${message.slice(0, 60)}`,
			content: JSON.stringify({
				error: message,
				hint: '音乐接口这次没通。换一次关键词可以再试；连续失败就如实告诉访客电台暂时用不了，不要编歌名。',
			}),
		};
	}
}

/** 串词收口：压平换行、砍到 TTS 友好的长度 */
function cleanIntro(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const text = raw.replace(/\s+/g, ' ').trim();
	// 用 Array.from 按码点截，直接 slice 会把 emoji / 生僻字切成半个
	const chars = Array.from(text);
	return chars.length > MAX_INTRO_CHARS ? `${chars.slice(0, MAX_INTRO_CHARS - 1).join('')}…` : text;
}

interface Pick {
	id: string;
	intro: string;
	track: MusicHit;
}

async function radioPlay(args: Record<string, unknown>, ctx: unknown): Promise<ToolResult> {
	const state = ctx as RadioCtx;
	const rawPicks = Array.isArray(args.picks) ? args.picks : [];

	const picks: Pick[] = [];
	const rejected: string[] = [];
	for (const item of rawPicks) {
		if (picks.length >= MAX_PICKS) break;
		const record = (item ?? {}) as Record<string, unknown>;
		const id = String(record.id ?? '').trim();
		const track = state.heard.get(id);
		if (!track) {
			rejected.push(id || '(空 id)');
			continue;
		}
		// 同一首点两次就只留第一次
		if (picks.some((pick) => pick.id === id)) continue;
		picks.push({ id, intro: cleanIntro(record.intro), track });
	}

	if (!picks.length) {
		return {
			summary: '没有可播的曲目',
			content: JSON.stringify({
				error: 'picks 里没有一首是本次真的搜到过的歌',
				rejected,
				hint:
					'id 必须来自 radio_tracks 的结果，不能自己拼。先用 radio_tracks 搜，然后把结果里的 id 原样带回来。',
			}),
		};
	}

	const missingIntro = picks.filter((pick) => !pick.intro).length;

	return {
		summary: `生成播放卡：${picks.length} 首${rejected.length ? `（${rejected.length} 个 id 无效已丢弃）` : ''}`,
		content: JSON.stringify({
			card: {
				title: typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 40) : '电台',
				tracks: picks.map((pick) => ({
					id: pick.id,
					name: pick.track.name,
					artists: pick.track.artists,
					cover: pick.track.cover,
					duration: Math.round(pick.track.duration / 1000),
					...(pick.track.source ? { source: pick.track.source } : {}),
					...(pick.track.trial ? { trial: true } : {}),
					intro: pick.intro,
				})),
			},
			...(rejected.length ? { rejected } : {}),
			...(missingIntro ? { warning: `${missingIntro} 首没有串词，前端会直接放歌` } : {}),
			hint:
				'播放卡已经出现在对话里了。访客点了播放键才会出声，不要写成"正在为你播放"。' +
				'现在用一两句话说明这一批的思路，不要重复卡片里已有的串词。',
		}),
	};
}

export const RADIO_TOOLS: ToolDef[] = [
	{
		name: 'radio_tracks',
		description:
			'在网易云音乐和 QQ 音乐里搜歌（两家曲库互补，默认一起问），返回**确认能播放**的曲目' +
			'（无版权、下架、同名翻唱的废条目已经滤掉）。电台点歌的第一步。\n' +
			'- mode:"search"（默认）：按关键词找。歌名、歌手名很准；"适合写代码""下雨天听的"这类题材词只是字面匹配，' +
			'结果经常跑偏 —— 想要氛围，先用 web_search 查到具体的歌手/歌名，再回来搜。\n' +
			'- mode:"artist"：按歌手取热门歌，能播率比关键词搜索高，适合访客说"放点 XXX 的歌"。\n' +
			'每条结果带 id、歌名、歌手、时长和 source（netease / qq），默认还带开头两三句歌词 —— ' +
			'写串词请用它，不要凭空描述你没听过的旋律。id 原样带回 radio_play 即可，source 不用管。',
		parameters: {
			type: 'object',
			properties: {
				mode: { type: 'string', enum: ['search', 'artist'], description: 'search（默认）按关键词，artist 按歌手' },
				query: { type: 'string', description: 'mode=search 时的关键词：歌名、歌手名、"民谣 深夜"这类短语' },
				artist: { type: 'string', description: 'mode=artist 时的歌手名' },
				limit: { type: 'integer', description: `返回几首，默认 ${DEFAULT_LIMIT}，最多 ${MAX_LIMIT}` },
				lyric: { type: 'boolean', description: '是否带歌词片段，默认 true；只想看看有哪些歌时可以传 false 省上下文' },
			},
		},
		run: radioTracks,
	},
	{
		name: 'radio_play',
		description:
			'把选好的歌做成一张播放卡，每首配一句串词。访客点播放键后，前端会先念串词、再放歌。\n' +
			'id 必须原样来自 radio_tracks 的结果，否则会被丢掉。\n' +
			'串词 60–120 字最合适（念出来 20–30 秒），写成电台主持人开场的那种语气：' +
			'可以提歌名、歌手、歌词里的句子，**不要**说你听过、不要说旋律好不好听。',
		parameters: {
			type: 'object',
			properties: {
				title: { type: 'string', description: '这一期电台的标题，如「深夜代码电台」，最多 20 字' },
				picks: {
					type: 'array',
					description: `按播放顺序，最多 ${MAX_PICKS} 首`,
					items: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'radio_tracks 结果里的 id，原样复制' },
							intro: { type: 'string', description: `这一首的串词，60–120 字，最多 ${MAX_INTRO_CHARS} 字` },
						},
						required: ['id', 'intro'],
					},
				},
			},
			required: ['picks'],
		},
		run: radioPlay,
	},
];
