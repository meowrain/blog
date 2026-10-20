/* 创建一条碎碎念：文件按日期命名，锚点稳定，正文留空待填 */

import fs from "node:fs";
import path from "node:path";

function getDate() {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");
	const hours = String(today.getHours()).padStart(2, "0");
	const minutes = String(today.getMinutes()).padStart(2, "0");
	const seconds = String(today.getSeconds()).padStart(2, "0");

	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

const args = process.argv.slice(2);
const slug = (args[0] || "note")
	.trim()
	.replace(/\.md$/i, "")
	.replace(/[/\\\s]+/g, "-");

const today = new Date();
const datePrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const targetDir = "./src/content/notes";
const fullPath = path.join(targetDir, `${datePrefix}-${slug}.md`);

if (fs.existsSync(fullPath)) {
	console.error(`Error: File ${fullPath} already exists`);
	process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

const content = `---
published: ${getDate()}
tags: []
draft: false
---

`;

fs.writeFileSync(fullPath, content);
console.log(`Note ${fullPath} created`);
