interface NodeConfig {
	uuid: string;
	name: string;
	cpu_name?: string;
	cpu_cores?: number;
	arch?: string;
	os?: string;
	region?: string;
	group?: string;
	tags?: string;
	hidden?: boolean;
	mem_total?: number;
	disk_total?: number;
	traffic_limit?: number;
	traffic_limit_type?: string;
	expired_at?: string | null;
}

interface NodeStatus {
	client: string;
	time: string;
	cpu: number;
	ram: number;
	ram_total: number;
	swap: number;
	swap_total: number;
	load: number;
	load5?: number;
	load15?: number;
	disk: number;
	disk_total: number;
	net_in: number;
	net_out: number;
	net_total_up: number;
	net_total_down: number;
	process?: number;
	connections?: number;
	connections_udp?: number;
	online: boolean;
	uptime: number;
}

interface Sample {
	t: number;
	up: number;
	down: number;
}

const POLL_MS = 5000;
const CONFIG_MS = 120000;
const HISTORY_SEED_MS = 3600000;
const MAX_SAMPLES = 72;
const STALE_MS = 90000;
const REQUEST_TIMEOUT_MS = 12000;
const FALLBACK_RPC_URL = "/api/komari/rpc2";

let activeRoot: HTMLElement | null = null;
let cleanupPage: (() => void) | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let requestController: AbortController | null = null;
let lastUsedMethod = "";

let configs = new Map<string, NodeConfig>();
let statuses = new Map<string, NodeStatus>();
let history: Sample[] = [];
let historySeeded = false;
let activeGroup = "全部";
let autoRefresh = true;
let lastError: string | null = null;
let hasRenderedData = false;
let lastConfigAt = 0;

function getElement<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function rpcUrl(): string {
	return activeRoot?.dataset.rpcUrl || FALLBACK_RPC_URL;
}

// 一次 JSON-RPC 调用；返回 result，出错抛 Error(message 面向用户)。
async function rpc<T>(
	method: string,
	params: Record<string, unknown> = {},
): Promise<T> {
	lastUsedMethod = method;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	requestController = controller;

	try {
		const response = await fetch(rpcUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Date.now() % 100000,
				method,
				params,
			}),
			signal: controller.signal,
		});

		const text = await response.text();
		let payload: { result?: unknown; error?: { message?: string } };
		try {
			payload = JSON.parse(text);
		} catch {
			// 代理没部署时这里通常回一段 HTML 404，需要和真正的接口错误区分开。
			throw new Error("PROXY_MISSING");
		}
		if (!response.ok && payload?.error === undefined) {
			throw new Error(`HTTP ${response.status}`);
		}
		if (payload?.error) {
			throw new Error(payload.error.message || "接口返回错误");
		}
		return payload.result as T;
	} finally {
		clearTimeout(timer);
		if (requestController === controller) requestController = null;
	}
}

/* ---------- 格式化 ---------- */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

function formatBytes(n: number | undefined | null): {
	value: string;
	unit: string;
} {
	if (!n || n < 0 || !Number.isFinite(n)) return { value: "0", unit: "B" };
	let idx = 0;
	let v = n;
	while (v >= 1024 && idx < UNITS.length - 1) {
		v /= 1024;
		idx += 1;
	}
	const dec = idx === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
	return { value: v.toFixed(dec), unit: UNITS[idx] };
}

function byteSize(n: number | undefined | null): string {
	const { value, unit } = formatBytes(n);
	return `${value} ${unit}`;
}

// 与面板原有显示口径一致，按字节/秒展示吞吐。
function rate(bytesPerSec: number | undefined | null): {
	value: string;
	unit: string;
} {
	const bps = Math.max(0, Number(bytesPerSec) || 0);
	if (bps < 1) return { value: "0", unit: "B/s" };
	const steps: Array<[string, number]> = [
		["KB/s", 1024],
		["MB/s", 1024 ** 2],
		["GB/s", 1024 ** 3],
		["TB/s", 1024 ** 4],
	];
	let chosen: [string, number] = ["B/s", 1];
	for (const step of steps) {
		if (bps >= step[1]) chosen = step;
	}
	const v = bps / chosen[1];
	const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
	return { value: v.toFixed(dec), unit: chosen[0] };
}

