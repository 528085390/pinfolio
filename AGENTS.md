# pinboard —— 便签夹（自用笔记 + 资产台账）

## 用途
本机单人用的「便签夹」：随手写 Markdown 便签、用 `#标签` 自动归类、置顶/搜索/归档，另有一个资产台账页登记设备/服务器/账号/域名（自定义字段、到期提醒、价格统计），便签可以钉到某条资产上。2026-10-21 又加了一页**只读邮件**：把 Gmail / QQ / 163 等多个信箱合成一个收件箱，点开即读，且**不改动服务器上的任何状态**。单进程单端口，数据只存本机 SQLite。

## 背景/来源
2026-10-19 由用户提出需求（"类似便签夹的项目，网页端，写东西订起来，加标签，再给个资产列表页"）后新建。同日用户要求整体迁出杂项工作区，目录从 `D:\projects\pinboard` 先移到 `D:\pinfolio_zc\pinboard`，2026-10-19 晚又随「两个项目合并」搬到 **`D:\pinfolio`**（与观测后端 `D:\kuma` 同属工作区根 `D:\pinfolio`；旧的 `D:\pinfolio_zc`、`D:\pinfolio_az` 两个根已删除），此后**不再受 `D:\projects\AGENTS.md` 的 R1–R7 约束**，本文件是唯一工程约定。调研过 usememos/memos（时间线便签，无资产）、sysadminsmedia/homebox（资产台账，无随手记）、blinko、flatnotes，结论是没有单项目同时覆盖两边，缝合两套 Go 应用会得到两套账号/两套标签且无法互链，因此按用户选择走**单应用自研**：交互抄 Memos、数据模型抄 HomeBox，代码全部本目录自写，无第三方运行时代码拷贝。2026-10-21 用户又提出「多个邮箱合成一个收件箱」（此前在 azfree 上试过 Cypht，嫌页面太重、跨境太慢，已整体拆除），需求定稿为 `docs/mail-page-requirements.md` v1.1，随后照该文档做出只读的 `/mail` 页。

## 内容清单
工程与文档：
- `README.md` —— 面向使用者的完整说明：功能、截图（`docs/screenshots/`）、快速开始、数据与备份、目录结构、HTTP API、开发与测试、常见问题。
- `AGENTS.md` —— 本文件，面向后续开发者/agent 的约定、模块职责、已知坑。
- `SNAPSHOT.md` —— **自动生成的可读快照**：资产总表 + 每条资产详情（备注、自定义字段）+ 全部便签 + 标签/字段总览，头部带生成时间与「数据最后变更」。任何写操作（POST/PUT/PATCH/DELETE）后 1.5 秒内自动重写（`server/snapshot.ts` 的 `scheduleSnapshot()`，由 `server/index.ts` 的 `/api/*` 中间件触发），启动时也生成一次；手动 `pnpm snapshot`。**不要手改，会被覆盖。**
- `start.cmd` —— 启动器：先用 `/api/health` 探测，已在运行就只开浏览器；否则调 `run-pinboard.vbs` **后台隐藏启动**，轮询到 HTTP 200 后打开页面，窗口随即自己关掉（2026-10-20 用户要求不再前置控制台窗口）。
- `stop.cmd` —— 停止器：`tools\pinboard.ps1 stop`。后台隐藏运行后没有窗口可关，**停服务只能走它**。
- `run-pinboard.vbs` —— 隐藏窗口启动器（`sh.Run "cmd /c ... pnpm start >> logs\pinboard.log 2>&1", 0, True`），**必须 CRLF**。
- `tools/pinboard.ps1` —— `start|stop|restart|status|logs` 控制脚本（根目录按脚本位置推导）。**必须存成 UTF-8 带 BOM**（`logs` 用 `Get-Content -Encoding UTF8`，否则 PS 5.1 按 GBK 解码日志、中文乱码）。
- `logs/` —— 运行日志 `pinboard.log`（追加，不轮转；不进版本库）。
- `docs/adding-assets.md` —— **录入手册（加资产、加便签都读这一篇）**：资产字段表 / 枚举 / 自定义字段 / 四类模板 / 批量脚本，便签字段表 / 标签抽取规则 / 完成与归档语义 / 批量导入，两页各自独立，末尾一页速查。给后续会话直接照做。
- `docs/mail-page-requirements.md` —— **邮件页的唯一需求来源（v1.1 定稿）**：目标/非目标、FR-1…FR-29、NFR-1…NFR-9、数据模型、接口约定、12 条验收、Q1–Q10 定案、D1–D4 决策（D1 永不回写已读、D2 本地已读标记、D3 Gmail 实测暂缓、D4 远程图片默认显示 + 保留邮件样式）。动邮件页之前先读它——**别把「发信 / 删除 / 标已读」加回来**。
- `docs/screenshots/` —— README 引用的截图（notes / assets / asset-drawer / tag-picker / note-done / dark / monitors / monitors-2560 / mail-inbox / mail-dark / mail-account），从 `tmp/` 挑出来固化，不受 `tmp/` 清理影响。
- `data/` —— 运行时 SQLite 数据（不进版本库）。
- `dist/web/` —— 前端构建产物，server 直接托管（不进版本库）。
- `tmp/` —— 开发期脚本与截图，可整目录删除（见「可清理项」）。

