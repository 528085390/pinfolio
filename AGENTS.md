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
- `docs/mail-page-requirements.md` —— **邮件页的唯一需求来源（v1.1 定稿）**：目标/非目标、FR-1…FR-29、NFR-1…NFR-10、数据模型、接口约定、12 条验收、Q1–Q10 定案、D1–D6 决策（D1 永不回写已读、D2 本地已读标记、D3 Gmail 实测暂缓、D4 远程图片默认显示 + 保留邮件样式、D5 60 秒轮询自动收信、D6 账号级 SOCKS5 代理）。动邮件页之前先读它——**别把「发信 / 删除 / 标已读」加回来**。
- `docs/pitfalls.md` —— **已知问题与坑的完整 29 条**（编号稳定，「见坑 N」都指这里）；`AGENTS.md` 只留最要命的 5 条。
- `docs/status-history.md` —— **2026-10-19 → 2026-10-21 的 23 条进展记录**（每条含当时的测试断言条数与真机复测结论）。`AGENTS.md` 的「状态」只留当前状态，**新增进展往这里写**。
- `docs/huawei-cloud-voucher-200.md` —— **华为云 ¥200 代金券（资产 #30）的使用手册**：券信息、能开什么、下单 5 项核对、建机步骤、¥200 能覆盖几个月、花完后的续费来源（Grow 成长中心）、验收清单。资产 #30 的备注里指到这篇；换券 / 新开境外机先读它。
- `docs/screenshots/` —— README 引用的截图（notes / assets / asset-drawer / tag-picker / note-done / dark / monitors / monitors-2560 / monitor-drawer / monitor-drawer-delete / monitor-alert / monitor-alert-jump / monitor-alert-dark / mail-inbox / mail-dark / mail-account），从 `tmp/` 挑出来固化，不受 `tmp/` 清理影响。
- `data/` —— 运行时 SQLite 数据（不进版本库）。
- `dist/web/` —— 前端构建产物，server 直接托管（不进版本库）。
- `tests/` —— 冒烟 / 端到端 / 单测（`tests/unit/`，`pnpm test:unit`，node:test 秒级）+ 串行 runner（`tests/run.mjs`）+ 假 IMAP（`tests/fakeimap/`）。
- `tools/screenshots/` —— 截图脚本（产物写 `tmp/`，已被 .gitignore 忽略）。
- `tmp/` —— 运行期临时产物（日志、截图），可整目录删除（见「可清理项」）。

服务端（Node 24 + Hono + `node:sqlite`，无原生编译）：
- `server/schema/core.ts` / `server/schema/mail.ts` —— 建表语句（core：tags / field_defs / assets / notes / note_tags / asset_tags + 5 个索引；mail：mail_accounts / mail_local_read）。`server/db.ts` 只负责打开库、执行两段 schema、封装 `all/get/run` 与标签同步（`syncNoteTags`/`setAssetTags`），并做 `notes.done` / `mail_accounts.proxy` 的启动迁移。
- `server/tags.ts` / `server/dates.ts` —— 纯函数（不碰库、不碰网络）：`extractTags`（TAG_RE 支持中英文标点前缀）、`tagColor`/`TAG_COLORS`/`PRESET_TAGS`；`daysLeft()` 到期天数。**纯逻辑放这里才测得了**（`db.ts` 一 import 就打开 SQLite），db.ts / meta.ts 再导出。
- `server/hydrate.ts` —— `hydrateNotes`/`hydrateAssets`：批量 IN 查询拼 tags、asset、noteCount，解析 custom JSON。
- `server/routes/notes.ts` —— 便签 CRUD + 筛选（q/tag/pinned/archived/assetId），内容变更时同步标签。
- `server/routes/assets.ts` —— 资产 CRUD + 筛选（q/kind/status/tag），GET /:id 附带 `linkedNotes`（已 hydrate 标签）。
- `server/routes/tags.ts` —— 标签 CRUD，GET 带 notes/assets 计数。
- `server/routes/fields.ts` —— 自定义字段定义 CRUD（key 正则 `^[a-zA-Z][a-zA-Z0-9_]*$`，type 限 text/number/date/url/select/bool）。
- `server/kuma/routes.ts` —— 观测台 HTTP 面（列表/详情/写操作/立即观测）：聚合 Uptime Kuma 的 `/api/status-page/:slug`（观测项清单）与 `/api/status-page/heartbeat/:slug`（心跳 + 24h 可用率）成 `{kuma, updatedAt, summary, groups}`；**两半分开缓存**（清单 5 分钟 + 启动预热 + 每 5 分钟续一次，心跳 5 秒），Kuma 慢/挂了沿用旧值并标 `stale`；`monitor-links.json` 把观测项映射到项目管理页（**按 `id` 匹配，`name` 只兜底**——名字能在抽屉里改）。
  写接口都在这里：`GET /:id`（详情：脱敏后的 monitor + 最近 24h 心跳 + 立即观测配方 + 跳转链接）、`PATCH /:id`（改名/介绍/频率/超时重试，校验后整体回传 Kuma）、`POST /:id/pause|resume`、`DELETE /:id?confirm=<名字>`（先备份 Kuma 库再删）、`POST /:id/check`（跑立即观测配方）。**所有写接口都要求 `Content-Type: application/json`**（挡跨站表单提交，DELETE 只在带 body 时校验）；写完统一 `invalidate()` 清缓存 + 15 秒内强制绕过 Kuma 的状态页缓存 + 防抖 1.5 秒后 spawn `kuma/tools/snapshot.cjs` 重生成 `kuma/SNAPSHOT.md`。