function formatUptime(seconds: number | undefined | null): string {
	const s = Math.max(0, Math.floor(Number(seconds) || 0));
	if (s <= 0) return "—";
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d} 天 ${h} 小时`;
	if (h > 0) return `${h} 小时 ${m} 分`;
	return `${m} 分`;
}

function formatPercent(value: number | undefined | null, digits = 1): string {
	const v = Number(value);
	if (!Number.isFinite(v)) return "0";
	return v.toFixed(v >= 100 ? 0 : digits);
}

function clockOf(ms: number): string {
	return new Date(ms).toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

// 负载条配色：0–50% 绿，之后平滑过渡到琥珀与红。
function toneColor(fraction: number | null | undefined): string {
	const f = Math.max(0, Math.min(1, Number(fraction) || 0));
	const hue = f <= 0.5 ? 150 - (f / 0.5) * 22 : 128 - ((f - 0.5) / 0.5) * 116;
	const chroma = 0.15 + f * 0.06;
	const light = 0.6 - f * 0.04;
	return `oklch(${light.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}

/* ---------- 数据聚合 ---------- */

function visibleUuids(): string[] {
	return [...configs.keys()].filter(
		(uuid) => configs.get(uuid)?.hidden !== true,
	);
}

function isFresh(status: NodeStatus | undefined): boolean {
	if (!status) return false;
	const at = Date.parse(status.time);
	if (!Number.isFinite(at)) return false;
	return status.online === true && Date.now() - at < STALE_MS;
}

function nodeFraction(used: number, total: number): number | null {
	if (!Number.isFinite(total) || total <= 0) return null;
	return Math.max(0, Math.min(1, used / total));
}

function clusterTotals() {
	let up = 0;
	let down = 0;
	let cpu = 0;
	let cpuCount = 0;
	let ramUsed = 0;
	let ramTotal = 0;
	let diskUsed = 0;
	let diskTotal = 0;
	let online = 0;
	let conn = 0;
	let connUdp = 0;
	let trafficUp = 0;
	let trafficDown = 0;

	for (const uuid of visibleUuids()) {
		const status = statuses.get(uuid);
		if (!status) continue;
		if (isFresh(status)) online += 1;
		up += Number(status.net_out) || 0;
		down += Number(status.net_in) || 0;
		conn += Number(status.connections) || 0;
		connUdp += Number(status.connections_udp) || 0;
		trafficUp += Number(status.net_total_up) || 0;
		trafficDown += Number(status.net_total_down) || 0;

		const config = configs.get(uuid);
		const cpuTotal = Number(config?.cpu_cores) || 0;
		if (cpuTotal > 0 && isFresh(status)) {
			cpu += (Number(status.cpu) || 0) * cpuTotal;
			cpuCount += cpuTotal;
		}
		ramUsed += Number(status.ram) || 0;
		ramTotal += Number(status.ram_total) || Number(config?.mem_total) || 0;
		diskUsed += Number(status.disk) || 0;
		diskTotal += Number(status.disk_total) || Number(config?.disk_total) || 0;
	}

	return {
		up,
		down,
		cpuAvg: cpuCount > 0 ? cpu / cpuCount : 0,
		ramUsed,
		ramTotal,
		diskUsed,
		diskTotal,
		online,
		conn,
		connUdp,
		trafficUp,
		trafficDown,
	};
}

/* ---------- SVG 折线图 ---------- */

const CHART_W = 320;
const CHART_H = 96;
const CHART_PAD = 6;

function niceMax(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 1024;
	const exponent = Math.floor(Math.log2(value));
	const step = 2 ** exponent;
	const scaled = value / step;
	const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 4 ? 4 : 8;
	return step * factor;
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
	if (points.length === 0) return "";
	if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
	let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
	for (let i = 1; i < points.length; i += 1) {
		const prev = points[i - 1];
		const cur = points[i];
		const mid = ((prev.x + cur.x) / 2).toFixed(2);
		d += ` C ${mid} ${prev.y.toFixed(2)}, ${mid} ${cur.y.toFixed(2)}, ${cur.x.toFixed(2)} ${cur.y.toFixed(2)}`;
	}
	return d;
}

function renderChart(
	host: HTMLElement | null,
	key: "up" | "down",
	samples: Sample[],
): void {
	if (!host) return;
	const values = samples.map((s) => s[key]);
	const peak = values.length ? Math.max(...values) : 0;
	const max = niceMax(peak);
	const count = samples.length;

	const points = samples.map((sample, index) => ({
		x: count <= 1 ? CHART_W / 2 : (index / (count - 1)) * CHART_W,
		y:
			CHART_H -
			CHART_PAD -
			(Math.max(0, Math.min(sample[key], max)) / max) *
				(CHART_H - CHART_PAD * 2),
	}));

	const line = smoothPath(points);
	const area =
		points.length > 1
			? `${line} L ${points[points.length - 1].x.toFixed(2)} ${CHART_H} L ${points[0].x.toFixed(2)} ${CHART_H} Z`
			: "";
	const last = points[points.length - 1];
	const gradientId = `mon-grad-${key}`;
	const peakLabel = rate(max);

	host.innerHTML = `
      <div class="mon-chart-plot">
        <span class="mon-chart-peak">${escapeHtml(peakLabel.value)} ${escapeHtml(peakLabel.unit)}</span>
        <svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" class="mon-svg" aria-hidden="true">
          <defs>
            <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--mon-chart-line)" stop-opacity="0.32" />
              <stop offset="100%" stop-color="var(--mon-chart-line)" stop-opacity="0" />
            </linearGradient>
          </defs>
          ${[0.25, 0.5, 0.75]
						.map((r) => {
							const y = (CHART_H * r).toFixed(1);
							return `<line x1="0" y1="${y}" x2="${CHART_W}" y2="${y}" class="mon-grid-line" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 5" />`;
						})
						.join("")}
          ${area ? `<path d="${area}" fill="url(#${gradientId})" />` : ""}
          ${line ? `<path d="${line}" fill="none" stroke="var(--mon-chart-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />` : ""}
          ${last ? `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3" class="mon-chart-dot" />` : ""}
        </svg>
        <div class="mon-chart-time">
          <span>${count > 0 ? escapeHtml(clockOf(samples[0].t)) : ""}</span>
          <span>${count > 0 ? escapeHtml(clockOf(samples[count - 1].t)) : ""}</span>
        </div>
      </div>
    `;
}

/* ---------- 渲染 ---------- */

function tile(
	label: string,
	value: string,
	unit: string,
	detail: string,
): string {
	return `
      <div class="mon-tile">
        <div class="mon-tile-head">
          <span class="mon-tile-label">${escapeHtml(label)}</span>
        </div>
        <div class="mon-tile-value">
          <span class="mon-big-number">${escapeHtml(value)}</span>
          ${unit ? `<span class="mon-tile-unit">${escapeHtml(unit)}</span>` : ""}
        </div>
        <div class="mon-tile-detail">${escapeHtml(detail)}</div>
      </div>
    `;
}

function escapeAttr(value: unknown): string {
	return escapeHtml(value).replaceAll("`", "&#096;");
}

