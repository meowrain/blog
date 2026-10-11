<script lang="ts">
/**
 * 404 页的贪吃蛇，用 17×17 的 DOM 网格画棋盘。
 *
 * 为什么不用 canvas：格子颜色全走 CSS 变量（--primary / --btn-regular-bg），
 * 切深色模式、换主题色都不用重绘；每走一步只改格子的 data-s，289 个格子开销可以忽略。
 *
 * 键盘只在「正在玩」或「棋盘拿到焦点」时才接管 —— 否则会把页面方向的滚动抢走。
 */
import { onDestroy, onMount } from "svelte";

const GRID = 17;
const COUNT = GRID * GRID;
const BEST_KEY = "eo_404_snake_best";

const EMPTY = 0;
const BODY = 1;
const HEAD = 2;
const FOOD = 3;

type Status = "idle" | "playing" | "paused" | "over";
type Dir = { x: number; y: number };

const KEY_DIRS: Record<string, Dir> = {
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	w: { x: 0, y: -1 },
	s: { x: 0, y: 1 },
	a: { x: -1, y: 0 },
	d: { x: 1, y: 0 },
	W: { x: 0, y: -1 },
	S: { x: 0, y: 1 },
	A: { x: -1, y: 0 },
	D: { x: 1, y: 0 },
};

let rootEl = $state<HTMLDivElement | null>(null);
let cells: number[] = $state.raw(Array(COUNT).fill(EMPTY));
let status = $state<Status>("idle");
let score = $state(0);
let best = $state(0);
let length = $state(3);

let snake: number[] = []; // 蛇身格子下标，snake[0] 是头
let food = -1;
let dir: Dir = { x: 1, y: 0 };
let queued: Dir[] = []; // 每个 tick 只消化一个方向，连按再快也不会原地掉头
let tickMs = 150;
let carry = 0;
let lastFrame = 0;
let rafId = 0;
let swipeFrom: { x: number; y: number } | null = null;

/** 越长越快，但留个下限，别玩成手速测试 */
function speedFor(len: number): number {
	return Math.max(72, 160 - (len - 3) * 4);
}

function paint(): void {
	const next = Array(COUNT).fill(EMPTY) as number[];
	for (const idx of snake) next[idx] = BODY;
	if (snake.length > 0) next[snake[0]] = HEAD;
	if (food >= 0) next[food] = FOOD;
	cells = next;
}

function placeFood(): void {
	const taken = new Set(snake);
	const free: number[] = [];
	for (let i = 0; i < COUNT; i++) if (!taken.has(i)) free.push(i);
	food = free.length > 0 ? free[Math.floor(Math.random() * free.length)] : -1;
}

function reset(): void {
	const row = Math.floor(GRID / 2);
	const col = Math.floor(GRID / 2) - 1;
	snake = [row * GRID + col + 1, row * GRID + col, row * GRID + col - 1];
	dir = { x: 1, y: 0 };
	queued = [];
	carry = 0;
	tickMs = speedFor(snake.length);
	score = 0;
	length = snake.length;
	placeFood();
	paint();
}

function start(): void {
	reset();
	status = "playing";
	lastFrame = performance.now();
	rootEl?.focus({ preventScroll: true });
}

function pause(): void {
	if (status === "playing") status = "paused";
}

function resume(): void {
	if (status !== "paused") return;
	status = "playing";
	carry = 0;
	lastFrame = performance.now();
}

function toggle(): void {
	if (status === "playing") pause();
	else if (status === "paused") resume();
	else start();
}

function queueTurn(next: Dir): void {
	const last = queued.length > 0 ? queued[queued.length - 1] : dir;
	if (last.x === next.x && last.y === next.y) return;
	if (last.x === -next.x && last.y === -next.y) return;
	if (queued.length < 2) queued.push(next);
}

/** 有输入时统一走这里：没开局就先开局，暂停中就接着跑 */
function direct(next: Dir): void {
	if (status === "playing") {
		queueTurn(next);
		return;
	}
	if (status === "paused") resume();
	else start();
	queueTurn(next);
}

function end(): void {
	status = "over";
	if (score > best) {
		best = score;
		try {
			localStorage.setItem(BEST_KEY, String(best));
		} catch {
			// 无痕模式下 localStorage 会抛异常，不存就是了
		}
	}
	rootEl?.focus({ preventScroll: true });
}

