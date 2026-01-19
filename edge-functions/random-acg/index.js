export async function onRequest(context) {
    // 回源 URL 改写
    const url = `https://riscv-nas.acetaffy.top/random?type=horizontal`;

    try {
        console.log(`[random-acg] Fetching: ${url}`);
        // fetch(url) 获取 EdgeOne CDN 缓存与回源。
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // 克隆响应以避免 body used 错误（虽然直接返回通常没问题）
        // 并保留原始 headers
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });

    } catch (err) {
        console.error(`[random-acg] Error: ${err.message}`);
        // 简单的错误处理
        return new Response(JSON.stringify({
            error: `Error fetching image: ${err.message}`
        }), { 
            status: 500,
            headers: { 'content-type': 'application/json' }
        });
    }
}
