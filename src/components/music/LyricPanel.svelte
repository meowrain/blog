<script lang="ts">
	import { findActiveLine, type LyricLine } from "./lrc";

	let {
		lines = [],
		currentTime = 0,
		onseek,
	}: {
		lines?: LyricLine[];
		currentTime?: number;
		onseek?: (time: number) => void;
	} = $props();

	const active = $derived(findActiveLine(lines, currentTime));

	let scroller: HTMLDivElement | undefined = $state();
	let follow = $state(true);
	let resumeTimer: ReturnType<typeof setTimeout> | undefined;

	// 用户自己滚的时候先别去抢滚动条，手停几秒再恢复跟随。
	// 只监听滚轮 / 触摸这类「人为」事件：程序滚动也会触发 scroll，
	// 真去监听 scroll 的话跟随就永远开不起来了。
	function pauseFollow() {
		follow = false;
		clearTimeout(resumeTimer);
		resumeTimer = setTimeout(() => {
			follow = true;
		}, 4000);
	}

	function followNow() {
		follow = true;
		clearTimeout(resumeTimer);
		scrollToActive();
	}

	// 手算 scrollTop 而不是 scrollIntoView：后者会把外层页面一起滚上去，
	// 边听歌边看歌词时页面会莫名其妙跳动。
	function scrollToActive() {
		if (!scroller || active < 0) return;
		const line = scroller.querySelector<HTMLElement>(`[data-line="${active}"]`);
		if (!line) return;
		scroller.scrollTo({
			top: line.offsetTop - scroller.clientHeight / 2 + line.clientHeight / 2,
			behavior: "smooth",
		});
	}

	$effect(() => {
		if (!follow || active < 0 || !scroller) return;
		scrollToActive();
	});
</script>

{#if lines.length === 0}
	<p class="py-10 text-center text-sm text-50">这首歌还没有歌词</p>
{:else}
	<div class="relative h-full">
		<div
			class="h-full overflow-y-auto px-4 py-6 text-center hide-scrollbar"
			bind:this={scroller}
			onwheel={pauseFollow}
			ontouchmove={pauseFollow}
		>
			{#each lines as line, index (line.time)}
				<button
					type="button"
					data-line={index}
					class="music-lyric-line block w-full cursor-pointer rounded-md px-2 py-1.5 text-sm leading-relaxed transition"
					class:is-active={index === active}
					onclick={() => onseek?.(line.time)}
				>
					<span class="block">{line.text}</span>
					{#if line.translation}
						<span class="mt-0.5 block text-xs opacity-70">{line.translation}</span>
					{/if}
				</button>
			{/each}
			<div class="h-16"></div>
		</div>

		{#if !follow}
			<button
				type="button"
				class="music-lyric-follow"
				onclick={followNow}
				title="回到正在唱的这一句"
			>
				回到当前
			</button>
		{/if}
	</div>
{/if}

<style>
	.music-lyric-line {
		color: var(--btn-content);
	}

	.music-lyric-line:hover {
		background-color: var(--btn-plain-bg-hover);
	}

	.music-lyric-line.is-active {
		color: var(--primary);
		font-weight: 700;
		transform: scale(1.04);
	}

	.music-lyric-follow {
		position: absolute;
		right: 0.75rem;
		bottom: 0.75rem;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--btn-content);
		background-color: var(--btn-regular-bg);
	}

	.music-lyric-follow:hover {
		background-color: var(--btn-regular-bg-hover);
	}
</style>