function step(): void {
	const turn = queued.shift();
	if (turn) dir = turn;

	const head = snake[0];
	const x = (head % GRID) + dir.x;
	const y = Math.floor(head / GRID) + dir.y;
	if (x < 0 || y < 0 || x >= GRID || y >= GRID) {
		end();
		return;
	}

	const next = y * GRID + x;
	const eats = next === food;
	// 不吃食物时尾巴会让出这一格，所以「头撞尾巴」是合法的
	const occupied = eats ? snake : snake.slice(0, -1);
	if (occupied.includes(next)) {
		end();
		return;
	}

	snake.unshift(next);
	if (eats) {
		score += 1;
		placeFood();
	} else {
		snake.pop();
	}
	length = snake.length;
	tickMs = speedFor(snake.length);
	paint();
}

function frame(now: number): void {
	rafId = requestAnimationFrame(frame);
	// 兜底：swup 换页时 island 可能被直接摘掉，没人来调 destroy
	if (!rootEl?.isConnected) {
		destroy();
		return;
	}
	const delta = Math.min(now - lastFrame, 240);
	lastFrame = now;
	if (status !== "playing") return;
	carry += delta;
	while (carry >= tickMs && status === "playing") {
		carry -= tickMs;
		step();
	}
}

function onKeyDown(event: KeyboardEvent): void {
	if (!rootEl?.isConnected) return;
	const target = event.target as HTMLElement | null;
	if (target?.closest("input, textarea, select, [contenteditable]")) return;
	if (event.metaKey || event.ctrlKey || event.altKey) return;

	const focused = rootEl.contains(document.activeElement);
	if (!focused && status !== "playing") return;

	const turn = KEY_DIRS[event.key];
	if (turn) {
		event.preventDefault();
		direct(turn);
		return;
	}
	if (event.key === " " || event.key === "Enter") {
		// 空格/回车落在按钮上时，留给按钮自己响应
		if (target?.closest("button, a")) return;
		event.preventDefault();
		toggle();
	}
}

