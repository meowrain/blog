/**
 * 时间胶囊：碎碎念写了 unlockAt 时，构建期没到点就先折起正文。
 * 页面是静态的，不会因为到点而重新构建，所以由这里负责：
 *   1. 每秒刷新「还有 N 天 HH:MM:SS」倒计时；
 *   2. 到点后把 data-sealed 翻成 false，CSS 自动展开正文与徽章，计时器自停。
 *
 * Swup 换页后 DOM 会被替换，Layout 在 page:view 时会重新调用 mountTimeCapsules()。
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** 和 personal-core.ts 的 formatCountdown 保持同一套文案。 */
function formatCountdown(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	return days > 0 ? `${days} 天 ${clock}` : clock;
}

function reveal(capsule: HTMLElement): void {
	capsule.dataset.sealed = "false";
	capsule.dispatchEvent(
		new CustomEvent("time-capsule:unlocked", { bubbles: true }),
	);
}

/** 刷新一条胶囊，返回它是否已经不需要再计时。 */
function tick(capsule: HTMLElement): boolean {
	const raw = capsule.dataset.unlockAt;
	if (!raw) return true;
	const unlockAt = Date.parse(raw);
	if (Number.isNaN(unlockAt)) return true;

	const remaining = unlockAt - Date.now();
	const countdown = capsule.querySelector<HTMLElement>(
		"[data-capsule-countdown]",
	);
	if (remaining <= 0) {
		if (countdown) countdown.textContent = "00:00:00";
		// 首页「最近在记」的胶囊只显示一行摘要，到点换成 data-capsule-title 里的真实标题
		const titleEl = capsule.querySelector<HTMLElement>("[data-capsule-title]");
		if (titleEl) titleEl.textContent = titleEl.dataset.capsuleTitle ?? "";
		reveal(capsule);
		return true;
	}
	if (countdown) countdown.textContent = formatCountdown(remaining);
	return false;
}

let timer: number | undefined;
let pending = new Set<HTMLElement>();

function stopTimer(): void {
	if (timer !== undefined) {
		window.clearInterval(timer);
		timer = undefined;
	}
}

function run(): void {
	for (const capsule of pending) {
		// Swup 已经把旧节点换掉了，不用再管
		if (!capsule.isConnected) {
			pending.delete(capsule);
			continue;
		}
		if (tick(capsule)) pending.delete(capsule);
	}
	if (pending.size === 0) stopTimer();
}

/** 给页面上所有时间胶囊接上倒计时；重复调用是幂等的。 */
export function mountTimeCapsules(): void {
	if (typeof document === "undefined") return;

	stopTimer();
	pending = new Set();

	for (const capsule of document.querySelectorAll<HTMLElement>(
		"[data-time-capsule][data-unlock-at]",
	)) {
		// 构建时就已经过了解锁时间，服务端已经按展开状态渲染
		if (capsule.dataset.sealed === "false") continue;
		// 先立刻刷新一次，避免等满一秒才看到正确倒计时
		if (!tick(capsule)) pending.add(capsule);
	}

	if (pending.size === 0) return;
	timer = window.setInterval(run, 1000);
}