服务端（Node 24 + Hono + `node:sqlite`，无原生编译）：
- `server/db.ts` —— 建库建表（tags / field_defs / assets / notes / note_tags / asset_tags + 索引）、`all/get/run` 封装、`extractTags`（TAG_RE 支持中英文标点前缀）、`syncNoteTags`/`setAssetTags`、`TAG_COLORS`/`tagColor`。
- `server/hydrate.ts` —— `hydrateNotes`/`hydrateAssets`：批量 IN 查询拼 tags、asset、noteCount，解析 custom JSON。
- `server/routes/notes.ts` —— 便签 CRUD + 筛选（q/tag/pinned/archived/assetId），内容变更时同步标签。
- `server/routes/assets.ts` —— 资产 CRUD + 筛选（q/kind/status/tag），GET /:id 附带 `linkedNotes`（已 hydrate 标签）。
- `server/routes/tags.ts` —— 标签 CRUD，GET 带 notes/assets 计数。
- `server/routes/fields.ts` —— 自定义字段定义 CRUD（key 正则 `^[a-zA-Z][a-zA-Z0-9_]*$`，type 限 text/number/date/url/select/bool）。
- `server/routes/monitors.ts` —— 观测台数据：聚合 Uptime Kuma 的 `/api/status-page/:slug`（观测项清单）与 `/api/status-page/heartbeat/:slug`（心跳 + 24h 可用率）成 `{kuma, updatedAt, summary, groups}`；**两半分开缓存**（清单 5 分钟 + 启动预热 + 每 5 分钟续一次，心跳 5 秒），Kuma 慢/挂了沿用旧值并标 `stale`；`monitor-links.json` 把观测项映射到项目管理页。
- `server/mail/client.ts` —— 邮件后端（imapflow + mailparser，纯 JS，无原生编译）：连接池 `pool`（按账号 id 存，账号改密码/连接不可用时自动重建）、`listMessages()` 多账号归并（每账号按 UID 倒序、每批 `CHUNK = 50` 封 fetch，用「取各账号队头比大小」的方式归并，`offset` 跳过、`hasMore` 表示还有）、`getMessage()`（`fetchOne(uid, {source:true})` → `simpleParser`，>25 MB 直接报错不下载）、`listFolders()`、`testConnection()`、`friendlyError()`（把 ECONNREFUSED / EAUTH / 证书 / STARTTLS 等翻成中文人话）。
  **缓存全在内存**：列表 `LIST_TTL = 60_000`、正文 `BODY_TTL = 10 分钟`（`BODY_CACHE_MAX = 40` 封，LRU）、文件夹 5 分钟；`?fresh=1` 绕过。**只读靠 `getMailboxLock(folder, { readOnly: true })`**（EXAMINE 打开信箱）——别改成可写打开，那等于给 imapflow 留了 `STORE` 的机会。列表摘要只抓 `bodyParts: [{ key: 'TEXT', maxLength: 800 }]`，不下载整封信。
- `server/mail/store.ts` —— `mail_accounts`（label/email/host/port/username/password/security/enabled/sort）与 `mail_local_read`（account_id/folder/uid/read_at，主键三列）两张表的 CRUD；`publicAccount()` 一律剔掉 `password`、只给 `hasPassword`；`normalizeAccountInput()` 做校验与默认值（port 993 / security ssl）；`updateAccount()` 里**密码传空字符串等于「不改」**；`deleteAccount()` 连带删掉该账号的本地已读标记。
- `server/routes/mail.ts` —— `/api/mail/*`：`accounts`（`?counts=1&fresh=1` 带未读数）/ `accounts/test` / `folders` / `messages`（`account=all|<id>&folder=&limit=&offset=&fresh=1`，返回 `{items,total,unseen,hasMore,errors,partial}`）/ `message` / `attachment`（`Content-Disposition` 同时给 ASCII 与 `filename*=UTF-8''`，中文文件名不乱码）/ `local-read`（POST 记、DELETE 清，`account=all` 清全部）/ `status`。`shutdownMail()` 在进程退出时断开所有 IMAP 连接。
- `server/index.ts` —— 端口 7788、`/api/health`、`/api/bootstrap`、`/api/search`、`/api/stats`、`/api/export`、`POST /api/seed`（仅空库时写 2 个字段定义 + 4 资产 + 4 便签）、静态文件托管 dist/web、notFound/onError。
前端（Vite 7 + React 19 + 手写 CSS，无 UI 框架）：
- `web/App.tsx` —— 侧栏导航（便签/**邮件**/资产/观测/设置 + 计数）、主题切换（localStorage `pinboard-theme`，data-theme）、Ctrl/⌘+K 命令面板；**页面状态不在这里用 `useState`，而是 `const [page, setPage] = usePage()` 从 URL 取**（2026-10-20 起）。
- `web/lib/router.ts` —— 页面路由（2026-10-20 加）：`pageFromPath()`（`/mail` `/assets` `/monitors` `/settings` 映射成页面；`/`、未知路径、带尾斜杠一律归便签）、`pathForPage()`、`usePage()` hook（初始值取 `location.pathname`、`popstate` 跟前进后退、`history.pushState` 改地址栏、同步 `document.title`）。**别把页面状态改回 `useState('notes')`**——那样一刷新就回便签页（用户 2026-10-20 反馈的问题）。
- `web/pages/NotesPage.tsx` —— 顶部 composer（Ctrl/⌘+Enter 保存，含「标签」弹层与新建标签）、置顶区/全部区、筛选 chips（全部/未完成/已完成/置顶/标签/＋新标签/已归档）、防抖搜索、行内编辑、归档、关联资产；**完成状态**：圆形对勾按钮或**双击卡片正文**都能切换（双击忽略按钮/链接/标签/编辑框，并清掉浏览器默认选中文字），切换走本地乐观更新、不重排列表，只有处于「已完成/未完成」筛选时才重新拉取。
  **归档模式（`archivedMode` state，2026-10-20 加）**：默认视图**没有硬删除**，卡片右上角是「归档」（`PATCH {archived:true}`，`archive()`）。点筛选行的「已归档」chip 进入**只读归档视图**：`load()` 带 `archived='1'`，隐藏 composer / 完成圆圈 / 置顶 / 编辑 / 标签 chips / 全部·未完成·已完成·置顶 chips，双击不再切完成，卡片只留「恢复」（`restore()` → `PATCH {archived:false}`）与「永久删除」（`remove()`，danger 样式，confirm「永久删除这条便签？不可恢复。」）。`toggleArchivedMode()` 会清掉 tag/pinnedOnly/doneFilter/editingId。归档条数由 `App.tsx` 传 `archivedCount={stats?.archived ?? 0}` 显示在 chip 上。**别把 DELETE 入口加回默认视图**——用户明确要求「删除改归档，只在已归档里允许永久删除」。
  **标签弹层（`.tag-pop`，2026-10-21 修）**：`openTagMenu()` 打开前量按钮上下剩余空间（把所有 `overflowY` 非 visible 的祖先矩形取交集当可视边界），上面放不下就加 `.tag-pop-down` 往下展开，并把 `max-height` 压进剩余空间（96–320px）；弹层内部是 flex 三段（`.tag-pop-head` / `.tag-pop-list` / `.tag-pop-new`），只有列表自己滚，标题和「新建标签…」不会被滚走。**收起规则（2026-10-21 加，用户要求「点标签栏以外就缩回去」）**：`tagMenu` 为真时挂三个 document 监听——`pointerdown`（捕获）点弹层外任意处收起、`keydown` 的 `Escape` 收起、`scroll`（捕获）页面滚动收起。按钮和弹层共用一个 `tagWrapRef` 包裹 div，命中 `tagWrapRef.contains(target)` 就放行：点「标签」按钮仍走 `openTagMenu()` 的开关切换（不会「关了又被 click 打开」），滚弹层自己的 `.tag-pop-list` 也不会把自己关掉。**别把 `scroll` 监听改成 `window.addEventListener('scroll')` 的非捕获写法**——`.content` 才是滚动容器，事件不冒泡到 window，那样页面滚动根本收不起来。
  **别把 `bottom: calc(100% + 8px)` 写死回去、也别让整个弹层 `overflow:auto`**——`.content` 是 `overflow-y:auto`，往上展开超出它上边界的那 150px 会被裁掉而且滚不回来（用户 2026-10-21 报「便签标签被遮住一半」）。