- `server/kuma/client.ts` —— 跟 Kuma 说话的 **socket.io 客户端**（不是 HTTP）：`connect()` 登录后常驻连接（`reconnection:false`，**别加 `transports:['websocket']`**，会握手超时）、`call()` 等 ack（20 秒超时，`res.ok===false` 抛 `KumaError`）、`listMonitors()`（先 `on('monitorList')` 再 `emit('getMonitorList')`，ack 里没有数据）、`getMonitor`/`getBeats`/`editMonitor`/`pauseMonitor`/`resumeMonitor`/`deleteMonitor`/`kickCheck`。`toView()` 只输出白名单字段，`redactUrl()`/`describeTarget()` 把 URL 里的账号密码与 `key|token|pass|secret|auth|sign` 参数打码，**别把 Kuma 的原始 bean 直接吐给前端**（含 SSH 私钥）。脱敏与展示映射实际在 `server/kuma/redact.ts`（纯函数，可单测），client.ts 只再导出。
- `server/kuma/actions.ts` —— 「立即观测」的配方解析 + 执行器：配方来自根目录 `monitor-actions.json`（**每次请求热读**，改完不用重启；写坏了当没配方），按 `id` 再按 `name` 匹配；没配方时非推送型默认 `[{type:'kuma-check'}]`、推送型置灰（要外部心跳驱动，没法本地触发）。步骤类型 `kuma-check`（重启检查循环，Kuma 几百毫秒内真探一次）/ `http`（发请求，优先读回包里的 `message|msg|error`）/ `command`（`shell:false` + argv 数组，不过 shell）。执行语义：顺序跑、失败即中止、整体 60 秒上限、每步独立超时，逐步骤回 `{type,label,ok,detail,ms}`。
- `server/mail/client.ts` —— 邮件后端（imapflow + mailparser，纯 JS，无原生编译）：连接池 `pool`（按账号 id 存，账号改密码/连接不可用时自动重建）、`listMessages()` 多账号归并（每账号按 UID 倒序、每批 `CHUNK = 50` 封 fetch，用「取各账号队头比大小」的方式归并，`offset` 跳过、`hasMore` 表示还有）、`getMessage()`（`fetchOne(uid, {source:true})` → `simpleParser`，>25 MB 直接报错不下载）、`listFolders()`、`testConnection()`、`friendlyError(err, proxy?)`（把 ECONNREFUSED / EAUTH / 证书 / STARTTLS 等翻成中文人话，传了代理会说明「经代理 socks5://…」）、`proxyOf(a)`（账号 `proxy` 优先，环境变量 `PINBOARD_MAIL_PROXY` 兜底）。**代理是 imapflow 原生能力**：`makeClient()` 里 `...(proxy ? { proxy } : {})`，依赖里自带 `socks`，不用加包（见坑 29）。`sigOf()` 把 `proxy` 也算进签名，改代理会重建连接。
  **缓存全在内存**：列表 `LIST_TTL = 60_000`、正文 `BODY_TTL = 10 分钟`（`BODY_CACHE_MAX = 40` 封，LRU）、文件夹 5 分钟；`?fresh=1` 绕过。**只读靠 `getMailboxLock(folder, { readOnly: true })`**（EXAMINE 打开信箱）——别改成可写打开，那等于给 imapflow 留了 `STORE` 的机会。列表摘要只抓 `bodyParts: [{ key: 'TEXT', maxLength: 800 }]`，不下载整封信。