function renderTiles() {
	const host = getElement<HTMLElement>("mon-tiles");
	if (!host) return;
	const totals = clusterTotals();
	const total = visibleUuids().length;
	const upRate = rate(totals.up);
	const downRate = rate(totals.down);

	const withUnit = (bytes: number) => {
		const { value, unit } = formatBytes(bytes);
		return [value, unit];
	};
	const ram = withUnit(totals.ramUsed);
	const disk = withUnit(totals.diskUsed);

	host.innerHTML = [
		tile("节点在线", `${totals.online}`, `/ ${total}`, `${total} 台已注册`),
		tile("平均 CPU", formatPercent(totals.cpuAvg), "%", "按核数加权"),
		tile("内存用量", ram[0], ram[1], `共 ${byteSize(totals.ramTotal)}`),
		tile("硬盘用量", disk[0], disk[1], `共 ${byteSize(totals.diskTotal)}`),
		tile(
			"实时带宽",
			upRate.value,
			upRate.unit,
			`下行 ${downRate.value} ${downRate.unit}`,
		),
		tile("活跃连接", String(totals.conn), "TCP", `${totals.connUdp} UDP`),
	].join("");
}

function renderCluster() {
	const totals = clusterTotals();
	const total = visibleUuids().length;
	const rate_ = total > 0 ? (totals.online / total) * 100 : 0;

	const rateEl = getElement<HTMLElement>("mon-online-rate");
	if (rateEl) rateEl.textContent = `${rate_.toFixed(rate_ % 1 === 0 ? 0 : 1)}%`;

	const textEl = getElement<HTMLElement>("mon-online-text");
	if (textEl) textEl.textContent = `在线 ${totals.online} / 总计 ${total}`;

	const totalRate = rate(totals.up + totals.down);
	const totalEl = getElement<HTMLElement>("mon-total-rate");
	if (totalEl) totalEl.textContent = `${totalRate.value} ${totalRate.unit}`;

	const cells = getElement<HTMLElement>("mon-health-cells");
	if (cells) {
		cells.innerHTML = visibleUuids()
			.map((uuid) => {
				const status = statuses.get(uuid);
				const fresh = isFresh(status);
				const name = configs.get(uuid)?.name ?? uuid.slice(0, 8);
				return `<span class="mon-cell${fresh ? "" : " mon-cell--off"}" title="${escapeAttr(name)}${fresh ? "" : " · 离线"}"></span>`;
			})
			.join("");
	}

	const legend = getElement<HTMLElement>("mon-legend");
	if (legend) {
		const up = rate(totals.up);
		const down = rate(totals.down);
		legend.innerHTML = `
        <div class="mon-legend-row"><span>累计出站</span><b>${escapeHtml(byteSize(totals.trafficUp))}</b></div>
        <div class="mon-legend-row"><span>累计入站</span><b>${escapeHtml(byteSize(totals.trafficDown))}</b></div>
        <div class="mon-legend-row"><span>上行 / 下行</span><b>${escapeHtml(up.value)} ${escapeHtml(up.unit)} · ${escapeHtml(down.value)} ${escapeHtml(down.unit)}</b></div>
      `;
	}

	const upNow = getElement<HTMLElement>("mon-up-now");
	if (upNow)
		upNow.textContent = `${rate(totals.up).value} ${rate(totals.up).unit}`;
	const downNow = getElement<HTMLElement>("mon-down-now");
	if (downNow)
		downNow.textContent = `${rate(totals.down).value} ${rate(totals.down).unit}`;

	renderChart(getElement<HTMLElement>("mon-up-chart"), "up", history);
	renderChart(getElement<HTMLElement>("mon-down-chart"), "down", history);
}