function onPointerDown(event: PointerEvent): void {
	if (event.pointerType === "mouse") return;
	swipeFrom = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event: PointerEvent): void {
	const from = swipeFrom;
	swipeFrom = null;
	if (!from) return;
	const dx = event.clientX - from.x;
	const dy = event.clientY - from.y;
	const adx = Math.abs(dx);
	const ady = Math.abs(dy);
	// 几乎没滑动 = 轻点：开始 / 暂停
	if (Math.max(adx, ady) < 20) {
		toggle();
		return;
	}
	direct(adx > ady ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
}

function onPointerCancel(): void {
	swipeFrom = null;
}

function onVisibilityChange(): void {
	if (document.hidden) pause();
}

function onWindowBlur(): void {
	pause();
}

function destroy(): void {
	// SSR 收尾时也会走 onDestroy，那会儿没有 window
	if (typeof window === "undefined") return;
	if (rafId) cancelAnimationFrame(rafId);
	rafId = 0;
	window.removeEventListener("keydown", onKeyDown);
	window.removeEventListener("blur", onWindowBlur);
	document.removeEventListener("visibilitychange", onVisibilityChange);
}

onMount(() => {
	try {
		best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
	} catch {
		best = 0;
	}
	reset();
	lastFrame = performance.now();
	rafId = requestAnimationFrame(frame);
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("blur", onWindowBlur);
	document.addEventListener("visibilitychange", onVisibilityChange);
});

onDestroy(destroy);
</script>

<div class="snake" bind:this={rootEl} tabindex="-1" role="group" aria-label="404 小游戏：贪吃蛇">
	<div class="stage">
		<div
			class="board"
			class:shake={status === "over"}
			style={`--grid: ${GRID}`}
			onpointerdown={onPointerDown}
			onpointerup={onPointerUp}
			onpointercancel={onPointerCancel}
		>
			{#each cells as cell}
				<div class="cell" data-s={cell}></div>
			{/each}
		</div>

		{#if status !== "playing"}
			<button type="button" class="overlay" onclick={toggle}>
				{#if status === "idle"}
					<span class="text-sm font-bold text-90">贪吃蛇</span>
					<span class="text-xs text-50">点一下，或者按方向键开玩</span>
				{:else if status === "paused"}
					<span class="text-sm font-bold text-90">已暂停</span>
					<span class="text-xs text-50">点一下接着玩</span>
				{:else}
					<span class="text-sm font-bold text-90">撞墙了 · 得分 {score}</span>
					<span class="text-xs text-50">点一下再来一局</span>
				{/if}
			</button>
		{/if}
	</div>

	<div class="hud">
		<div class="flex items-center gap-2.5 font-mono text-[0.7rem] tracking-wider text-50">
			<span>SCORE <b class="tabular-nums text-90">{score.toString().padStart(3, "0")}</b></span>
			<span>BEST <b class="tabular-nums text-90">{best.toString().padStart(3, "0")}</b></span>
			<span>LEN <b class="tabular-nums text-90">{length.toString().padStart(2, "0")}</b></span>
		</div>
		<div class="flex items-center gap-1.5">
			<button
				type="button"
				class="btn-regular rounded-lg px-2.5 py-1 text-xs font-medium"
				onclick={toggle}
			>
				{status === "playing" ? "暂停" : status === "paused" ? "继续" : "开始"}
			</button>
			<button
				type="button"
				class="btn-regular rounded-lg px-2.5 py-1 text-xs font-medium"
				onclick={start}
			>
				重开
			</button>
		</div>
	</div>

	<div class="dpad">
		<button
			type="button"
			class="key up btn-regular"
			aria-label="向上"
			onclick={() => direct({ x: 0, y: -1 })}>▲</button
		>
		<button
			type="button"
			class="key left btn-regular"
			aria-label="向左"
			onclick={() => direct({ x: -1, y: 0 })}>◀</button
		>
		<button
			type="button"
			class="key down btn-regular"
			aria-label="向下"
			onclick={() => direct({ x: 0, y: 1 })}>▼</button
		>
		<button
			type="button"
			class="key right btn-regular"
			aria-label="向右"
			onclick={() => direct({ x: 1, y: 0 })}>▶</button
		>
	</div>

	<p class="text-[0.7rem] leading-relaxed text-50">方向键 / WASD / 手机滑动棋盘 · 空格暂停</p>
</div>

<style>
	.snake {
		--food: oklch(0.68 0.19 32);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.65rem;
		outline: none;
	}

	:global(html.dark) .snake {
		--food: oklch(0.78 0.16 45);
	}

	.stage {
		position: relative;
		width: min(100%, 20rem);
	}

	.board {
		display: grid;
		grid-template-columns: repeat(var(--grid), minmax(0, 1fr));
		grid-template-rows: repeat(var(--grid), minmax(0, 1fr));
		gap: 2px;
		aspect-ratio: 1;
		padding: 0.5rem;
		border-radius: 0.85rem;
		background-color: var(--btn-regular-bg);
		touch-action: none;
		user-select: none;
	}

	.board.shake {
		animation: board-shake 0.4s ease-out;
	}

	@keyframes board-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		30% {
			transform: translateX(-4px);
		}
		60% {
			transform: translateX(4px);
		}
	}

	.cell {
		background-color: var(--primary);
		border-radius: 30%;
		opacity: 0;
		transition: opacity 70ms linear, transform 90ms ease-out, background-color 160ms linear;
	}

	.cell[data-s="1"] {
		opacity: 0.6;
		transform: scale(0.92);
	}

	.cell[data-s="2"] {
		opacity: 1;
		border-radius: 35%;
	}

	.cell[data-s="3"] {
		background-color: var(--food);
		border-radius: 50%;
		opacity: 1;
		transform: scale(0.78);
	}

	.overlay {
		position: absolute;
		inset: 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		padding: 0.75rem;
		border-radius: 0.6rem;
		background-color: var(--card-bg);
		background-color: color-mix(in oklab, var(--card-bg) 80%, transparent);
		backdrop-filter: blur(2px);
		cursor: pointer;
		text-align: center;
	}

	.overlay:hover {
		background-color: color-mix(in oklab, var(--card-bg) 92%, transparent);
	}

	.hud {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: min(100%, 20rem);
	}

	.dpad {
		display: none;
		grid-template-columns: repeat(3, 2.5rem);
		grid-template-rows: repeat(2, 2.5rem);
		gap: 0.3rem;
	}

	@media (pointer: coarse) {
		.dpad {
			display: grid;
		}
	}

	.dpad .key {
		border-radius: 0.6rem;
		font-size: 0.7rem;
	}

	.dpad .up {
		grid-column: 2;
		grid-row: 1;
	}

	.dpad .left {
		grid-column: 1;
		grid-row: 2;
	}

	.dpad .down {
		grid-column: 2;
		grid-row: 2;
	}

	.dpad .right {
		grid-column: 3;
		grid-row: 2;
	}

	@media (prefers-reduced-motion: reduce) {
		.board.shake {
			animation: none;
		}

		.cell {
			transition: none;
		}
	}
</style>