- `server/mail/store.ts` —— `mail_accounts`（label/email/host/port/username/password/security/**proxy**/enabled/sort）与 `mail_local_read`（account_id/folder/uid/read_at，主键三列）两张表的 CRUD；`publicAccount()` 一律剔掉 `password`、只给 `hasPassword`（`proxy` 会返回，它不含密码但含内网地址）；`normalizeProxy()` 校验并规范化代理（实现在 `server/mail/proxy.ts`，纯函数；空串=直连；省略协议补 `socks5://`；白名单 `socks/socks5/socks4/socks4a/http/https`；必须 host、不能带路径、端口 1–65535）；`normalizeAccountInput()` 做校验与默认值（port 993 / security ssl），**`proxy` 字段 `undefined` = 不改、`''` = 显式改直连**（别把两者混掉）；`updateAccount()` 里**密码传空字符串等于「不改」**；`deleteAccount()` 连带删掉该账号的本地已读标记。
- `server/mail/routes.ts` —— `/api/mail/*`：`accounts`（`?counts=1&fresh=1` 带未读数）/ `accounts/test` / `folders` / `messages`（`account=all|<id>&folder=&limit=&offset=&fresh=1`，返回 `{items,total,unseen,hasMore,errors,partial}`）/ `message` / `attachment`（`Content-Disposition` 同时给 ASCII 与 `filename*=UTF-8''`，中文文件名不乱码）/ `local-read`（POST 记、DELETE 清，`account=all` 清全部）/ `status`。`shutdownMail()` 在进程退出时断开所有 IMAP 连接。
- `server/index.ts` —— 薄入口（62 行）：挂 `/api` 各路由 + 写操作后 `scheduleSnapshot()` 中间件 + 静态托管 + notFound/onError + `serve` 7788 + 退出时 `shutdownMail()`。
- `server/routes/meta.ts` —— 杂项接口：`/api/health`、`/api/bootstrap`、`/api/search`、`/api/stats`、`/api/export`、`POST /api/seed`（仅空库时写 2 个字段定义 + 4 资产 + 4 便签）。
- `server/static.ts` —— `mountStatic(app)` 托管 `dist/web`（MIME 表、index.html no-cache、深链回 index.html）。
- `server/kuma/feed.ts` —— 观测数据的抓取与缓存：状态页清单（5 分钟 + 预热）、心跳（5 秒）、`collect()` 组装 `{kuma, updatedAt, summary, groups}`、`lastPayload()` 供 Kuma 挂掉时回旧值、`invalidate()` 清缓存并让 15 秒内请求带 `x-apicache-bypass:1`。
- `server/kuma/links.ts` —— `monitor-links.json` 的加载与 `pickLink()`（id 优先、name 兜底）。
- `server/kuma/beat.ts` —— 心跳纯函数：`toneChar()` 解析 `[绿|黄|红|灰]` 前缀、`toIso()` 把 Kuma 无时区 UTC 串转 ISO、`mapBeat()` 归一单条心跳；feed.ts 再导出。
- `server/kuma/backup.ts` —— `refreshSnapshot()`（防抖 1.5 秒 spawn `kuma/tools/snapshot.cjs`）与 `backupDb()`（`VACUUM INTO`，留最近 5 份）。
前端（Vite 7 + React 19 + 手写 CSS，无 UI 框架）：
- `web/App.tsx` —— 侧栏导航（便签/**邮件**/资产/观测/设置 + 计数）、主题切换（localStorage `pinboard-theme`，data-theme）、Ctrl/⌘+K 命令面板；**页面状态不在这里用 `useState`，而是 `const [page, setPage] = usePage()` 从 URL 取**（2026-10-20 起）。
- `web/lib/router.ts` —— 页面路由（2026-10-20 加）：`pageFromPath()`（`/mail` `/assets` `/monitors` `/settings` 映射成页面；`/`、未知路径、带尾斜杠一律归便签）、`pathForPage()`、`usePage()` hook（初始值取 `location.pathname`、`popstate` 跟前进后退、`history.pushState` 改地址栏、同步 `document.title`）。**别把页面状态改回 `useState('notes')`**——那样一刷新就回便签页（用户 2026-10-20 反馈的问题）。
- `web/pages/NotesPage.tsx` —— 顶部 composer（Ctrl/⌘+Enter 保存，含「标签」弹层与新建标签）、置顶区/全部区、筛选 chips（全部/未完成/已完成/置顶/标签/＋新标签/已归档）、防抖搜索、行内编辑、归档、关联资产；**完成状态**：圆形对勾按钮或**双击卡片正文**都能切换（双击忽略按钮/链接/标签/编辑框，并清掉浏览器默认选中文字），切换走本地乐观更新、不重排列表，只有处于「已完成/未完成」筛选时才重新拉取。
  **归档模式（`archivedMode` state，2026-10-20 加）**：默认视图**没有硬删除**，卡片右上角是「归档」（`PATCH {archived:true}`，`archive()`）。点筛选行的「已归档」chip 进入**只读归档视图**：`load()` 带 `archived='1'`，隐藏 composer / 完成圆圈 / 置顶 / 编辑 / 标签 chips / 全部·未完成·已完成·置顶 chips，双击不再切完成，卡片只留「恢复」（`restore()` → `PATCH {archived:false}`）与「永久删除」（`remove()`，danger 样式，confirm「永久删除这条便签？不可恢复。」）。`toggleArchivedMode()` 会清掉 tag/pinnedOnly/doneFilter/editingId。归档条数由 `App.tsx` 传 `archivedCount={stats?.archived ?? 0}` 显示在 chip 上。**别把 DELETE 入口加回默认视图**——用户明确要求「删除改归档，只在已归档里允许永久删除」。
  **标签弹层（`.tag-pop`，2026-10-21 修）**：`openTagMenu()` 打开前量按钮上下剩余空间（把所有 `overflowY` 非 visible 的祖先矩形取交集当可视边界），上面放不下就加 `.tag-pop-down` 往下展开，并把 `max-height` 压进剩余空间（96–320px）；弹层内部是 flex 三段（`.tag-pop-head` / `.tag-pop-list` / `.tag-pop-new`），只有列表自己滚，标题和「新建标签…」不会被滚走。**收起规则（2026-10-21 加，用户要求「点标签栏以外就缩回去」）**：`tagMenu` 为真时挂三个 document 监听——`pointerdown`（捕获）点弹层外任意处收起、`keydown` 的 `Escape` 收起、`scroll`（捕获）页面滚动收起。按钮和弹层共用一个 `tagWrapRef` 包裹 div，命中 `tagWrapRef.contains(target)` 就放行：点「标签」按钮仍走 `openTagMenu()` 的开关切换（不会「关了又被 click 打开」），滚弹层自己的 `.tag-pop-list` 也不会把自己关掉。**别把 `scroll` 监听改成 `window.addEventListener('scroll')` 的非捕获写法**——`.content` 才是滚动容器，事件不冒泡到 window，那样页面滚动根本收不起来。
  **别把 `bottom: calc(100% + 8px)` 写死回去、也别让整个弹层 `overflow:auto`**——`.content` 是 `overflow-y:auto`，往上展开超出它上边界的那 150px 会被裁掉而且滚不回来（用户 2026-10-21 报「便签标签被遮住一半」）。
