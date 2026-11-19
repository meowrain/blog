/**
 * 电台串词语音 —— 优先走站内云函数合成的神经语音，失败再回落浏览器内置。
 *
 * ## 为什么要换掉 speechSynthesis
 *
 * Web Speech API 只是「调用系统里的合成器」，音色完全取决于访客机器：macOS 有
 * 婷婷、Windows 有 Huihui，Linux 和不少安卓上只有一个 espeak 式的机械音，
 * 断句也怪。同一个站点在不同人耳朵里天差地别，这不能接受。
 *
 * 所以默认改为请求同源的 `/api/tts/say`（云函数转接 Edge 朗读的神经语音，
 * 默认晓晓，柔和女声），拿回 mp3 用 <audio> 播。前端拿不到音频（函数没部署、
 * 上游超时、限流）时静默回落到浏览器合成，串词照念，只是音色回到机器音。
 *
 * ## 三条容易踩的约束
 *
 * 1. **出声必须在用户手势里发起**。云函数合成要 1–2 秒，等到 mp3 回来早已
 *    丢掉手势，直接 `audio.play()` 会被拦。所以调用方要在点击事件里同步调
 *    `unlockSpeech()`（先放一段静音解锁元素），之后换 src 再 play 就不会被拦。
 * 2. **onend 不可靠**。浏览器 speechSynthesis 切后台常常不触发 onend，所以
 *    保留按字数估算的超时兜底；<audio> 的 ended 更可靠，但一样留了超时。
 * 3. **取消要彻底**。切歌时旧的串词必须立刻停：要同时掐掉 <audio>、未完成的
 *    fetch 和浏览器的 speechSynthesis，否则会听见两段串词叠在一起。
 */

const MIN_TIMEOUT_MS = 8_000;
/** 中文语速约 4–5 字/秒，按 4 字/秒估上限，再留一截余量 */
const MS_PER_CHAR = 400;
/** 云函数合成本身的上限；超时就回落浏览器语音，不让歌一直等着 */
const SYNTH_TIMEOUT_MS = 15_000;

const SILENT_WAV =
	"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

export interface SpeechOptions {
	/** 音色，见 cloud-functions/_edge-tts.js 的 ALLOWED_VOICES */
	voice?: string;
	/** 语速，形如 "-4%" */
	rate?: string;
	/** 音调，形如 "-2Hz" */
	pitch?: string;
	/** 合成接口地址，默认同源 /api/tts/say */
	endpoint?: string;
	/** false = 跳过云端合成，直接用浏览器自带语音 */
	useCloud?: boolean;
}

let options: Required<Omit<SpeechOptions, "useCloud">> & { useCloud: boolean } =
	{
		voice: "zh-CN-XiaoxiaoNeural",
		rate: "-4%",
		pitch: "-2Hz",
		endpoint: "/api/tts/say",
		useCloud: true,
	};

export function configureSpeech(next: SpeechOptions = {}): void {
	options = {
		...options,
		...Object.fromEntries(
			Object.entries(next).filter(([, value]) => value !== undefined),
		),
	};
}

export function canSpeak(): boolean {
	return (
		typeof window !== "undefined" &&
		("speechSynthesis" in window || typeof Audio !== "undefined")
	);
}

/** 让测试 / 调试能判断当前是否还有一段在念 */
let speaking = false;

export function isSpeaking(): boolean {
	return speaking;
}

let cloudAudio: HTMLAudioElement | undefined;
let activeAbort: AbortController | undefined;
/**
 * 每次 speak() / cancelSpeech() 自增。端到端流程里合成要 1–2 秒，这期间用户
 * 可能已经切歌——取消后不能再补一段浏览器语音，所以用代次判断「还算不算数」。
 */
let generation = 0;

/**
 * 在用户手势里调用：把云端语音要用的 <audio> 用一段静音「解锁」。
 *
 * 不解锁的话，等 fetch 回来再 play 一定会被浏览器拦掉 —— 这正好是「点了播放
 * 却没动静」最常见的原因。重复调用无害。
 */
export function unlockSpeech(): void {
	if (typeof Audio === "undefined") return;
	if (!cloudAudio) {
		cloudAudio = new Audio();
		cloudAudio.preload = "auto";
	}
	try {
		cloudAudio.src = SILENT_WAV;
		void cloudAudio.play().catch(() => {
			/* 解锁失败就让上层回落浏览器语音，不影响主流程 */
		});
	} catch {
		/* 忽略 */
	}
}

function pickVoice(): SpeechSynthesisVoice | null {
	try {
		const voices = window.speechSynthesis.getVoices();
		if (!voices.length) return null;
		// 先要 zh-CN，其次任何 zh；同一语言里优先「女声」常见的几个名字
		const zhCn = voices.filter((voice) => /^zh[-_]CN/i.test(voice.lang));
		const pool = zhCn.length
			? zhCn
			: voices.filter((voice) => /^zh/i.test(voice.lang));
		if (!pool.length) return null;
		const preferred = pool.find((voice) =>
			/xiaoxiao|xiaoyi|huihui|tingting|ting-ting|yaoyao|meijia|female|女/i.test(
				voice.name,
			),
		);
		return preferred ?? pool[0];
	} catch {
		return null;
	}
}

function timeoutFor(text: string): number {
	return Math.max(MIN_TIMEOUT_MS, text.length * MS_PER_CHAR);
}

/**
 * 请求云函数合成并播放。任何一步失败都 reject，由 speak() 回落浏览器语音。
 */