- `web/pages/AssetsPage.tsx` —— 统计卡（总数/在用/30 天内到期/已过期）、类型 chips、状态筛选、**标签栏（`.tag-bar`，2026-10-20 改）**、卡片/表格两种视图。标签栏 = 常显 chip 行（不再是「所有标签」下拉框）：`全部标签` + 每个**有资产关联**的标签 `#名称 数量`，**按关联数降序、同数按名称升序**（`usedTags` 里 `sort`），点 chip 筛选、再点取消。0 关联的标签不显示（用户 2026-10-20 选定）。**「节点」标签已于 2026-10-20 改名「自建节点」**——它原本是「代理」的纯子集（自建节点 2 条 ⊂ 代理 3 条），改名是为了在标签栏里显出层级、不再像并列重复；**别再改回「节点」**。
- `web/pages/MailPage.tsx` —— 邮件页：账号 chips（全部 / 各账号 + 未读数 + 失败红点）/ 文件夹下拉 / 刷新 / 搜索（在**当前这一页 50 封里**客户端筛，不发服务端 SEARCH）/「只看未读」/ 分页（每页 `PAGE = 50`，底部「上一页 / 下一页」+「1–50 / 共 N 封」，`offset` 与 `hasMore` 都来自后端）/ `j`·`k` 上下选邮件 / 点开即 `POST /mail/local-read` 记本地已读、该行加 `.local-read` 变淡。**列表用 offset 分页而不是无限滚动**——FR-11 要求「能一直翻到最早一封」，后端保证 `total`/`hasMore` 正确。
- `web/pages/MonitorsPage.tsx` —— 观测台：四格统计 + 机器/状态筛选 + 搜索 + 卡片/表格视图 + 30 秒轮询；卡片含 40 段心跳色条、响应毫秒、24h 可用率、异常次数，标题带 ↗ 跳 `monitor-links.json` 配的管理页。手动点刷新才带 `?fresh=1`，轮询走后端缓存。
- `web/pages/SettingsPage.tsx` —— 外观、自定义字段、标签管理、导出 JSON、空库灌示例数据。
- `web/components/AssetDrawer.tsx` —— 资产详情抽屉（新建/编辑/删除、自定义字段按类型渲染、备注 Markdown、关联便签增删）。
- `web/components/MailReader.tsx` —— 阅读区。**正文走 Shadow DOM**：`htmlHost.attachShadow({mode:'open'})` + `root.innerHTML = docHtml`，邮件自带的 `<style>` 与内联 `style` 全部保留、只在 shadow 内生效，不污染便签夹；`styles.css` 里 `.mail-html` 只管宿主本身（后代选择器穿不透 shadow，写了就是死代码）。`buildMailDoc()` 流程：DOMParser 解析 → 收集并移出所有 `<style>` 文本 → 删 script/iframe/frame/object/embed/form/meta/base/link/noscript → `cid:` 换 `/api/mail/attachment?...` → 远程图**默认保留**（`showImages=false` 时才摘成 `data-src` + `data-blocked`，且**不再注入 `alt="图片已拦截"`**）→ 内联 `style` 过 `scrubCss()`（去 `@import` / `expression(` / `javascript:` / `behavior` / `-moz-binding`，`position:fixed|sticky` 改 `static`，隐藏图片时把 `url(https?:…)` 换 `none`）→ DOMPurify 兜底（`FORBID_TAGS: script/iframe/frame/object/embed/form/meta/base/link/style`、`FORBID_ATTR: srcset/ping/background/action/formaction`、`ADD_ATTR: target/data-src/data-blocked`；**`style` 属性不能进 FORBID_ATTR**）→ 拼成 `<style>BASE_CSS + 邮件CSS</style>` + `<div class="mail-doc">…</div>`（BASE_CSS 在前，邮件样式优先）。图片开关记本机 `localStorage['pinboard-mail-images']`（`show`/`hide`，**默认 show**，见决策 D4），隐藏时正文顶部出 `.mail-img-banner`；`fitWidth()` 处理固定宽度邮件（见坑 18）。HTML / 纯文本一键切换；附件清单走 `/api/mail/attachment` 下载。
- `web/components/MailAccountDrawer.tsx` —— 邮箱账号抽屉：新增 / 编辑（**密码留空 = 不改**）/ 删除 /「测试连接」（`POST /mail/accounts/test`，编辑已有账号时只带 `{id}` 复用库里存的密码）/「清除本地已读标记」（`DELETE /mail/local-read?account=all`）；抽屉里写明 Gmail 要应用专用密码、QQ/163 要授权码、163 需要 IMAP ID。
- `web/components/CommandPalette.tsx` —— 全局搜索（便签 + 资产）与快捷命令。
- `web/components/ui.tsx` / `Markdown.tsx` / `KindIcon.tsx` —— 通用按钮/字段/弹窗/抽屉/标签 chip、marked + DOMPurify 渲染、资产类型图标。
- `web/lib/api.ts` / `format.ts` —— 类型与请求封装、相对时间/金额/到期状态/类型与状态文案。
- `web/styles.css` —— 暖纸色设计令牌（--paper #f6f3ec / --accent #b45309）+ 深色覆盖，全部组件样式。