- `web/pages/notes/` —— 便签页拆出来的四件（2026-10-21 路线 A 第 2 步，行为未变）：`useNotes.ts`（列表 + 筛选 + 单条操作，含乐观 `toggleDone`）、`useComposer.ts`（草稿/置顶/标签弹层的方向与高度/外部点击与 Esc 收起/新建标签）、`NoteCard.tsx`（单张卡片 + 行内编辑）、`Composer.tsx`（输入框 + 标签弹层）、`FilterBar.tsx`（筛选 chips + 搜索框）；`NotesPage.tsx` 只剩组合与空态文案。**改交互先看这五个文件的分工，别又全塞回 NotesPage**。
- `web/pages/AssetsPage.tsx` —— 统计卡（总数/在用/30 天内到期/已过期）、类型 chips、状态筛选、**标签栏（`.tag-bar`，2026-10-20 改）**、卡片/表格两种视图。标签栏 = 常显 chip 行（不再是「所有标签」下拉框）：`全部标签` + 每个**有资产关联**的标签 `#名称 数量`，**按关联数降序、同数按名称升序**（`usedTags` 里 `sort`），点 chip 筛选、再点取消。0 关联的标签不显示（用户 2026-10-20 选定）。**「节点」标签已于 2026-10-20 改名「自建节点」**——它原本是「代理」的纯子集（自建节点 2 条 ⊂ 代理 3 条），改名是为了在标签栏里显出层级、不再像并列重复；**别再改回「节点」**。
- `web/pages/MailPage.tsx` —— 邮件页：账号 chips（全部 / 各账号 + 未读数 + 失败红点）/ 文件夹下拉 / 刷新 / 搜索（在**当前这一页 50 封里**客户端筛，不发服务端 SEARCH）/「只看未读」/ 分页（每页 `PAGE = 50`，底部「上一页 / 下一页」+「1–50 / 共 N 封」，`offset` 与 `hasMore` 都来自后端）/ `j`·`k` 上下选邮件 / 点开即 `POST /mail/local-read` 记本地已读、该行加 `.local-read` 变淡。**列表用 offset 分页而不是无限滚动**——FR-11 要求「能一直翻到最早一封」，后端保证 `total`/`hasMore` 正确。
- `web/pages/MonitorsPage.tsx` —— 观测台：四格统计 + 机器/状态筛选 + 搜索 + 卡片/表格视图 + 30 秒轮询；卡片含 40 段心跳色条、响应毫秒、24h 可用率、异常次数，标题带 ↗ 跳 `monitor-links.json` 配的管理页。手动点刷新才带 `?fresh=1`，轮询走后端缓存。
  **点卡片或表格行打开 `MonitorDrawer`**（`openId` 状态）；抽屉开着时**暂停 30 秒轮询**（`if (!auto || openId !== null) return`），否则刷新会冲掉正在编辑的表单。已暂停的观测项卡片/行加 `.paused` 变淡 + 「已暂停」chip。卡片内与行内的 `<a>` 要 `stopPropagation`，否则点链接也会开抽屉。
  点异常通知跳转时由 `focusId` 定位卡片（`id="monitor-<id>"`）、滚进视口并加 `.flash` 高亮 1.6 秒，`onFocusDone` 清状态；找不到就先清掉分组/状态/搜索筛选再试一次。