async function speakViaCloud(content: string): Promise<void> {
	if (!options.useCloud || typeof fetch === "undefined") {
		throw new Error("云端语音未启用");
	}
	if (!cloudAudio) unlockSpeech();

	const controller = new AbortController();
	activeAbort = controller;
	const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(options.endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				text: content,
				voice: options.voice,
				rate: options.rate,
				pitch: options.pitch,
			}),
			signal: controller.signal,
		});
	} catch (error) {
		// 主动取消（切歌）与网络失败都走这里；后面由 speak() 决定回不回浏览器语音
		activeAbort = undefined;
		throw error;
	} finally {
		clearTimeout(timer);
	}
	if (controller.signal.aborted) {
		activeAbort = undefined;
		throw new Error("合成超时");
	}
	if (!response.ok) {
		activeAbort = undefined;
		throw new Error(`合成接口返回 ${response.status}`);
	}

	const blob = await response.blob();
	if (!blob.size) {
		activeAbort = undefined;
		throw new Error("合成接口返回空音频");
	}

	const audio = cloudAudio ?? new Audio();
	cloudAudio = audio;
	let objectUrl = "";
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		URL.revokeObjectURL(objectUrl);
	};
	try {
		// blob URL 解码时仍要挂着；播完（或失败）再 revoke，不能提前
		objectUrl = URL.createObjectURL(blob);
		audio.src = objectUrl;
		await new Promise<void>((resolve, reject) => {
			let started = false;
			const done = () => {
				cleanup();
				resolve();
			};
			const fail = () => {
				cleanup();
				reject(new Error("云端语音播放失败"));
			};
			const cleanup = () => {
				clearTimeout(fallback);
				audio.removeEventListener("playing", onPlaying);
				audio.removeEventListener("ended", done);
				audio.removeEventListener("error", fail);
				audio.removeEventListener("pause", onPause);
			};
			// play() 的 Promise 在音频真正开始前就 resolve；等 playing 事件才算「念起来了」
			const onPlaying = () => {
				started = true;
				speaking = true;
			};
			// 合成要 1–2 秒，这期间用户可能已经切歌：cancelSpeech 会 pause 掉元素，
			// 此时按取消处理，别让歌一直等一段没人听的串词
			const onPause = () => {
				if (started) done();
				else fail();
			};
			const fallback = setTimeout(() => {
				if (started) done();
				else fail();
			}, timeoutFor(content));
			audio.addEventListener("playing", onPlaying);
			audio.addEventListener("ended", done, { once: true });
			audio.addEventListener("error", fail, { once: true });
			audio.addEventListener("pause", onPause);
			// 解锁过就能直接播；没解锁（比如自动接下一首）会被拦，交给回落
			void audio.play().catch(fail);
		});
		release();
	} finally {
		// 出错时也要释放；重复 revoke 是空操作，但仍用标志挡住重复调用
		release();
		audio.removeAttribute("src");
		activeAbort = undefined;
	}
}

function speakViaBrowser(content: string): Promise<void> {
	if (typeof window === "undefined" || !("speechSynthesis" in window)) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		const synth = window.speechSynthesis;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const done = () => {
			if (settled) return;
			settled = true;
			speaking = false;
			if (timer) clearTimeout(timer);
			resolve();
		};

		// 上一段还没念完就切歌时，新串词要顶掉旧的，否则会排队念完一长串。
		// 只在真的有事可掐时才 cancel：Chrome 里「空 cancel 紧跟 speak」会把整段吞掉。
		if (synth.speaking || synth.pending) {
			try {
				synth.cancel();
			} catch {
				/* 有些浏览器 cancel 会抛，忽略即可 */
			}
		}

		try {
			const utterance = new SpeechSynthesisUtterance(content);
			utterance.lang = "zh-CN";
			// 稍微放慢、压一点音高，比默认的直板语气自然些
			utterance.rate = 0.95;
			utterance.pitch = 0.95;
			utterance.volume = 1;
			const voice = pickVoice();
			if (voice) utterance.voice = voice;

			utterance.onend = done;
			utterance.onerror = done;

			timer = setTimeout(done, timeoutFor(content));
			speaking = true;
			synth.speak(utterance);
		} catch {
			done();
		}
	});
}

/**
 * 念一段话，念完 resolve。云端语音不可用时自动回落浏览器合成；
 * 两者都不可用、被拦掉或出错都立刻 resolve —— 串词只是锦上添花，
 * 绝不能因为它卡住歌的播放。
 */
export async function speak(
	text: string,
	override: SpeechOptions = {},
): Promise<void> {
	const content = text.replace(/\s+/g, " ").trim();
	if (!content || !canSpeak()) return;

	const mine = ++generation;
	const previous = options;
	if (Object.keys(override).length) configureSpeech(override);
	try {
		await speakViaCloud(content);
		return;
	} catch {
		/* 云端不可用：继续走浏览器语音 */
	} finally {
		options = previous;
	}
	// 合成期间用户切歌 / 退电台（cancelSpeech 会自增代次）：不要补一段浏览器语音，
	// 否则「退出了还在说话」。只有这条请求仍然算数时才回落。
	if (mine !== generation) return;
	await speakViaBrowser(content);
}

export function cancelSpeech(): void {
	speaking = false;
	generation += 1;
	try {
		activeAbort?.abort();
	} catch {
		/* 忽略 */
	}
	activeAbort = undefined;
	if (cloudAudio) {
		try {
			cloudAudio.pause();
			cloudAudio.removeAttribute("src");
			cloudAudio.load();
		} catch {
			/* 忽略 */
		}
	}
	if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
	try {
		window.speechSynthesis.cancel();
	} catch {
		/* 忽略 */
	}
}
