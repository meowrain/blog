# Backend 优化清单

范围：`backend/src/**`。按优先级分组，每条含位置、问题、建议改法。

---

## P0 — 正确性 Bug（会静默产生错误数据）

### 1. 更新分类后 frontmatter 的 `category` 不跟着变
`articles.service.ts:159-163, 166-175`

`newCategory` 只搬文件，frontmatter 的 `category` 只有在请求体里**同时**传了 `category` 才会更新。结果：文件在 `Java/Spring/` 下，frontmatter 还写着旧分类，前端 tree 与列表不一致。

改：`newCategory` 存在时强制 `frontmatterUpdates.category = normalizeCategoryDisplay(newCategory)`。

### 2. `newTitle` 改名不重命名文件
`articles.service.ts:152-155, 184-186`

`create()` 用 title 生成文件名，但 `update()` 的 `newTitle` 只改 frontmatter.title，文件名保持旧 slug，之后 path 与 title 永久脱节。

改：二选一。(a) 删掉 `newTitle`，让改标题必须走一次移动；(b) 保留并同时 `moveFile(oldPath, dir + newSlug + '.md')`，并处理目标已存在的冲突。

### 3. 分类/标签缓存永不失效
`categories.service.ts:16, 212-215`；`tags.service.ts:8, 282-285`

`refreshCache()` 里 `if (size > 0) return`，意味着进程启动后只构建一次。通过 `/api/articles` 的 create/update/delete/bulk 改了文章，两个缓存完全无感知；外部直接编辑 md 文件同样无感知。

改：抽一个 `ContentIndexService` 统一持有索引，写操作后主动失效；配合 `fs.watch(POSTS_DIR)` 做失效兜底，并加 TTL（如 30s）。

### 4. 分类重命名用 `String.replace`，替换位置不锚定
`categories.service.ts:125-128`

`articlePath.replace(category.path, newPath)` 替换**任意位置的首次匹配**。若文件名里恰好含有分类名，路径会被写坏。

改：改成前缀判断后拼接：
```ts
const prefix = category.path.replace(/\//g, path.sep);
if (!articlePath.startsWith(prefix + path.sep)) continue;
const relativePath = newPath + articlePath.slice(prefix.length);
```

### 5. 并发写同一文件会丢更新（锁是分模块的，且读改写不原子）
`file.service.ts:16, 281-293`

`FileService` 在 `AppModule` 和 3 个 feature module 里各 new 了一次（`app.module.ts:22`、`articles.module.ts:9`、`categories.module.ts:9`、`tags.module.ts:9`），`writeLocks` 是实例状态 → 4 把互不相干的锁，articles 与 tags 并发写同一文件完全串行不住。

另外所有更新都是 read → 改 → write 三步，`withFileLock` 只包住 write 那步，两个请求仍可交叉，后写覆盖先写。

改：
1. 把 `FileService` / `FrontmatterService` 收进一个 `@Global()` 的 `CommonModule`，只注册一次。
2. 把锁粒度提到「读改写」整体：在 service 层加 `withArticleLock(path, async () => { read; mutate; write; })`，或在 `FileService` 暴露 `updateFile(path, mutator)`。
3. `moveFile` 同时对 source 和 target 加锁（现在只锁 source，`file.service.ts:73`）。

### 6. bulk 操作的计数会算错
`articles.service.ts:266-289`

`ADD_TAG` 时若标签已存在、`REMOVE_TAG` 时若标签本不存在、`UPDATE_CATEGORY` 时若 `category` 缺省，都既不 `success++` 也不记 failure → `success + failed !== total`。前端无法判断这批到底做没做完。

改：显式 `continue`（跳过）时记入 failures，reason 写 `skipped: tag already present` 之类，保证三个数字自洽。

### 7. `create()` 不检查是否已存在
`articles.service.ts:25-55`

同名文件直接覆盖（虽然有 backup，但调用方拿到的是 200 + 新内容，旧文章被静默替换）。

改：写入前 `fileExists`，已存在抛 `ConflictException`；或加 `?overwrite=true` 显式开关。

### 8. 分类软删除是静默 no-op
`categories.service.ts:156-207`

`delete(name)` 既不传 `moveArticlesTo` 也不传 `deleteArticles=true` 时，返回 `{count: 0}`，什么都不做，调用方以为删成功了。

