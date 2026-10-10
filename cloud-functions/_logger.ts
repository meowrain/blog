// 内部模块（不参与路由）：cloud-functions 独立打包，不能跨目录 import agents/_shared
export function createLogger(name: string) {
	return {
		log(...args: unknown[]) { console.log(`[${name}][${new Date().toISOString()}]`, ...args); },
		error(...args: unknown[]) { console.error(`[${name}][${new Date().toISOString()}]`, ...args); },
	};
}