- `web/pages/SettingsPage.tsx` —— 外观、自定义字段、标签管理、导出 JSON、空库灌示例数据。
- `web/components/FormDrawer.tsx` —— 编辑类抽屉的共用壳（Drawer + 错误条 + 加载态 + 底部「左侧可选按钮 + 关闭 + 保存」）；资产与观测项详情都用它，新的编辑抽屉先复用它。
- `web/components/AssetDrawer.tsx` —— 资产详情抽屉（新建/编辑/删除、自定义字段按类型渲染、备注 Markdown、关联便签增删）。
- `web/components/MonitorDrawer.tsx` —— 观测项详情抽屉（外壳走 `FormDrawer`，交互照资产详情）：顶部状态条（状态 pill / 已暂停 / ping / 相对时间 / 最近消息 / 心跳色条）→「基本信息」（名称、介绍、检查频率 + 快捷 chip、类型与目标只读、分组、策略只读）→ 折叠的「高级设置」（超时 / 重试次数 / 重试间隔 / 常显消息）→「立即观测」（按钮 + 步骤列表 + 逐步骤回显）→「危险操作」（暂停/恢复、删除）。底部固定「关闭」+「保存」。**保存只提交与打开时不同的字段**（`sameForm` 比较），改名/改频率后 `reload()` 重取详情并 `onChanged()` 让列表刷新。删除是**二次确认面板**（替换掉动作条），必须把观测项名字原样输一遍按钮才可用。
- `web/components/BeatStrip.tsx` —— 40 段心跳色条，卡片、表格与抽屉共用；`beatClass()` 把 Kuma 的 status/tone 映射成 `s0/s1/s2/s3`（推送型是 `s-none`）。
- `web/components/AlertStack.tsx` —— 观测异常通知栈（`position: fixed` 右上角，z-index 90）：最多 4 条，每条 = 红色竖条 + 短名 + `组名 · 故障信息` + ×，超出显示「还有 N 条异常 · 查看全部」；点通知主体 = 关掉这条并跳到观测台高亮卡片，点 × 只关不跳。
- `web/components/MailReader.tsx` —— 阅读区。**正文走 Shadow DOM**：`htmlHost.attachShadow({mode:'open'})` + `root.innerHTML = docHtml`，邮件自带的 `<style>` 与内联 `style` 全部保留、只在 shadow 内生效，不污染便签夹；`styles.css` 里 `.mail-html` 只管宿主本身（后代选择器穿不透 shadow，写了就是死代码）。`buildMailDoc()` 流程：DOMParser 解析 → 收集并移出所有 `<style>` 文本 → 删 script/iframe/frame/object/embed/form/meta/base/link/noscript → `cid:` 换 `/api/mail/attachment?...` → 远程图**默认保留**（`showImages=false` 时才摘成 `data-src` + `data-blocked`，且**不再注入 `alt="图片已拦截"`**）→ 内联 `style` 过 `scrubCss()`（去 `@import` / `expression(` / `javascript:` / `behavior` / `-moz-binding`，`position:fixed|sticky` 改 `static`，隐藏图片时把 `url(https?:…)` 换 `none`）→ DOMPurify 兜底（`FORBID_TAGS: script/iframe/frame/object/embed/form/meta/base/link/style`、`FORBID_ATTR: srcset/ping/background/action/formaction`、`ADD_ATTR: target/data-src/data-blocked`；**`style` 属性不能进 FORBID_ATTR**）→ 拼成 `<style>BASE_CSS + 邮件CSS</style>` + `<div class="mail-doc">…</div>`（BASE_CSS 在前，邮件样式优先）。图片开关记本机 `localStorage['pinboard-mail-images']`（`show`/`hide`，**默认 show**，见决策 D4），隐藏时正文顶部出 `.mail-img-banner`；`fitWidth()` 处理固定宽度邮件（见坑 18）。HTML / 纯文本一键切换；附件清单走 `/api/mail/attachment` 下载。
- `web/components/MailAccountDrawer.tsx` —— 邮箱账号抽屉：新增 / 编辑（**密码留空 = 不改**）/ 删除 /「测试连接」（`POST /mail/accounts/test`，编辑已有账号时只带 `{id}` 复用库里存的密码）/「清除本地已读标记」（`DELETE /mail/local-read?account=all`）；抽屉里写明 Gmail 要应用专用密码、QQ/163 要授权码、163 需要 IMAP ID；「加密方式」下面还有**「代理（可选）」**（`form.proxy`，`test()` 与 `save()` 都带上；编辑时回填 `a.proxy`），提示文案说明「国内直连 imap.gmail.com 常超时，填 `socks5://127.0.0.1:10808`；QQ/163 留空直连」。
- `web/components/CommandPalette.tsx` —— 全局搜索（便签 + 资产）与快捷命令。
- `web/components/ui.tsx` / `Markdown.tsx` / `KindIcon.tsx` —— 通用按钮/字段/弹窗/抽屉/标签 chip、marked + DOMPurify 渲染、资产类型图标。
- `web/lib/api.ts` —— **门面**：聚合各领域客户端并再导出类型，页面继续 `import { api, cx, type Note } from '../lib/api'` 不用改。
- `web/lib/api/` —— 按领域拆开：`http.ts`（`request()` 统一拼 `/api`、带 JSON 头、把后端 error 抛成 Error）、`types.ts`（Tag/FieldDef/Stats）、`notes.ts`、`assets.ts`、`monitors.ts`（Monitor* 类型 + 客户端）、`mail.ts`（Mail* 类型 + 客户端）、`core.ts`（bootstrap/stats/search/export/seed + tags + fields）。
- `web/lib/cx.ts` —— `cx()` 拼 className（从 api.ts 挪出来，api.ts 仍再导出）。
- `web/lib/format.ts` —— 相对时间/金额/到期状态/类型与状态文案。
- `web/lib/paths.ts` —— 页面 ↔ URL 映射（`PATHS`/`TITLES`/`pageFromPath()`/`pathForPage()`，纯函数）；`router.ts` 只剩 `usePage()` 的 React 状态与地址栏同步，并再导出这些。
- `web/lib/monitors.ts` —— 观测异常通知的数据层：`useMonitorAlerts()`（30 秒轮询 `/api/monitors`，首轮只当基线，`stale` 整轮跳过，恢复自动移除，`dismiss` 记本地已关）+ 共享 helper `isDown()` / `shortName()` / `shortGroup()` / `plainMsg()`（MonitorsPage 也改用这几个，**别再各写一份**）。
- `web/styles/` —— 样式按区块拆成 12 个文件，`index.css` 用 `@import` 定顺序（顺序即层叠顺序）：tokens（暖纸色令牌 --paper #f6f3ec / --accent #b45309 + 深色覆盖）、shell、controls、notes、assets、overlay、palette、markdown、misc、monitors、mail、alerts。`main.tsx` 只 import `./styles/index.css`。

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