改：两个参数都缺失时抛 `BadRequestException`。

---

## P1 — 性能（当前是 O(N × 全文读取)）

### 9. `findAll` 对同一批文件重复读 4 遍全文
`articles.service.ts:60-135`

draft 过滤（66-68）、tag 过滤（89-91）、search 过滤（101-103）、排序（110-112）各自 `Promise.all(map(getArticleListItem))`。N 篇文章最多 4N 次 `readFile` + `gray-matter` 解析，且每次都把正文一起读进来——而列表只需要 frontmatter。

改：
1. 只解析一次，得到 `ArticleListItemDto[]`，后续 filter/sort/slice 全在内存数组上做。
2. 列表项不需要正文：用 `matter.read()`（gray-matter 自带，只解 YAML 头）或自己读到第二个 `---` 就停，避免读整个文件。
3. 结果缓存到索引服务里（同 #3），文件 mtime 未变就不重解析。

### 10. 没有持久索引，每个 tag/category 接口都是全量扫描
`tags.service.ts:69-80, 92-93, 135-153, 192-208, 227-242`；`categories.service.ts:100-109`

`tags.getArticles` / `getRelated` / `rename` / `delete` / `bulkAdd` 都是「列出全部文件 → 逐个 readFile → 解析」。rename/delete 一个标签会重写全站文件，且每个文件都触发一次 backup 拷贝。

改：统一走 #3 的索引服务，一次性拿到 `Map<path, {frontmatter, mtime}>`，内存里算差集，只对真正命中的文件落盘。

### 11. bulk 操作完全串行
`articles.service.ts:249`（`for ... await`）

每个 path 内部还嵌套 `getArticle` 两次（`update()` 里 149 行一次、206 行返回时一次）。批量改 50 篇文章就是 100+ 次读 + 50 次备份拷贝。

改：先批量读一次建内存快照，再批量写；写入用 `Promise.allSettled` 并限并发（如 `p-limit` 8）；失败项收集进 `failures`。注意与 #5 的锁配合，同路径仍需串行。

### 12. `/api/health` 做全量递归扫描
`app.controller.ts:19-30`

健康检查 = `listFiles()` 递归遍历整个 posts 目录。

改：换成 `fs.access(POSTS_DIR)`。

### 13. 分页没有上限
`articles/dto/list-articles.dto.ts:11-15`

只有 `@Min(1)`，没有 `@Max`。`?limit=999999` 会读全站。`MAX_PAGE_LIMIT = 100` 在 `constants.ts:40` 定义了但没用上。

改：加 `@Max(100)`，并在 `findAll` 里对 `page/limit` 做 `NaN` 兜底。

### 14. `listBackups` 全量 stat 后再分页，且无容错
`file.service.ts:203-231`

先 `scanFiles` 递归全部，再对每个文件 `fs.stat`，最后才 `slice`。备份多了会线性变慢；扫描与 stat 之间文件被删会抛错导致整个请求 500。

改：按日期目录（已经是 `YYYYMMDD/action/` 结构）做降序遍历 + 提前 break；`stat` 包 try/catch 跳过异常项。

---

## P2 — 数据安全

### 15. 恢复备份不备份当前文件
`file.service.ts:236-260`

`restoreBackup` 直接 `atomicWrite` 覆盖线上文章，不走 `writeFile`，所以当前版本不会进备份。恢复操作本身变不可逆。

改：改成 `await this.writeFile(sourcePath, content)`（内部会先建备份）。

### 16. 每次写都建备份 → 备份爆炸，且没人清理
`file.service.ts:39-41, 303-316`

`update()` 的 move 流程会写两次（`articles.service.ts:199` + `201`），产生 2 份备份；bulk 打标签 50 篇 = 50 份拷贝。`pruneBackups` 是手动接口，没有任何定时任务调用它。

改：
1. 修掉 #17 的重复写。
2. 引入 `@nestjs/schedule`，启动时 + 每天跑一次 `pruneBackups()`。
3. 可选：按文件保留最近 N 份，而不是按时间一刀切。

### 17. update 的 move 流程写了两次盘
`articles.service.ts:197-204`

`moveFile(old → new)` 会为旧文件建一份备份，然后 `writeFile(new)` 又为新文件建一份备份（因为文件已存在）。同一个逻辑修改产生 2 次备份 + 2 次写。