function metricRow(
	label: string,
	valueText: string,
	detail: string,
	fraction: number | null,
): string {
	const clamped = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
	const color = fraction === null ? "var(--mon-track)" : toneColor(fraction);
	return `
      <div class="mon-metric">
        <div class="mon-metric-top">
          <span class="mon-metric-label">${escapeHtml(label)}</span>
          <span class="mon-metric-value">${escapeHtml(valueText)}</span>
        </div>
        <div class="mon-bar-track">
          <div class="mon-bar-fill" style="width:${(clamped * 100).toFixed(1)}%;background:${escapeAttr(color)}"></div>
        </div>
        <div class="mon-metric-detail">${escapeHtml(detail || "\u00A0")}</div>
      </div>
    `;
}

function nodeCard(uuid: string): string {
	const config = configs.get(uuid);
	const status = statuses.get(uuid);
	const fresh = isFresh(status);
	const name = config?.name ?? uuid.slice(0, 8);

	const cpuCores = Number(config?.cpu_cores) || 0;
	const ramTotal = Number(status?.ram_total) || Number(config?.mem_total) || 0;
	const diskTotal =
		Number(status?.disk_total) || Number(config?.disk_total) || 0;

	const cpu = fresh ? Number(status?.cpu) || 0 : 0;
	const cpuFraction =
		cpuCores > 0 ? Math.min(1, cpu / (cpuCores * 100)) : cpu / 100;

	const ramUsed = fresh ? Number(status?.ram) || 0 : 0;
	const diskUsed = fresh ? Number(status?.disk) || 0 : 0;
	const load = fresh ? Number(status?.load) || 0 : 0;
	const loadFraction = cpuCores > 0 ? Math.min(1, load / cpuCores) : null;

	const netOut = fresh ? Number(status?.net_out) || 0 : 0;
	const netIn = fresh ? Number(status?.net_in) || 0 : 0;
	const outRate = rate(netOut);
	const inRate = rate(netIn);

	const trafficLimit = Number(config?.traffic_limit) || 0;
	const trafficUsed = computeTrafficUsed(
		config?.traffic_limit_type,
		Number(status?.net_total_up) || 0,
		Number(status?.net_total_down) || 0,
	);
	const trafficFraction =
		trafficLimit > 0 ? Math.min(1, trafficUsed / trafficLimit) : null;

	const cpuLabel = config?.cpu_name ? shortCpu(config.cpu_name) : "—";
	// region 是国旗 emoji，Windows 会渲染成国家字母，和 group 常常重复，所以优先只显示 group。
	const tags = [
		config?.group?.trim() || config?.region?.trim(),
		config?.arch?.trim(),
	].filter((tag): tag is string => Boolean(tag));

	return `
      <article class="mon-node${fresh ? "" : " mon-node--off"}">
        <header class="mon-node-head">
          <div class="min-w-0">
            <div class="mon-node-name">
              <span class="mon-dot${fresh ? " mon-dot--on" : " mon-dot--off"}"></span>
              ${escapeHtml(name)}
            </div>
            <div class="mon-node-sub">${escapeHtml([config?.os, cpuLabel].filter(Boolean).join(" · ") || "—")}</div>
          </div>
          <div class="mon-node-tags">
            ${tags.map((tag) => `<span class="mon-tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </header>

        <div class="mon-node-metrics">
          ${metricRow("CPU", `${formatPercent(cpu)}%`, `${cpuCores || "?"} 核 · ${cpuLabel}`, cpuFraction)}
          ${metricRow("内存", byteSize(ramUsed), `共 ${byteSize(ramTotal)}`, nodeFraction(ramUsed, ramTotal))}
          ${metricRow("硬盘", byteSize(diskUsed), `共 ${byteSize(diskTotal)}`, nodeFraction(diskUsed, diskTotal))}
          ${metricRow("负载", load.toFixed(2), `5/15 分钟 ${formatPercent(status?.load5)} · ${formatPercent(status?.load15)} · ${Number(status?.process) || 0} 进程`, loadFraction)}
          ${
						trafficFraction !== null
							? metricRow(
									"流量",
									byteSize(trafficUsed),
									`配额 ${byteSize(trafficLimit)} · ${(trafficFraction * 100).toFixed(1)}%`,
									trafficFraction,
								)
							: ""
					}
        </div>

        <div class="mon-node-rates">
          <div class="mon-rate">
            <span class="mon-rate-label">
              <span class="mon-rate-arrow mon-rate-arrow--up"></span>上行
            </span>
            <span class="mon-rate-value">${escapeHtml(outRate.value)}<i>${escapeHtml(outRate.unit)}</i></span>
          </div>
          <div class="mon-rate">
            <span class="mon-rate-label">
              <span class="mon-rate-arrow mon-rate-arrow--down"></span>下行
            </span>
            <span class="mon-rate-value">${escapeHtml(inRate.value)}<i>${escapeHtml(inRate.unit)}</i></span>
          </div>
        </div>

        <footer class="mon-node-foot">
          <span>在线 ${escapeHtml(formatUptime(status?.uptime))}</span>
          <span>${Number(status?.connections) || 0} TCP · ${Number(status?.connections_udp) || 0} UDP</span>
          <span class="mon-node-time">${fresh ? "刚刚更新" : "离线 / 数据过期"}</span>
        </footer>
      </article>
    `;
}

// Komari 用 traffic_limit_type 决定按上行、下行还是两者来计已用流量，默认 max。
function computeTrafficUsed(
	type: string | undefined | null,
	up: number,
	down: number,
): number {
	const safeUp = Math.max(0, Number(up) || 0);
	const safeDown = Math.max(0, Number(down) || 0);
	switch ((type ?? "").trim().toLowerCase()) {
		case "up":
			return safeUp;
		case "down":
			return safeDown;
		case "sum":
			return safeUp + safeDown;
		case "min":
			return Math.min(safeUp, safeDown);
		default:
			return Math.max(safeUp, safeDown);
	}
}

function shortCpu(name: string): string {
	return name.replace(/\s+/g, " ").trim().slice(0, 28);
}

function renderGroups() {
	const host = getElement<HTMLElement>("mon-groups");
	if (!host) return;
	const groups = new Set<string>();
	for (const uuid of visibleUuids()) {
		const group = (configs.get(uuid)?.group || "").trim();
		if (group) groups.add(group);
	}
	const options = ["全部", ...[...groups].sort()];
	if (!options.includes(activeGroup)) activeGroup = "全部";

	host.innerHTML = options
		.map(
			(group) =>
				`<button type="button" class="mon-group-btn${group === activeGroup ? " is-active" : ""}" data-group="${escapeAttr(group)}">${escapeHtml(group)}</button>`,
		)
		.join("");
}

function renderNodes() {
	const host = getElement<HTMLElement>("mon-nodes");
	if (!host) return;
	const uuids = visibleUuids().filter((uuid) => {
		if (activeGroup === "全部") return true;
		return (configs.get(uuid)?.group || "").trim() === activeGroup;
	});

	if (uuids.length === 0) {
		host.innerHTML = `<div class="mon-empty">该分组下没有节点。</div>`;
		return;
	}
	host.innerHTML = uuids.map(nodeCard).join("");
}

function renderGreeting() {
	const hour = new Date().getHours();
	const greeting =
		hour < 5
			? "凌晨好"
			: hour < 11
				? "早上好"
				: hour < 13
					? "中午好"
					: hour < 18
						? "下午好"
						: "晚上好";
	const greetingEl = getElement<HTMLElement>("mon-greeting");
	if (greetingEl) greetingEl.textContent = greeting;

	const totals = clusterTotals();
	const total = visibleUuids().length;
	const countEl = getElement<HTMLElement>("mon-node-count");
	if (countEl) {
		countEl.textContent = `，${totals.online} / ${total} 台节点在线`;
	}
}

function renderAll() {
	renderGreeting();
	renderTiles();
	renderCluster();
	renderGroups();
	renderNodes();
	renderStatusPill();
}

function renderStatusPill() {
	const pill = getElement<HTMLElement>("mon-state-pill");
	if (pill) {
		const failed = lastError !== null;
		pill.textContent = failed
			? "数据异常"
			: autoRefresh
				? "实时采集中"
				: "已暂停";
		pill.className = `mon-pill ${failed ? "mon-pill--error" : autoRefresh ? "mon-pill--ok" : "mon-pill--pending"}`;
	}

	const button = getElement<HTMLButtonElement>("mon-autorefresh");
	if (button) {
		button.textContent = autoRefresh ? "暂停刷新" : "恢复刷新";
		button.setAttribute("aria-pressed", String(autoRefresh));
	}

	const updated = getElement<HTMLElement>("mon-updated");
	if (updated) {
		const times = [...statuses.values()]
			.map((s) => Date.parse(s.time))
			.filter((t) => Number.isFinite(t));
		const latest = times.length ? Math.max(...times) : 0;
		if (latest > 0) {
			const age = Math.max(0, Math.round((Date.now() - latest) / 1000));
			updated.textContent = `最近更新 ${clockOf(latest)}（${age} 秒前）· ${visibleUuids().length} 台节点`;
		}
	}
}

function showState(state: "loading" | "ready" | "error") {
	getElement<HTMLElement>("mon-skeleton")?.classList.toggle(
		"hidden",
		state !== "loading",
	);
	getElement<HTMLElement>("mon-content")?.classList.toggle(
		"hidden",
		state !== "ready",
	);
	getElement<HTMLElement>("mon-error")?.classList.toggle(
		"hidden",
		state !== "error",
	);
}

function showError(title: string, description: string) {
	const titleEl = getElement<HTMLElement>("mon-error-title");
	if (titleEl) titleEl.textContent = title;
	const descEl = getElement<HTMLElement>("mon-error-desc");
	if (descEl) descEl.textContent = description;
	showState("error");
}

/* ---------- 载入 ---------- */

async function loadConfig(): Promise<boolean> {
	const nodes = await rpc<Record<string, NodeConfig>>("common:getNodes", {});
	if (!nodes || typeof nodes !== "object") return false;
	configs = new Map(Object.entries(nodes));
	return true;
}

async function loadStatuses(): Promise<void> {
	const latest = await rpc<Record<string, NodeStatus>>(
		"common:getNodesLatestStatus",
		{},
	);
	statuses = new Map(Object.entries(latest ?? {}));

	let up = 0;
	let down = 0;
	let at = 0;
	for (const [uuid, status] of statuses) {
		if (configs.get(uuid)?.hidden === true) continue;
		if (!isFresh(status)) continue;
		up += Number(status.net_out) || 0;
		down += Number(status.net_in) || 0;
		const t = Date.parse(status.time);
		if (Number.isFinite(t)) at = Math.max(at, t);
	}
	if (at > 0) pushSample({ t: at, up, down });
}

function pushSample(sample: Sample) {
	const last = history[history.length - 1];
	// 同一秒内的重复轮询只更新最后一个点，避免曲线随轮询频率抖动。
	if (last && Math.abs(last.t - sample.t) < 1000) {
		history[history.length - 1] = sample;
	} else {
		history.push(sample);
	}
	if (history.length > MAX_SAMPLES) history = history.slice(-MAX_SAMPLES);
}

// 用聚合接口回填一段历史，首屏就能看到波形而不是空图。
async function seedHistory(): Promise<void> {
	if (historySeeded) return;
	historySeeded = true;
	try {
		const payload = await rpc<{
			series?: Array<{
				metric_key: string;
				entity_id: string;
				points?: Array<{ time: string; value: number }>;
			}>;
		}>("public:queryMetrics", {
			hours: HISTORY_SEED_MS / 3600000,
			metric_keys: ["net.out.rate", "net.in.rate"],
			max_points: MAX_SAMPLES,
			aggregation: "avg",
			fill_empty: false,
		});

		const buckets = new Map<number, Sample>();
		for (const series of payload?.series ?? []) {
			const key =
				series.metric_key === "net.out.rate"
					? "up"
					: series.metric_key === "net.in.rate"
						? "down"
						: null;
			if (!key) continue;
			for (const point of series.points ?? []) {
				const t = Date.parse(point.time);
				if (!Number.isFinite(t)) continue;
				const bucket = buckets.get(t) ?? { t, up: 0, down: 0 };
				bucket[key] += Number(point.value) || 0;
				buckets.set(t, bucket);
			}
		}

		const seeded = [...buckets.values()].sort((a, b) => a.t - b.t);
		if (seeded.length > 1) {
			const live = history.filter((s) => s.t > seeded[seeded.length - 1].t);
			history = [...seeded, ...live].slice(-MAX_SAMPLES);
		}
	} catch {
		// 回填失败不影响实时曲线，忽略即可。
	}
}

async function refresh(options: { initial?: boolean } = {}) {
	try {
		if (options.initial || configs.size === 0) {
			await loadConfig();
			await seedHistory();
		}
		await loadStatuses();
		lastError = null;
		hasRenderedData = true;
		showState("ready");
		renderAll();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		lastError = message;

		// 还没有任何可展示的数据时整页换成错误卡片；已经有数据就保留画面，
		// 只在状态条上提示异常，避免一次网络抖动把整页清空。
		if (!hasRenderedData) {
			if (message === "PROXY_MISSING") {
				showError(
					"监控代理尚未部署",
					"本页通过同源的 /api/komari/rpc2 代理读取 Komari，因为面板会拒绝跨源请求。" +
						"如果看到这句话，通常说明站点还没有部署 functions/api/komari 这个 Pages Function。",
				);
			} else {
				showError(
					"无法载入监控数据",
					`${message || "请求未成功"}，稍后可以点重试。`,
				);
			}
		}
		renderStatusPill();
	}
}

function schedulePoll() {
	if (pollTimer !== null) {
		clearTimeout(pollTimer);
		pollTimer = null;
	}
	if (!autoRefresh) return;
	pollTimer = setTimeout(async () => {
		pollTimer = null;
		if (!document.hidden && autoRefresh) {
			if (Date.now() - lastConfigAt > CONFIG_MS) {
				lastConfigAt = Date.now();
				await loadConfig().catch(() => undefined);
				renderGroups();
			}
			await refresh();
		}
		schedulePoll();
	}, POLL_MS);
}

export function initMonitorPage() {
	const root = getElement<HTMLElement>("monitor-page");
	if (!root) return;
	if (activeRoot === root && root.dataset.ready === "true") return;

	cleanupPage?.();
	activeRoot = root;
	root.dataset.ready = "true";

	configs = new Map();
	statuses = new Map();
	history = [];
	historySeeded = false;
	lastError = null;
	hasRenderedData = false;
	activeGroup = "全部";
	lastConfigAt = Date.now();

	showState("loading");

	const groupsHost = getElement<HTMLElement>("mon-groups");
	const refreshBtn = getElement<HTMLButtonElement>("mon-refresh");
	const retryBtn = getElement<HTMLButtonElement>("mon-retry");
	const autoBtn = getElement<HTMLButtonElement>("mon-autorefresh");

	const onGroupClick = (event: Event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
			"[data-group]",
		);
		if (!button) return;
		activeGroup = button.dataset.group || "全部";
		renderGroups();
		renderNodes();
	};

	const onRefresh = () => {
		// 还没成功渲染过时，重试等于整页重新载入（含历史回填），并先回到骨架。
		if (!hasRenderedData) showState("loading");
		void refresh({ initial: !hasRenderedData });
	};

	const onToggleAuto = () => {
		autoRefresh = !autoRefresh;
		renderStatusPill();
		schedulePoll();
	};

	const onVisibility = () => {
		// 回到前台立刻补一次，避免看到停在离开时刻的数值。
		if (!document.hidden && autoRefresh) void refresh();
	};

	groupsHost?.addEventListener("click", onGroupClick);
	refreshBtn?.addEventListener("click", onRefresh);
	retryBtn?.addEventListener("click", onRefresh);
	autoBtn?.addEventListener("click", onToggleAuto);
	document.addEventListener("visibilitychange", onVisibility);

	cleanupPage = () => {
		if (pollTimer !== null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		requestController?.abort();
		groupsHost?.removeEventListener("click", onGroupClick);
		refreshBtn?.removeEventListener("click", onRefresh);
		retryBtn?.removeEventListener("click", onRefresh);
		autoBtn?.removeEventListener("click", onToggleAuto);
		document.removeEventListener("visibilitychange", onVisibility);
		activeRoot = null;
	};

	void refresh({ initial: true }).finally(() => schedulePoll());
}