**当前状态（2026-10-21）**：7788 运行中，五页（便签 / 邮件 / 资产 / 观测 / 设置）全部可用。工程整理已收口——
服务端按职责拆分（`server/kuma/*`、`server/mail/*`、`server/routes/meta.ts`、`server/static.ts`），
前端 api 与样式分片，`tests/` 里有 57 条单测 + 14 套 e2e（`pnpm test` / `pnpm test:e2e`）。
已知长期红：本机 app-api `/healthz` 返回 503（上游账号问题，不是观测台的问题）。
未做：Gmail 跨页翻页（`hasMore:true` 的下一页）待信箱多于一页时复测；kuma 的 Windows Defender 排除项随旧路径失效，
需管理员重跑 `kuma\tools\add-defender-exclusions.ps1`。

**历史进展（2026-10-19 → 2026-10-21，23 条逐条记录）见 [`docs/status-history.md`](docs/status-history.md)**
—— 新增进展写那里，别往这里堆；这里只留「当前状态 + 截止日期」。

已知问题与坑（都踩过，勿回退）——**完整 29 条见 `docs/pitfalls.md`**（编号稳定；本文件与代码注释里的「见坑 N」都指那里的第 N 条，新增只往后加）。最要命的 5 条先记在这里：
1. **无鉴权、只监听 127.0.0.1**：绝不做端口映射 / 公网反代（坑 6）。
2. **邮件页一行 `STORE` 都不许有**：只读靠 `getMailboxLock(readOnly:true)` + `BODY.PEEK`，「本页已读」只写本地 `mail_local_read`（坑 12）。
3. **`tools/pinboard.ps1` 必须 UTF-8 带 BOM**（`edit`/`write` 写出来的没有 BOM，改完补 `239,187,191`）、`run-pinboard.vbs` 必须 CRLF，否则脚本静默不执行（坑 10）。
4. **Kuma 的 `editMonitor` 是全量覆盖、`toJSON()` 少 `showMsg`/`manual_status`**：PATCH 必须取整 bean、只改要改的几个字段、从状态页补 `showMsg` 再回传，否则静默清空（坑 21）。
5. **观测台不能每个请求都 `?fresh=1`，`stale` 响应不能拿来判定恢复**：前者撞 Kuma 5 分钟缓存过期时的 5–30 秒卡顿，后者会把所有告警当「已恢复」全关掉（坑 9、坑 28）。


