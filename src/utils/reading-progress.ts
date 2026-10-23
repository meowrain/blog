/**
 * 正文阅读进度。移动端目录的百分比和全局进度条共用同一套算法，
 * 避免两处各算一份、结果还对不上。
 */
export function measureReadingProgress(content: HTMLElement): number {
	const scrollTop =
		window.scrollY ||
		document.documentElement.scrollTop ||
		document.body.scrollTop ||
		0;
	const viewport = window.innerHeight;
	const top = content.getBoundingClientRect().top + scrollTop;
	// 从正文顶部开始计，正文底部露出 85% 视口时算读完
	const start = top - 80;
	const end = top + content.offsetHeight - viewport * 0.85;
	const ratio = (scrollTop - start) / Math.max(end - start, 1);

	return Math.min(1, Math.max(0, ratio));
}