改：读原文 → 内存里算好新 frontmatter → 一次 `writeFile(newPath, markdown)` → `deleteFile(oldPath)`。顺序上先写新后删旧，中途失败不会丢数据。

### 18. 路径校验用前缀匹配，不是边界匹配
`file.service.ts:153`

`resolvedPath.startsWith(postsDirResolved)`：`POSTS_DIR=/a/posts` 时 `/a/posts-evil/x.md` 能通过。当前目录名固定，风险低，但这是标准的 traversal 写法缺陷。

改：
```ts
const rel = path.relative(postsDirResolved, resolvedPath);
if (rel.startsWith('..') || path.isAbsolute(rel)) throw new BadRequestException(...);
```

### 19. `generateSlug` 实际上没有 slugify
`frontmatter.service.ts:186-189`

直接 `return title.trim()`。标题里带 `/`、`?`、`*`、`:`、`<`、`>`、`|`（`INVALID_PATH_CHARS` 已在 `constants.ts:76` 定义但从未用在标题上）会导致 `ENOENT`/`EINVAL`，Windows 上尤其容易踩。

改：过滤非法字符、折叠空白、限制长度，并做同名去重（`-1`、`-2` 后缀）。

### 20. `atomicWrite` 临时文件名用 `Date.now()`
`file.service.ts:298`

同毫秒内两次写会撞名；`rename` 失败时临时文件残留。

改：用 `randomUUID()`；`rename` 包 try/finally，失败时 `unlink` 临时文件。

### 21. 全站接口无鉴权、无 body 大小限制
`main.ts:8-39`

`DELETE /api/articles/*`、`POST /api/backups/prune`、`POST /api/backups/restore` 全部裸奔。`MAX_FILE_SIZE`（`constants.ts:30`）定义了但没用于 `express.json({ limit })`。

改：本地工具也建议加一个简单 token 中间件（env 开关）；加 `app.use(json({ limit: '10mb' }))`；CORS 的 origin 列表改成读 env。

---

## P3 — 代码质量 / 可维护性

### 22. 死代码与重复逻辑
- 未被调用的导出/方法：`MAX_FILE_SIZE`、`DEFAULT_PAGE_LIMIT`、`MAX_PAGE_LIMIT`（`constants.ts:30-40`）、`getFileStats`、`validateName`、`sanitizeName`（`file.service.ts:163-198`）、`getDefaults`、`sanitizeTags`（`frontmatter.service.ts:89-100, 194-205`）。
- `normalizeCategoryPath` / `normalizeCategoryDisplay` 在 `articles.service.ts:345-359` 和 `categories.service.ts:262-271` 完全重复。
- 「路径前缀过滤」逻辑在 `articles.service.ts:81-84` 和 `categories.service.ts:105-108` 重复。
- `POSTS_DIR` 环境变量：`main.ts:38` 打印了它，但 `constants.ts:15` 从不读取 → 配置项是死的，改 env 无效。

改：把分类/路径工具抽到 `common/path.util.ts`；删死代码；让 `constants.ts` 真正读 `process.env.POSTS_DIR` 和 `process.env.PORT`。

### 23. 文档与实现不一致
`README.md:38, 217`（端口默认 3001）、`README.md:95`（limit max 100）、`README.md:116-125`（未记录 `/api/*/backups` 三个接口）。

`main.ts:35` 实际默认 3009；limit 无上限（#13）；backups 接口没写进 README。

### 24. 没有结构化日志
`requestId` 中间件（`main.ts:26-31`）生成了 id，但全项目用 `console.log` / `console.error`（`articles.service.ts:293`、`categories.service.ts:144`、`tags.service.ts:116` 等），日志里根本看不到 requestId。

改：接入 `nestjs-pino` 或 Nest `Logger`，写一个 `LoggingInterceptor`，把 requestId 注入到每条日志。

### 25. `tags.getArticles` 返回路径数组，与其他接口不一致
`tags.service.ts:62-83`、`categories.service.ts:100-109`

返回 `string[]`（相对路径），而 `/api/articles` 返回 `ArticleListItemDto`。前端拿到路径后还得逐个再请求一次。

改：统一返回 `ArticleListItemDto[]`，并支持 `page/limit`。