## 怎么用
双击 `start.cmd`（后台隐藏启动；已在运行就只开浏览器），停止双击 `stop.cmd`；或手动：

环境：Node ≥ 22（用到内置 `node:sqlite`，本机 Node v24.16.0）、pnpm。无需 Docker、无需数据库服务、无需编译原生模块。

```powershell
cd D:\pinfolio
pnpm install          # 首次；pnpm 12 需 pnpm-workspace.yaml 的 allowBuilds 才放行 esbuild
pnpm start            # 生产模式：tsx server/index.ts，访问 http://127.0.0.1:7788
pnpm dev              # 开发模式：API 7788 + Vite 5273（/api 代理到 7788）
pnpm build            # 重建前端到 dist/web（改前端后必须执行，server 直接读该目录）
pnpm typecheck        # tsc --noEmit
```

要点：
- **只监听 127.0.0.1，没有登录/鉴权**，不要暴露到公网。
- 数据目录 `data/`（可用环境变量 `PINBOARD_DATA` 覆盖），库文件 `data/pinboard.db`（WAL 模式，同目录还有 -wal/-shm）。
- 备份 = 停服务后复制 `data/`，或在设置页「导出 JSON」。
- 改服务端代码必须重启 `pnpm start`（tsx 非 watch）；改前端需 `pnpm build` 后刷新。
- 端口被占（`EADDRINUSE 127.0.0.1:7788`）时先 `tools\pinboard.ps1 stop`（或双击 `stop.cmd`），它会连同 tsx 子进程一起结束并等端口释放；实在清不掉再用 `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*pinboard*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`。**只杀包装进程会留下 tsx 子进程继续占 7788。**
- 日志在 `logs/pinboard.log`（`tools\pinboard.ps1 logs` 看最后 40 行）。服务挂了先看它。
- 示例数据：空库时设置页有按钮，或 `curl -X POST http://127.0.0.1:7788/api/seed`（仅空库生效）。

## 状态
**已完成（2026-10-19）**：便签/标签/资产/自定义字段/搜索/统计/导出全部可用；便签完成状态（圆圈按钮 + 双击卡片，乐观更新不重排）；资产台账已录入真实资产 8 条（5 在用 / 2 退役 / 1 丢失）。`pnpm typecheck` 0 错误、`pnpm build` 通过；API 冒烟与 Playwright UI 端到端（基础 13 条 + 完成态 11 条 + 双击 8 条 + 筛选 4 条）全绿、无 console 报错。

