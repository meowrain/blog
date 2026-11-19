/**
 * 浏览器语音合成（Web Speech API）的薄封装 —— 电台念串词用。
 *
 * 为什么先用它而不是云 TTS：零配置、零延迟，用来验证「念串词 → 放歌」这个
 * 节奏成不成立最快。真要换音质时只需替换 speak() 的实现（云 TTS 返回音频，
 * 用 <audio> 播），调用方不用动。
 *
 * 注意三件事：
 * 1. 中文声音在各平台差异很大（Windows 有 Huihui/Xiaoxiao，macOS 有 Tingting，
 *    Android 往往只有一个合成音），所以只做「尽量挑中文」，不保证音色。
 * 2. 部分浏览器 onend 不触发（尤其切后台 / 锁屏），所以有按字数估算的超时兜底，
 *    否则串词念完也永远等不到 resolve，歌就永远不开始。
 * 3. speak() 不是用户手势里调用的话会被拦；调用方应当在点击事件里同步发起。
 */

const MIN_TIMEOUT_MS = 8_000;
/** 中文语速约 4–5 字/秒，按 4 字/秒估上限，再留一截余量 */
const MS_PER_CHAR = 400;

export function canSpeak(): boolean {
	return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 让测试 / 调试能判断当前是否还有一段在念 */
let speaking = false;

export function isSpeaking(): boolean {
	return speaking;
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

/**
 * 念一段话，念完 resolve。不可用、被浏览器拦掉、出错都立刻 resolve ——
 * 串词只是锦上添花，绝不能因为它卡住歌的播放。
 */
export function speak(text: string): Promise<void> {
	const content = text.replace(/\s+/g, " ").trim();
	if (!content || !canSpeak()) return Promise.resolve();

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
			utterance.rate = 1;
			utterance.pitch = 1;
			utterance.volume = 1;
			const voice = pickVoice();
			if (voice) utterance.voice = voice;

			utterance.onend = done;
			utterance.onerror = done;

			timer = setTimeout(
				done,
				Math.max(MIN_TIMEOUT_MS, content.length * MS_PER_CHAR),
			);
			speaking = true;
			synth.speak(utterance);
		} catch {
			done();
		}
	});
}

export function cancelSpeech(): void {
	if (!canSpeak()) return;
	try {
		window.speechSynthesis.cancel();
	} catch {
		/* 忽略 */
	}
	speaking = false;
}