### 26. 测试覆盖接近于零
只有 `app.controller.spec.ts`（空壳）和 `test/app.e2e-spec.ts`。`FileService`、`FrontmatterService`、`ArticlesService` 的路径校验、缓存、并发锁这些高风险逻辑一行测试都没有。

改：优先补三组单测 —— `validatePath` 的 traversal 用例、`FileService` 并发写同一文件、`ArticlesService.update` 的分类/标题移动行为。

### 27. 类型可以收紧
- `ArticleFrontmatter.published: Date | string`（`frontmatter.service.ts:10`）→ 直接定成 `string`（ISO），消除 `serializeDate` 的分支和 `new Date(...).getTime()` 的 `NaN` 风险。
- `draft?: string` + 注释 `'true'|'false'|'all'`（`list-articles.dto.ts:31`）→ 改成 `@IsBoolean()` + `@Transform()`，去掉字符串魔法值。
- `CategoriesController.rename` / `TagsController.rename` / `bulk/add` 全部用内联字面量类型当 Body（`categories.controller.ts:59`、`tags.controller.ts:88, 108`），绕过 ValidationPipe → 换成正式 DTO。`category.dto.ts` 里已有的 `RenameCategoryDto`、`DeleteCategoryDto` 也是定义了没用。

---

## 建议的落地顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 1 | #1 #2 #4 #6 #7 #8 #13 #18 | 纯正确性，改动小，收益直接 |
| 2 | #5 #9 #10 #11 | 并发与性能的结构性调整，需要先落地 CommonModule |
| 3 | #3 | 索引服务，是 #9/#10 的进一步收敛，也顺带解决缓存失效 |
| 4 | #15 #16 #17 #20 | 备份链路 |
| 5 | #12 #14 #19 #21 #22-27 | 清理、健壮性、文档对齐 |

第 2 批的 `CommonModule`（把 `FileService`、`FrontmatterService` 变成全局单例）是后续所有改动的前置依赖，建议最先做。

---

## 实施结果（2026-08-31）

27 项全部处理完毕。✅ = 按建议实现；⚠️ = 有意偏离，见下节。

| # | 状态 | 实现要点 |
|---|---|---|
| 1 | ✅ | `newCategory` 存在时强制写 `frontmatter.category`；E2E：文件移到 `OtherCat/Moved/`，frontmatter 同步为 `OtherCat > Moved` |
| 2 | ✅ | 采用建议 (b)：`newTitle` 生成 slug 并移动文件，目标已存在返回 409 |
| 3 | ✅ | 新增 `ContentIndexService`：mtime+size 键、`INDEX_TTL_MS` 30s、写操作主动失效、`fs.watch(recursive)` 兜底（测试环境跳过） |
| 4 | ✅ | `replacePathPrefix` 锚定匹配；E2E：重命名 `SeedCat/Nested` 不影响 `OtherCat/Nested` |
| 5 | ✅ | `CommonModule`（`@Global()`）只注册一次；`withFileLocks` 支持 source+target 双锁，读改写整体加锁 |
| 6 | ✅ | `runBatch` 返回 `applied/skipped`，`total = success\|count + skipped + failed` 恒成立 |
| 7 | ✅ | 写入前 `fileExists` → `ConflictException`，显式 `overwrite: true` 才替换 |
| 8 | ✅ | 两个参数都缺失 → 400，并列出可选处理方式 |
| 9 | ✅ | 单次解析 + 只读文件头 16KB（`FRONTMATTER_HEAD_BYTES`）+ 索引缓存 |
| 10 | ✅ | tags/categories 全部走索引，内存算差集，只对命中文件落盘 |
| 11 | ✅ | `BULK_CONCURRENCY`（默认 8）限并发，失败项收集进 `failures` |
| 12 | ✅ | `/api/health` 换成 `fs.access` 级别的可读性检查 |
| 13 | ✅ | `@Max(100)` + `clampLimit/resolvePage`（NaN、负数、0 全部兜底）；`MAX_BODY_SIZE` 真正生效 |
| 14 | ✅ | `listBackups` 按 `YYYYMMDD` 目录降序遍历、够数即 break，`stat`/扫描异常项跳过 |
| 15 | ✅ | `restoreBackup` 走 `writeFile`，恢复前先备份当前版本 |
| 16 | ⚠️ | 启动 + 每天 prune；未引入 `@nestjs/schedule` |
| 17 | ✅ | `moveAndUpdate`：1 次备份 + 1 次 `atomicWrite` + 删源文件（E2E：每次 move 只有 1 份 `.bak`） |
| 18 | ✅ | `path.relative` 边界判断；E2E：`%2e%2e%2f…` 与 `../../` 均返回 400 |
| 19 | ⚠️ | slug 过滤非法/不可见字符、NFKC 归一、按码点截断；未做 `-1/-2` 自动改名 |
| 20 | ✅ | 临时文件名用 `randomUUID()`，`rename` 失败时 `finally` 清理 |
| 21 | ⚠️ | `API_TOKEN` bearer 中间件 + body limit + `CORS_ORIGINS` 读 env |
| 22 | ✅ | 死代码全部删除；路径工具集中到 `common/path.util.ts`；`POSTS_DIR`/`PORT` 等确实从 env 读取 |
| 23 | ✅ | README 已按实际行为重写相关章节 |
| 24 | ✅ | `AsyncLocalStorage` + `AppLogger` + `LoggingInterceptor`；E2E：请求期每一行日志（含 service 深处的 WARN/DEBUG）都带 requestId |
| 25 | ✅ | 两个接口统一返回 `PagedResult<ArticleListItemDto>` |
| 26 | ✅ | 新增 6 个 spec 文件，共 86 个用例 |
| 27 | ✅ | `published: string`；`draft` 用 `@Transform` + `@IsBoolean`；内联 Body 换成正式 DTO |