**已完成（2026-10-20）**：便签归档。默认列表的「删除」改为「归档」，硬删除只在只读的「已归档」视图里提供；`/api/search` 加 `AND archived = 0`。新增 `tmp/e2e-archive.mjs`（20 条断言，含 API 层 archived=0/1/all 与 Ctrl+K 排除），RED→GREEN 走完；回归跑 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter` 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-20，资产页标签栏）**：资产页原来的「所有标签」下拉框换成常显 chip 行（用户要求「默认显示全部标签、标签后带关联数、数量多的排前面」）。只列有资产关联的标签（0 关联不显示，用户选定），按 assets 降序 / 同名 localeCompare(zh-CN) 升序。新增 tmp/e2e-tagbar.mjs（12 条断言）；smoke / e2e / e2e-filter 回归全绿，pnpm typecheck 0 错误、pnpm build 通过。GLaDOS 与两个代理节点本来就共用「代理」标签（3 条），未改数据。

**已完成（2026-10-20，页面路由）**：便签/资产/观测/设置四页各占一个真路径（`/notes` `/assets` `/monitors` `/settings`），切页 `pushState`，刷新 / 深链 / 前进后退都停在同一页；`/` 与未知路径归一到 `/notes`；`document.title` 随页面变（如「观测台 · 便签夹」）。后端**没加新路由**——`server/index.ts:186-207` 的 `app.get('*')` 本来就对无扩展名路径回 `index.html`（SPA fallback），只给那段 fallback 补了 `Cache-Control: no-cache`（否则浏览器可能缓存某个页面的 HTML 壳）。新增 `tmp/e2e-router.mjs`（23 条断言：URL 变更、刷新保持、深链、后退、未知路径归一、标题、无 console 报错），RED→GREEN 走完；回归 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter`/`e2e-archive` 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，标签弹层被裁）**：便签 composer 的「标签」弹层固定往上展开（`bottom: calc(100% + 8px)`）+ `max-height:260px; overflow:auto`，composer 又在页面顶部，结果 260px 高的弹层顶到 y=-92、被 `.content`（`overflow-y:auto`）裁掉 150px，第一行只露半截、「新建标签…」完全看不见，Playwright 连第一个 chip 都点不到（`element is outside of the viewport`）。改成按剩余空间选方向（上/下）+ 高度压进剩余空间 + 内部 flex 三段只滚列表。新增 `tmp/e2e-tagpop.mjs`（49 条断言：1440x900 / 1280x720 / 1280x420 三个尺寸 + 长草稿改回往上展开，逐条查「弹层完整落在 `.content` 内、标题与新建按钮可见、首个 chip 不是半行、点标签能插进输入框并关层」），RED→GREEN 走完；回归 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter`/`e2e-archive`/`e2e-tagbar`/`e2e-router` 全绿（`e2e-tagbar` 原有两条硬编码 9 个标签 / 10 条资产随「华为云代金券」入库过期，已改成从 `/api/tags`、`/api/assets` 取期望值），`pnpm typecheck` 0 错误、`pnpm build` 通过；`docs/screenshots/tag-picker.png` 重拍。

**已完成（2026-10-21，标签弹层点外部收起）**：原来弹层只能靠再点「标签」按钮 / 点里面某个 chip / 点「新建标签…」关掉，点页面其它地方不收（用户 2026-10-21 要求「点一下标签栏以外的地方就缩回去」）。改为 `tagMenu` 为真时挂 document 级 `pointerdown`(捕获) + `Escape` + `scroll`(捕获) 三个监听，用 `tagWrapRef.contains(target)` 放行按钮与弹层内部。新增 `tmp/e2e-tagpop-outside.mjs`（14 条断言：点 composer 提示 / 便签卡片 / 搜索框收起、点卡片不误切完成态、点弹层内部标题不关、点 chip 插进输入框并关层、按钮开关、Esc、滚 `.content` 收起、滚弹层自己列表不关、无 console 报错），RED→GREEN 走完；回归 `smoke`/`e2e`/`e2e-tagpop`(49 条)/`e2e-filter`/`e2e-router`/`e2e-archive`/`e2e-tagbar`/`e2e-done`/`e2e-dblclick`/`done-smoke` 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，邮件页 `/mail`）**：照 `docs/mail-page-requirements.md` v1.1 做完**只读合并收件箱**——多账号 IMAP 合并列表（每页 50、可一直翻到最早一封）、右侧阅读区（HTML 经 DOMPurify 清洗 + 远程图片默认显示（2026-10-21 决策 D4 前是默认拦截）+ 纯文本切换 + 附件下载）、账号抽屉（增删改 + 试连 + 清本地标记）、本地已读标记（`mail_local_read`，只让本页该行变淡，**绝不回写服务器**）、文件夹切换（收件箱 / 已发送 / 垃圾箱…）、`j`/`k` 键盘切换、搜索与「只看未读」、侧栏第 2 位 + 命令面板入口。改动：新增 `server/mail/client.ts`、`server/mail/store.ts`、`server/routes/mail.ts`、`web/pages/MailPage.tsx`、`web/components/MailReader.tsx`、`web/components/MailAccountDrawer.tsx`、`web/lib/api.ts` 的 `api.mail.*`、`web/styles.css` 的 `.mail-*` 样式；`server/db.ts` 加 `mail_accounts`/`mail_local_read` 两表；`server/index.ts` 挂 `/api/mail` 与退出时 `shutdownMail()`；`web/lib/router.ts` 加 `/mail`。测试：`tmp/e2e-mail.mjs` **61 条断言全过**（D4 改版后增至 65 条；自带假 IMAP `tmp/fakeimap/server.mjs`：120 封 + 附件 + 追踪像素，覆盖空态/加账号/列表/翻页/正文/拦图/本地已读/筛选/键盘/文件夹/账号增删改/便签页回归/无 console 报错）、`tmp/fakeimap/mail-api-smoke.mjs` **50 条 API 断言全过**（含「打开邮件后服务器未读数不变」）；回归 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter`/`e2e-archive`/`e2e-tagbar`/`e2e-router`(23)/`e2e-tagpop`(49)/`e2e-tagpop-outside`(14) 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。**2026-10-21 用户绑了真实 Gmail（you@example.com，应用专用密码）后补测**：22 封一页拉完（`hasMore:false`，uid 1 是 2026-10-03 最早一封，能翻到最早）、文件夹列出 Gmail 的 `[Gmail]/已发邮件` 等 6 个特殊文件夹、正文 HTML 4628 字符 + 纯文本 485 字符、远程图片默认 0 个 `<img src>` 点「显示图片（2）」后放行、未读 11 条高亮 + 8 个未读点（11 减 3 条本地已读）、`j` 键盘选中、刷新仍停 `/mail`、无 console 报错（19 条断言全过）；**关键一条：全程只读之后服务器未读数仍是 11 / 总数 22，没被改写**（D1/FR-22 在真服务器上验证通过）。跨页翻页（`hasMore:true` 的下一页）仍待信箱多于一页时复测。

