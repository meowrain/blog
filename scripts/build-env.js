// 构建环境快照：在 build 最前面打一行，方便事后判断「远端构建机到底是什么规格」。
//
// 起因是 2026-11-19 那次 EdgeOne 构建：astro 在内容同步阶段被提前终止，
// 但退出码是 0，平台上只留下一句 `ENOENT: lstat '.../dist'`，看不出机器规格。
// 这里把 Node 版本和内存总量打进日志——如果下次再挂，至少能直接判断是不是 OOM。
// 纯读环境，不写文件、不抛错，永远以 0 退出。

import os from 'node:os';

function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

const cpus = os.cpus().length;
console.log(
  `[build-env] node ${process.version} · ${cpus} 核 · 内存 ${gb(os.totalmem())}（可用 ${gb(os.freemem())}） · ${process.platform}/${process.arch}`,
);

if (process.env.CI) console.log(`[build-env] CI=${process.env.CI}`);
if (process.env.LINK_CARD !== undefined) {
  console.log(`[build-env] LINK_CARD=${process.env.LINK_CARD}`);
}