### 有意偏离

1. **#19 → 409 而不是自动改名**：标题冲突时静默生成 `foo-1.md` 会让作者找不到自己那篇，还可能覆盖掉另一篇的 URL。现在冲突返回 409，由调用方显式传 `overwrite: true`（会先备份）或改标题。
2. **#16 → 自实现定时任务**：项目约束是不新增依赖，`@nestjs/schedule` 属于新依赖。用 `setInterval` + `unref()`（不让定时器吊住进程）+ `enableShutdownHooks()` 里 `clearInterval`，行为等价。
3. **#21 → token 只保护 API**：admin 面板是纯静态页、没有登录态，无法带 bearer token。设了 `API_TOKEN` 就等于停用 `/admin`，README 里已写明这一点。

### 端到端验证时才发现的问题（原清单未覆盖）

- **Express 5 的具名通配 `*path` 返回的是数组**，直接当字符串用会拼成 `Java,JUC,Article.md`，于是所有嵌套文章的 GET/PATCH/DELETE 全部 404。admin 面板因为整段 `encodeURIComponent` 成一个 segment 而侥幸可用，纯路径写法的调用方（含清单里那些 `Java/Spring/Article.md` 示例）都拿不到数据。修复：`wildcardParam()` + 控制器 4 个路由 + 单测 `articles.controller.spec.ts`。
- **`request entity too large` 被记成 500**：body-parser 抛的是另一份 `http-errors` 实例，`instanceof HttpException` 不成立。修复：filter 读取 `status`/`statusCode`；顺带把 requestId 与鉴权中间件提到 body parser 之前（Express 按注册顺序执行，`useBodyParser` 是立即注册的），这样 401/413 也带得上 id。
- **5xx 响应不再回显内部 `Error.message`**，细节只留在日志里。
- **`CategoriesService.rename` 对子树文章用了父目录的展示名**，导致整棵子树的 frontmatter 塌成同一个分类；改为按每篇自己的目标路径算。
- **`API_TOKEN is not set` 只警告一次**，避免每次请求都刷屏。

### 验证方式

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # 无错误
node node_modules/jest/bin/jest.js --silent                       # 7 suites / 86 tests 全绿
node node_modules/@nestjs/cli/bin/nest.js build                   # 构建通过
```

另跑了两轮真实 HTTP 冒烟（`POSTS_DIR`/`BACKUPS_DIR` 指向临时副本，不碰仓库内容）：
第一轮把 138 篇真实文章复制进沙箱，覆盖鉴权、分页、过滤、嵌套路径、路径穿越、创建冲突、
批量、分类/标签读写、备份列举与恢复、413、非法 JSON、404；第二轮用最小语料精确验证
`newCategory` 移动、`newTitle` 改名、改名冲突、锚定前缀、删除决策、以及一次 move 只产生一份备份。