## 迁移建议
项目已经独立在 `D:\pinfolio`，这个目录本身就能当仓库根。搬到别的机器/路径时带走：`server/`、`web/`、`tools/`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`.gitignore`、`start.cmd`、`stop.cmd`、`run-pinboard.vbs`、本文件；不要带 `data/`（个人数据）、`dist/`、`logs/`、`node_modules/`、`tmp/`。
需要改的硬编码：端口 7788（`server/index.ts` 与 `vite.config.ts` 代理）、数据目录 `data`（`server/db.ts` 的 DATA_DIR）。要给别人用需自行加登录鉴权与 HTTPS。
邮件功能另外依赖 `imapflow` + `mailparser`（纯 JS，已在 `package.json` 里，不需要额外服务）；`tests/fakeimap/` 的假 IMAP 服务器只是测试用，搬家不用带。

## 可清理项
- `tmp/` —— 只剩运行期日志与截图，可整目录删（`docs/screenshots/` 另存了 README 用的图）。测试与截图脚本已搬走：测试在 `tests/`（用法见 `tests/README.md`），截图脚本在 `tools/screenshots/`，一次性数据脚本 `tools/seed-assets.mjs`。
- `logs/` —— 运行日志，可随时清空；已进 `.gitignore`（`*.log`）。
- `dist/` —— 构建产物，`pnpm build` 可重建。
- `data/` —— 个人数据，删掉等于清库（谨慎）。

## 设计约束（用户 2026-10-19 明确，别再改）

- 便签与资产是**两个纯粹独立的页面**，不需要产生任何关联：**不要再新增任何便签↔资产联动功能，也别主动提议**。
- `notes.asset_id` 与资产抽屉里的「关联便签」是既有的可选能力，**保留不动、不扩展**（当前 0 条便签使用）。