**已完成（2026-10-21，邮件页自动收信：60 秒轮询，决策 D5）**：用户问「这个邮箱是自动收信吗，还是要点刷新」，听完两种方案（轮询 vs IMAP IDLE）回「好，可以」，选**定时轮询**。改动：`web/pages/MailPage.tsx` 新增轮询 effect——页面可见时每 `POLL_MS`（默认 60 秒，`?poll=毫秒` 可覆盖，夹 1 秒~1 小时）调一次 `fetchList(offsetRef.current, true, true)` + `fetchAccounts(true)`；`document.visibilityState !== 'visible'` 直接 return，`visibilitychange` 回前台立刻补一次；`fetchList` 加第三个参数 `silent`，轮询时不 `setLoading`（不闪「正在取信…」）；`busy` 标志防重入。工具栏新增 `.mail-updated`「数据截至 HH:MM:SS」，值是服务端 `fetchedAt`（`server/mail/client.ts` 的 `ListResult` 新增字段 = `Math.min(...sources.map(s => s.snap.at))`，即这批数据真正从 IMAP 取回的时刻，命中缓存时是缓存时间；路由空态补 `fetchedAt: 0`；`web/lib/api.ts` 的 `MailListResult` 同步加可选字段）。测试：`tmp/e2e-mail.mjs` 新增第 13 节 7 条断言（用 `?poll=1500` 缩短间隔、用 imapflow 直接 APPEND 一封「自动刷新测试信」到假 IMAP、断言不点刷新也自己出现 / 自动请求带 `fresh=1` / 「数据截至」时间变了 / 页面隐藏后不再轮询 / 切回前台立刻补拉）→ **72/72 passed**（原 65 条 + 7）；真机 Gmail 用 `?poll=8000` 复测：「数据截至」从 11:04:49 走到 11:05:03、自动发 1 次 `fresh=1`、服务器未读数前后都是 8 / 总数 22、console 0 报错。`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，邮件页改版：默认显示图片 + 修排版，决策 D4）**：用户看完真机邮件反馈「我点开邮件全是图片已拦截」「默认显示图片，然后把排版什么的给我修正」，据此反转 FR-20 并重做阅读区渲染。改动：`web/components/MailReader.tsx` 整份重写——**正文进 Shadow DOM**（邮件自带 `<style>`/内联 `style` 全部保留，只在 shadow 内生效，不再污染便签夹）、`buildMailDoc()` 收集并移出 `<style>` 后拼 `BASE_CSS + 邮件CSS`、`scrubCss()` 只去危险片段（`@import`/`expression(`/`javascript:`/`behavior`，`position:fixed|sticky`→`static`）、远程图片**默认加载**（`localStorage['pinboard-mail-images']` 记 `show`/`hide`，默认 show；隐藏时才摘 `src` 到 `data-src` 并出 `.mail-img-banner` 提示条）、不再注入 `alt="图片已拦截"`、新增 `fitWidth()` 用 `doc.style.zoom` 把固定宽度邮件（720px 表格）等比缩进容器（`ResizeObserver` 只在宽度变化时重算，防自激）；`web/styles.css` 删掉穿不透 shadow 的 `.mail-html` 后代死规则、加 `.mail-img-banner`。根因记录：只给 `.mail-doc *` 加 `max-width:100% !important` 没用——表格 used width 取 `max(min-content,…)`，内部 720px 容器把 min-content 顶死，`max-width:100%` 又按 720 的 TD 解析成循环依赖，所以必须 zoom。测试：`tmp/e2e-mail.mjs` 图片断言整体改写（用 `.mail-doc` 穿透 shadow 取正文，新增 6 条：默认直接加载 / 有「隐藏图片」/ 隐藏后 `img[data-blocked]` 无 src 但留 `data-src` / 出现提示条 / 点「显示图片」恢复加载且提示条消失）→ **65/65 passed**；`tmp/fakeimap/mail-api-smoke.mjs` 50/50 passed；真机 Gmail 前 8 封逐封量：`overflowing: 0`、`brokenImgs: 0`（zoom 0.889~0.93），图片 17/17、14/14、24/24、15/15 全部加载成功、`styleTags:1`、表格数 52~151（排版回来了）；回归 smoke/e2e/done-smoke/e2e-done/e2e-dblclick/e2e-filter/e2e-archive/e2e-router(23)/e2e-tagpop(49)/e2e-tagpop-outside(14) 全绿（`e2e-tagbar` 与 `e2e-monitor-note` 原硬编码期望值随资产/观测项变化过期，已改成从 API 取期望值）；`pnpm typecheck` 0 错误、`pnpm build` 通过。

已知问题与坑（都踩过，勿回退）：
1. SQLite 建表语句每条必须以 `;` 结尾，否则 `db.exec` 报 `near "CREATE": syntax error`。
2. pnpm 12 不再读 package.json 的 `pnpm` 字段，构建脚本白名单只能写在 `pnpm-workspace.yaml` 的 `allowBuilds`（否则 esbuild 被拦，`ERR_PNPM_IGNORED_BUILDS`）。
3. 资产「备注」字段叫 `notes`，关联便签叫 `linkedNotes`，两者不能同名（曾导致 TS 冲突 + 抽屉崩溃）。
4. 标签正则必须包含中文标点前缀，否则「。\#整理」识别不到。
5. 命令面板容器必须 `position: fixed`（.palette-wrap），否则会被 flex 布局挤到侧边。
6. 无鉴权，仅限本机使用。
7. **搬动目录后第一次 `pnpm start` 会报 `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR` / `Failed to remove modules directory contents: 拒绝访问 (os error 5)`**：pnpm 发现 `node_modules` 的虚拟 store 路径变了，会尝试重装又删不掉。解法是 `Remove-Item .\node_modules -Recurse -Force` 后重新 `pnpm install`（有本地 store，1–2 秒完成）。2026-10-19 从 `D:\projects\pinboard` 搬过来时就踩了这个；当晚搬到 `D:\pinfolio` 时**先删 `node_modules` 再搬**（该目录里 245 个 junction 全是旧绝对路径，搬完必断），搬后 `pnpm install` 2.9 秒装回 103 个包、零下载。
8. **观测页大片「待定」+「检查 40+ 分钟前」= Kuma 假死，不是 pinboard 的问题**：Kuma 用 SQLite 单连接池，被一条语句占住后所有接口挂起，日志刷 `KnexTimeoutError: Timeout acquiring a connection`。先看 `D:\kuma\logs\kuma.log` 尾部，有这条就 `D:\kuma\tools\kuma.ps1 restart`（细节见 `D:\kuma\OBS-NOTES.md` 坑 #9）。pinboard 侧只会如实显示旧心跳。
9. **观测台不能每次请求都 `?fresh=1` 直捅 Kuma**：Kuma 的 `/api/status-page/obs` 在它自己 5 分钟缓存过期那一刻、又正好赶上 12 个探测在跑时，实测要 **5–30 秒**才回（心跳接口只要几十毫秒）。早期版本前端每次加载都带 `fresh=1` + 后端 8 秒超时，结果服务重启后缓存为空 → 超时 → 502 → 页面渲染成空态，看起来就是「观测页是空的」。现在的做法：清单缓存 5 分钟并预热、心跳按需取、超时 25 秒、失败沿用旧值，前端只在手动刷新时传 `fresh=1`。
10. **`tools/pinboard.ps1` 必须存成 UTF-8 带 BOM**：`start.cmd` / `stop.cmd` 是用 `powershell`（Windows PowerShell 5.1，不是 pwsh 7）调它的，无 BOM 时它按 GBK 解码 → 中文全乱 → 报 `Unexpected token '...' in expression or statement` 并把整份判成语法错误、一行都不执行（2026-10-20 改后台启动时踩过：`stop.cmd` 直接跑不起来，只剩一句 `Press any key to continue`）。重写该文件用 `[System.IO.File]::WriteAllText($f,$t,[System.Text.UTF8Encoding]::new($true))`。⚠️ **agent 的 `edit`/`write` 工具写出的文件一律无 BOM**（2026-10-20 改 `Show-Logs` 时被静默剥掉，脚本当场 ParseError 且 stdout 全空、只有 stderr 有错）——每次编辑完都要检查/补回 BOM：`([System.IO.File]::ReadAllBytes($p))[0..2] -join ','` 必须是 `239,187,191`。`run-pinboard.vbs` 则**必须 CRLF**（同 kuma）。
11. **弹层别只往一个方向展开**：`.content` 是 `overflow-y:auto` 的滚动容器，任何往上顶出它上边界的绝对定位弹层都会被裁掉，而且滚不回来（scrollTop 不能为负）。`.tag-pop` 2026-10-21 就踩了这个（被遮住一半）。以后加同类弹层，要么像 `CommandPalette` 用 `position: fixed`，要么照 `openTagMenu()` 的写法量剩余空间选方向。
12. **邮件页一行 `STORE` 都不许有**（需求 NFR-5 / 决策 D1：在这里看完，回原邮箱必须仍是未读）。只读是两层保证：`getMailboxLock(folder, { readOnly: true })` 以 EXAMINE 打开信箱 + imapflow 的 `fetch`/`fetchOne` 天生用 `BODY.PEEK`。**别为了「点开就标已读」去加 `messageFlagsAdd`/`STORE +FLAGS \\Seen`**——那就是回写服务器；「本页看过」只能写本地 `mail_local_read`。
13. **163 必须发 `IMAP ID` 才能打开收件箱**（否则服务器回 `Unsafe Login`）：imapflow 登录时会按服务器 capability 自动补发，代码里不用手写，但**别把 `makeClient()` 里的 `clientInfo: { name:'pinboard', ... }` 删掉**——删了 163 就登不进去。
14. **远程图片是默认加载的（D4 反转了 FR-20），只有用户点「隐藏图片」时才在 DOMPurify 之前把 `src` 摘成 `data-src`**：DOMPurify 默认保留 `<img src>`，若先清洗再摘，`data-src` 会被 `FORBID_ATTR`/`ADD_ATTR` 规则吃掉，隐藏就形同虚设、追踪像素照样被请求。顺序必须是「DOMParser 摘 src → DOMPurify」。另外**别再给被拦图片注入 `alt="图片已拦截"`**——17 张图就刷 17 遍 alt 文字，用户 2026-10-21 反馈「全是图片已拦截」就是这么来的；占位交给 CSS `img[data-blocked]` 的虚线框。
15. **列表分页不能糊成无限滚动**：FR-11 要求「能一直翻到最早一封」，`listMessages()` 是游标式归并（每账号 UID 倒序 50 封一批、多账号取队头比时间、`offset` 跳过已展示项、`hasMore` 表示还有），改算法前先跑 `tmp/e2e-mail.mjs` 的翻页断言（「最后一页下一页禁用」是边界）。
16. **邮件测试要单独装假 IMAP 服务器**：`tmp/fakeimap/` 有**自己的一份 `package.json`**（hoodiecrow-imap + imapflow + mailparser），它的 `node_modules` 不是项目依赖；清过 `tmp/` 或换机器后先 `cd tmp/fakeimap; npm install`。跑 `node tmp/e2e-mail.mjs` 需要 7788 上的 pinboard 已经在跑（脚本自己 `startFakeImap(120)` 起在随机端口，不需要真邮箱）。⚠️ 两个测试脚本开头都会清账号，**已改成只删 host 是 `127.0.0.1`/`localhost` 的假 IMAP 账号**（真实账号只 `console.warn` 跳过），且都支持 `MAIL_E2E_BASE` 指向隔离实例——**有真实 Gmail 账号在库里时，务必用隔离实例跑**：`$env:PINBOARD_DATA='D:\pinfolio\tmp\e2e-data'; $env:PORT='7799'; pnpm start`，再 `$env:MAIL_E2E_BASE='http://127.0.0.1:7799'; node tmp/e2e-mail.mjs`。跑完删掉 `tmp/e2e-data`。
17. **列表摘要必须清洗**：`snippetFromText()` 吃的是 IMAP 的 `TEXT` 分支前 800 字（`bodyParts maxLength`），真实邮件里会带 `[image: xxx]` / `[cid:xxx]` 内嵌图占位符、Outlook 条件注释 `<!--[if mso]>`，甚至因为 800 字截断而**留下没有收尾的半截注释**，营销邮件还会塞一堆 `U+034F` 零宽字符撑预览。这些在列表里全是脏字，已在 `snippetFromText()` 里统一剥掉（成对注释 → 到文末的残注释 → `<!…>` → 残留标签 → `[image:|cid:]` → 零宽字符 → 折叠空白），单测 `tmp/snippet-test.mts`（`npx tsx tmp/snippet-test.mts`）。**别改成「先 slice(0,240) 再清洗」**——那又会切出半截注释。
18. **自动刷新（D5）是「可见才轮询」，改它之前先看清三条**：① 轮询必须走 `fresh=1`——否则 60 秒的 `LIST_TTL` 缓存会把新信挡在外面，看着像「轮询没生效」；② 轮询只能静默（`fetchList(..., silent=true)`）——一旦 `setLoading(true)`，用户正读着信列表会闪成「正在取信…」，且 `setLoading` 抖动会牵动底部翻页条；③ 判断「页面在不在前台」用 `document.visibilityState`，**不要**用 `window.onfocus`（切换显示器/点开发者工具都会误判）；④ 轮询会一直重跑，effect 的依赖只放 `accounts.length`/`accountsLoaded`/`fetchList`/`fetchAccounts`，**别把 `offset`/`items` 塞进去**（每翻一页/每来一封就重建定时器）；⑤ `?poll=毫秒` 是留给测试和调参的开关，e2e 用 `?poll=1500` 才能在十几秒内验完，别为了测试去改 `POLL_MS` 常量。
19. **邮件正文渲染必须走 Shadow DOM，且宿主上的后代选择器是死代码**：邮件 CSS 是全局作用域，直接塞进主文档会污染便签夹（试过删掉所有内联 `style` 来隔离，结果营销邮件的表格排版全崩——用户 2026-10-21 报「排版给我修正」）。现在 `root.innerHTML = docHtml` 进 shadow，`styles.css` 里 `.mail-html` 只能写宿主自身（`display/min-width`），写 `.mail-html .mail-doc{…}` 一条都不会生效。`fitWidth()` 的 `ResizeObserver` **只能按宽度变化重算**——zoom 会改高度，按尺寸全触发会自激抖动。测邮件页**别用 `waitUntil:'networkidle'`**（`/api/mail/accounts?counts=1&fresh=1` 走真 IMAP 会挂 30s 超时），用 `domcontentloaded` + `waitForSelector('.mail-row')`，Gmail 偶发超时就重跑；取正文要查 `.mail-doc`（Playwright 的 CSS 选择器能穿透 shadow），`.mail-html` 宿主的 `textContent` 是空的。

## 迁移建议
项目已经独立在 `D:\pinfolio`，这个目录本身就能当仓库根。搬到别的机器/路径时带走：`server/`、`web/`、`tools/`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`.gitignore`、`start.cmd`、`stop.cmd`、`run-pinboard.vbs`、本文件；不要带 `data/`（个人数据）、`dist/`、`logs/`、`node_modules/`、`tmp/`。
需要改的硬编码：端口 7788（`server/index.ts` 与 `vite.config.ts` 代理）、数据目录 `data`（`server/db.ts` 的 DATA_DIR）。要给别人用需自行加登录鉴权与 HTTPS。
邮件功能另外依赖 `imapflow` + `mailparser`（纯 JS，已在 `package.json` 里，不需要额外服务）；`tmp/fakeimap/` 的假 IMAP 服务器只是测试用，搬家不用带。

## 可清理项
- `tmp/` 整个目录 —— 开发期脚本与截图，可随时删（`docs/screenshots/` 已另存一份，删了不影响 README）：
  - 冒烟与端到端：`tmp/smoke.mjs`、`tmp/e2e.mjs`、`tmp/done-smoke.mjs`、`tmp/e2e-done.mjs`、`tmp/e2e-dblclick.mjs`、`tmp/e2e-filter.mjs`、`tmp/e2e-archive.mjs`、`tmp/e2e-tagbar.mjs`（资产页标签栏 12 条断言：默认全部标签 / 旧下拉框已删 / 9 个标签带数量 / 数量降序 / 代理筛出 3 条 / 再点取消）、`tmp/e2e-tagpop.mjs`（标签弹层 49 条断言：三个视口尺寸下弹层不被 `.content` 裁、标题/新建按钮可见、首个 chip 不是半行、矮窗口列表自滚、长草稿改回往上展开、点标签插进输入框）、`tmp/e2e-tagpop-outside.mjs`（标签弹层收起 14 条断言：点外部三处 / 点内部不关 / Esc / 滚页面收起 / 滚弹层列表不关 / 按钮开关）、`tmp/e2e-router.mjs`（页面路由 23 条断言：URL 变更 / 刷新保持 / 深链 / 后退 / 未知路径归一 / 标题 / 无 console 报错）、`tmp/e2e-mail.mjs`（邮件页 **72 条**断言：空态 / 加账号 / 列表 / 翻页 / 正文 / 默认显示图片 / 隐藏图片后 `data-blocked` + 提示条 / 恢复显示 / 本地已读 / 筛选 / 键盘 / 文件夹 / **自动轮询（`?poll=1500` + imapflow APPEND 新信 + 切后台暂停 + 回前台补拉）** / 账号增删改 / 无 console 报错；**需 pinboard 已在跑 + `tmp/fakeimap` 装好依赖**，跑法见坑 16 的隔离实例说明）
  - 摘要清洗单测：`tmp/snippet-test.mts`（`npx tsx tmp/snippet-test.mts`，7 条：`[image:]`/`[cid:]` 占位符、Outlook 条件注释、被 800 字截断的半截注释、零宽字符、普通纯文本里的 `<` 不能误伤）
  - 假 IMAP 与邮件 API 冒烟：`tmp/fakeimap/server.mjs`（hoodiecrow-imap 起的假服务器：120 封 + 附件 + 追踪像素，随机端口）、`tmp/fakeimap/mail-api-smoke.mjs`（邮件 API 50 条断言，含「打开邮件后服务器未读数不变」；同样支持 `MAIL_E2E_BASE`，有真实账号时要指向隔离实例，否则「无账号空态」等断言会失败，实测直连 7788 是 37/50）、`tmp/fakeimap/probe*.mjs`（当时摸 hoodiecrow 插件能力的一次性探针）、`tmp/fakeimap/package.json` + `package-lock.json`（**自带依赖清单，node_modules 已被 .gitignore 忽略**）
  - 截图：`tmp/shots.mjs`、`tmp/shots-assets.mjs`、`tmp/shots-tagpop.mjs`（标签弹层，顺带重拍 `docs/screenshots/tag-picker.png`）、`tmp/shots-mail.mjs`（邮件页 inbox/深色/账号抽屉，产物 `tmp/shot-mail*.png`）、`tmp/resize-shots.ps1`（把 2x 截图缩成 1x 再放进 `docs/screenshots/`）
  - 一次性数据脚本：`tmp/seed-assets.mjs`（按当前资产清单重建台账）
  - 排障残留：`tmp/inspect.mjs`、`tmp/dbg.mjs`、`tmp/dbg2.mjs`、`tmp/server.out.log`、`tmp/server.err.log`
- `logs/` —— 运行日志（`pinboard.log`，追加不轮转），可随时清空/删除；已进 `.gitignore`（`*.log`）。
- `dist/` —— 构建产物，`pnpm build` 可重建。
- `data/` —— 个人数据，删掉等于清库（谨慎）。


## 设计约束（用户 2026-10-19 明确，别再改）

- 便签与资产是**两个纯粹独立的页面**，不需要产生任何关联：**不要再新增任何便签↔资产联动功能，也别主动提议**。
- `notes.asset_id` 与资产抽屉里的「关联便签」是既有的可选能力，**保留不动、不扩展**（当前 0 条便签使用）。

