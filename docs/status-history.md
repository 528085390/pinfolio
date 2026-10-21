# pinboard 进展记录（2026-10-19 → 2026-10-21）

> 2026-10-21 从 `AGENTS.md` 的「## 状态」整段搬出来——那份文件每轮都注入上下文，把历史堆在那里太贵。
> **新增进展往这里加**；`AGENTS.md` 只留「当前状态 + 截止日期」和最要命的 5 条红线。
> 逐条都是当时的验证记录（含测试断言条数与真机复测结论），别删别改，需要考古时按日期翻。

## 逐条记录

**已完成（2026-10-19）**：便签/标签/资产/自定义字段/搜索/统计/导出全部可用；便签完成状态（圆圈按钮 + 双击卡片，乐观更新不重排）；资产台账已录入真实资产 8 条（5 在用 / 2 退役 / 1 丢失）。`pnpm typecheck` 0 错误、`pnpm build` 通过；API 冒烟与 Playwright UI 端到端（基础 13 条 + 完成态 11 条 + 双击 8 条 + 筛选 4 条）全绿、无 console 报错。

**已完成（2026-10-20）**：便签归档。默认列表的「删除」改为「归档」，硬删除只在只读的「已归档」视图里提供；`/api/search` 加 `AND archived = 0`。新增 `tests/e2e-archive.mjs`（20 条断言，含 API 层 archived=0/1/all 与 Ctrl+K 排除），RED→GREEN 走完；回归跑 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter` 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-20，资产页标签栏）**：资产页原来的「所有标签」下拉框换成常显 chip 行（用户要求「默认显示全部标签、标签后带关联数、数量多的排前面」）。只列有资产关联的标签（0 关联不显示，用户选定），按 assets 降序 / 同名 localeCompare(zh-CN) 升序。新增 tests/e2e-tagbar.mjs（12 条断言）；smoke / e2e / e2e-filter 回归全绿，pnpm typecheck 0 错误、pnpm build 通过。GLaDOS 与两个代理节点本来就共用「代理」标签（3 条），未改数据。

**已完成（2026-10-20，页面路由）**：便签/资产/观测/设置四页各占一个真路径（`/notes` `/assets` `/monitors` `/settings`），切页 `pushState`，刷新 / 深链 / 前进后退都停在同一页；`/` 与未知路径归一到 `/notes`；`document.title` 随页面变（如「观测台 · 便签夹」）。后端**没加新路由**——`server/index.ts:186-207` 的 `app.get('*')` 本来就对无扩展名路径回 `index.html`（SPA fallback），只给那段 fallback 补了 `Cache-Control: no-cache`（否则浏览器可能缓存某个页面的 HTML 壳）。新增 `tests/e2e-router.mjs`（23 条断言：URL 变更、刷新保持、深链、后退、未知路径归一、标题、无 console 报错），RED→GREEN 走完；回归 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter`/`e2e-archive` 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，标签弹层被裁）**：便签 composer 的「标签」弹层固定往上展开（`bottom: calc(100% + 8px)`）+ `max-height:260px; overflow:auto`，composer 又在页面顶部，结果 260px 高的弹层顶到 y=-92、被 `.content`（`overflow-y:auto`）裁掉 150px，第一行只露半截、「新建标签…」完全看不见，Playwright 连第一个 chip 都点不到（`element is outside of the viewport`）。改成按剩余空间选方向（上/下）+ 高度压进剩余空间 + 内部 flex 三段只滚列表。新增 `tests/e2e-tagpop.mjs`（49 条断言：1440x900 / 1280x720 / 1280x420 三个尺寸 + 长草稿改回往上展开，逐条查「弹层完整落在 `.content` 内、标题与新建按钮可见、首个 chip 不是半行、点标签能插进输入框并关层」），RED→GREEN 走完；回归 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter`/`e2e-archive`/`e2e-tagbar`/`e2e-router` 全绿（`e2e-tagbar` 原有两条硬编码 9 个标签 / 10 条资产随「华为云代金券」入库过期，已改成从 `/api/tags`、`/api/assets` 取期望值），`pnpm typecheck` 0 错误、`pnpm build` 通过；`docs/screenshots/tag-picker.png` 重拍。

**已完成（2026-10-21，标签弹层点外部收起）**：原来弹层只能靠再点「标签」按钮 / 点里面某个 chip / 点「新建标签…」关掉，点页面其它地方不收（用户 2026-10-21 要求「点一下标签栏以外的地方就缩回去」）。改为 `tagMenu` 为真时挂 document 级 `pointerdown`(捕获) + `Escape` + `scroll`(捕获) 三个监听，用 `tagWrapRef.contains(target)` 放行按钮与弹层内部。新增 `tests/e2e-tagpop-outside.mjs`（14 条断言：点 composer 提示 / 便签卡片 / 搜索框收起、点卡片不误切完成态、点弹层内部标题不关、点 chip 插进输入框并关层、按钮开关、Esc、滚 `.content` 收起、滚弹层自己列表不关、无 console 报错），RED→GREEN 走完；回归 `smoke`/`e2e`/`e2e-tagpop`(49 条)/`e2e-filter`/`e2e-router`/`e2e-archive`/`e2e-tagbar`/`e2e-done`/`e2e-dblclick`/`done-smoke` 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，邮件页 `/mail`）**：照 `docs/mail-page-requirements.md` v1.1 做完**只读合并收件箱**——多账号 IMAP 合并列表（每页 50、可一直翻到最早一封）、右侧阅读区（HTML 经 DOMPurify 清洗 + 远程图片默认显示（2026-10-21 决策 D4 前是默认拦截）+ 纯文本切换 + 附件下载）、账号抽屉（增删改 + 试连 + 清本地标记）、本地已读标记（`mail_local_read`，只让本页该行变淡，**绝不回写服务器**）、文件夹切换（收件箱 / 已发送 / 垃圾箱…）、`j`/`k` 键盘切换、搜索与「只看未读」、侧栏第 2 位 + 命令面板入口。改动：新增 `server/mail/client.ts`、`server/mail/store.ts`、`server/routes/mail.ts`、`web/pages/MailPage.tsx`、`web/components/MailReader.tsx`、`web/components/MailAccountDrawer.tsx`、`web/lib/api.ts` 的 `api.mail.*`、`web/styles.css` 的 `.mail-*` 样式；`server/db.ts` 加 `mail_accounts`/`mail_local_read` 两表；`server/index.ts` 挂 `/api/mail` 与退出时 `shutdownMail()`；`web/lib/router.ts` 加 `/mail`。测试：`tests/e2e-mail.mjs` **61 条断言全过**（D4 改版后增至 65 条；自带假 IMAP `tests/fakeimap/server.mjs`：120 封 + 附件 + 追踪像素，覆盖空态/加账号/列表/翻页/正文/拦图/本地已读/筛选/键盘/文件夹/账号增删改/便签页回归/无 console 报错）、`tests/fakeimap/mail-api-smoke.mjs` **50 条 API 断言全过**（含「打开邮件后服务器未读数不变」）；回归 `smoke`/`e2e`/`done-smoke`/`e2e-done`/`e2e-dblclick`/`e2e-filter`/`e2e-archive`/`e2e-tagbar`/`e2e-router`(23)/`e2e-tagpop`(49)/`e2e-tagpop-outside`(14) 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过。**2026-10-21 用户绑了真实 Gmail（you@example.com，应用专用密码）后补测**：22 封一页拉完（`hasMore:false`，uid 1 是 2026-10-03 最早一封，能翻到最早）、文件夹列出 Gmail 的 `[Gmail]/已发邮件` 等 6 个特殊文件夹、正文 HTML 4628 字符 + 纯文本 485 字符、远程图片默认 0 个 `<img src>` 点「显示图片（2）」后放行、未读 11 条高亮 + 8 个未读点（11 减 3 条本地已读）、`j` 键盘选中、刷新仍停 `/mail`、无 console 报错（19 条断言全过）；**关键一条：全程只读之后服务器未读数仍是 11 / 总数 22，没被改写**（D1/FR-22 在真服务器上验证通过）。跨页翻页（`hasMore:true` 的下一页）仍待信箱多于一页时复测。

**已完成（2026-10-21，邮件页自动收信：60 秒轮询，决策 D5）**：用户问「这个邮箱是自动收信吗，还是要点刷新」，听完两种方案（轮询 vs IMAP IDLE）回「好，可以」，选**定时轮询**。改动：`web/pages/MailPage.tsx` 新增轮询 effect——页面可见时每 `POLL_MS`（默认 60 秒，`?poll=毫秒` 可覆盖，夹 1 秒~1 小时）调一次 `fetchList(offsetRef.current, true, true)` + `fetchAccounts(true)`；`document.visibilityState !== 'visible'` 直接 return，`visibilitychange` 回前台立刻补一次；`fetchList` 加第三个参数 `silent`，轮询时不 `setLoading`（不闪「正在取信…」）；`busy` 标志防重入。工具栏新增 `.mail-updated`「数据截至 HH:MM:SS」，值是服务端 `fetchedAt`（`server/mail/client.ts` 的 `ListResult` 新增字段 = `Math.min(...sources.map(s => s.snap.at))`，即这批数据真正从 IMAP 取回的时刻，命中缓存时是缓存时间；路由空态补 `fetchedAt: 0`；`web/lib/api.ts` 的 `MailListResult` 同步加可选字段）。测试：`tests/e2e-mail.mjs` 新增第 13 节 7 条断言（用 `?poll=1500` 缩短间隔、用 imapflow 直接 APPEND 一封「自动刷新测试信」到假 IMAP、断言不点刷新也自己出现 / 自动请求带 `fresh=1` / 「数据截至」时间变了 / 页面隐藏后不再轮询 / 切回前台立刻补拉）→ **72/72 passed**（原 65 条 + 7）；真机 Gmail 用 `?poll=8000` 复测：「数据截至」从 11:04:49 走到 11:05:03、自动发 1 次 `fresh=1`、服务器未读数前后都是 8 / 总数 22、console 0 报错。`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，邮件页 Gmail 直连被墙 → 账号级 SOCKS5 代理，决策 D6）**：用户报「我每次点进来邮件都加载不出来」，排查发现**不是账号密码问题**——`imap.gmail.com` DNS 正常（74.125.23.108/109）但 **:993 TCP 直连 10 秒超时、:443 也不可达**，而 `imap.qq.com:993` / `imap.163.com:993` 都通，即本机直连 Gmail 被墙（早前实测 597ms 可通，网络策略变了）。本机 `v2rayN` + `sing-box` 在跑、SOCKS5 `127.0.0.1:10808` 可用（10809/7890/2080 都不通），**无 TUN 适配器**所以系统级不会自动走代理，`HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 全空 → imapflow 直连必然超时。改动：`server/db.ts` 的 `mail_accounts` 加 `proxy TEXT NOT NULL DEFAULT ''` + 启动迁移（`PRAGMA table_info` 缺列才 `ALTER TABLE`）；`server/mail/store.ts` 加 `normalizeProxy()`（省略协议补 `socks5://`、白名单 `socks/socks5/socks4/socks4a/http/https`、必须 host、不能带路径、端口 1–65535）；`server/mail/client.ts` 用 **imapflow 原生 `proxy` 选项**（`node_modules/imapflow/dist/cjs/proxy-connection.js` 支持 http/https/socks/socks5/socks4/socks4a，依赖里自带 `socks` 2.8.10，**不用加包**），`proxyOf(a)` 账号优先 + `PINBOARD_MAIL_PROXY` 兜底，`sigOf()` 含 proxy（改代理重建连接），`friendlyError(err, proxy?)` 会说明「经代理 socks5://…」；`server/routes/mail.ts` 的 `/accounts/test` 带 id 时复用库里存的代理；`web/components/MailAccountDrawer.tsx` 加「代理（可选）」字段。真机验证（账号 12）：`accounts?counts=1&fresh=1` **3.67 秒**回 `unseen=8 total=22 error=空`、`messages?fresh=1` **1.33 秒**回 22 封、Playwright 22 行列表 + 「数据截至 11:21:02」+ 正文正常渲染 + console 0 报错（截图 `tmp/shot-proxy-mail.png`），账号抽屉回填代理且提示文案正确。测试：`tests/fakeimap/mail-api-smoke.mjs` 新增 8 条代理断言 → **58/58 passed**；`tests/e2e-mail.mjs` 隔离实例 **72/72 passed**；`pnpm typecheck` 0 错误、`pnpm build` 通过。文档：README 邮件段加「代理（Gmail 必备）」、需求文档加 **NFR-10 网络** 与决策 **D6**。

**已完成（2026-10-21，邮件页改版：默认显示图片 + 修排版，决策 D4）**：用户看完真机邮件反馈「我点开邮件全是图片已拦截」「默认显示图片，然后把排版什么的给我修正」，据此反转 FR-20 并重做阅读区渲染。改动：`web/components/MailReader.tsx` 整份重写——**正文进 Shadow DOM**（邮件自带 `<style>`/内联 `style` 全部保留，只在 shadow 内生效，不再污染便签夹）、`buildMailDoc()` 收集并移出 `<style>` 后拼 `BASE_CSS + 邮件CSS`、`scrubCss()` 只去危险片段（`@import`/`expression(`/`javascript:`/`behavior`，`position:fixed|sticky`→`static`）、远程图片**默认加载**（`localStorage['pinboard-mail-images']` 记 `show`/`hide`，默认 show；隐藏时才摘 `src` 到 `data-src` 并出 `.mail-img-banner` 提示条）、不再注入 `alt="图片已拦截"`、新增 `fitWidth()` 用 `doc.style.zoom` 把固定宽度邮件（720px 表格）等比缩进容器（`ResizeObserver` 只在宽度变化时重算，防自激）；`web/styles.css` 删掉穿不透 shadow 的 `.mail-html` 后代死规则、加 `.mail-img-banner`。根因记录：只给 `.mail-doc *` 加 `max-width:100% !important` 没用——表格 used width 取 `max(min-content,…)`，内部 720px 容器把 min-content 顶死，`max-width:100%` 又按 720 的 TD 解析成循环依赖，所以必须 zoom。测试：`tests/e2e-mail.mjs` 图片断言整体改写（用 `.mail-doc` 穿透 shadow 取正文，新增 6 条：默认直接加载 / 有「隐藏图片」/ 隐藏后 `img[data-blocked]` 无 src 但留 `data-src` / 出现提示条 / 点「显示图片」恢复加载且提示条消失）→ **65/65 passed**；`tests/fakeimap/mail-api-smoke.mjs` 50/50 passed；真机 Gmail 前 8 封逐封量：`overflowing: 0`、`brokenImgs: 0`（zoom 0.889~0.93），图片 17/17、14/14、24/24、15/15 全部加载成功、`styleTags:1`、表格数 52~151（排版回来了）；回归 smoke/e2e/done-smoke/e2e-done/e2e-dblclick/e2e-filter/e2e-archive/e2e-router(23)/e2e-tagpop(49)/e2e-tagpop-outside(14) 全绿（`e2e-tagbar` 与 `e2e-monitor-note` 原硬编码期望值随资产/观测项变化过期，已改成从 API 取期望值）；`pnpm typecheck` 0 错误、`pnpm build` 通过。

**已完成（2026-10-21，观测项详情抽屉）**：用户要求「点观测项卡片右边弹出详情，像资产详情那样，能改名字/介绍/频率，还要暂停、删除、立即观测」。设计依据 `docs/superpowers/specs/2026-10-21-monitor-drawer-design.md`（已提交 6f67b9d），分三段 RED→GREEN 做完：

① **只读详情**：`GET /api/monitors/:id` 返回脱敏后的 monitor + 最近 24h 心跳（最多 40 条）+ 立即观测配方 + 跳转链接；卡片与表格行可点开抽屉。

② **写能力**：`PATCH`（名字/介绍/频率/超时重试，**写回 Kuma**——Kuma 是唯一事实源）、`POST /:id/pause|resume`、`DELETE /:id?confirm=<名字>`（名字必须原样输对；删前先备份 `kuma/data/kuma.db` 到 `kuma/backups/` 留最近 5 份，再连同历史心跳真删）。改名额外做**策略引用检查**：扫所有观测项的 `policy_json`，有谁按 `monitorStatus.name` 引用了旧名字就 409 拒绝，避免策略静默失效。

③ **立即观测**：`POST /:id/check` 按配方顺序执行，逐步骤回显 `{type,label,ok,detail,ms}`；配方在根目录 `monitor-actions.json`（热读、可 git），步骤类型 `kuma-check` / `http` / `command`，默认非推送型 = `[{type:'kuma-check'}]`（`resumeMonitor` → Kuma 立刻真探一次），推送型没配方就置灰。

配套：`monitor-links.json` 12 条规则**从按 name 改成按 id**（名字现在能改，id 才稳定），`pickLink()` id 优先、name 兜底。测试：`tests/e2e-monitor-drawer.mjs` **88 条断言全过**（详情脱敏 / PATCH 各校验 400 / 415 挡跨站 / 暂停恢复 / 策略名字引用 409 / 删除名字不符 400 / UI 改名保存 / 删除二次确认 / 立即观测逐步骤回显 / 无 console 报错）；回归 smoke / e2e / done-smoke / e2e-done / e2e-dblclick / e2e-filter / e2e-archive / e2e-tagbar / e2e-router / e2e-tagpop / e2e-tagpop-outside / e2e-monitor-note 全绿（`e2e-mail` 要按坑 16 用隔离实例跑，72/72）；`pnpm typecheck` 0 错误、`pnpm build` 通过；截图 `docs/screenshots/monitor-drawer.png` 与 `monitor-drawer-delete.png`。

**已完成（2026-10-21，观测异常通知）**：用户要求「观测出问题就在右上角弹个窗，默认不关闭；下一次观测正常自动关闭，或者点通知关闭并跳到页面对应卡片」。纯前端实现，**没动服务端、没加表、没加依赖**。判定 = `active !== false` 且 `isDown(m)`（`status === 0` 或 `msg` 以 `[红]` 开头）；App 层每 30 秒 `GET /api/monitors`（**不带 `fresh=1`**，走后端 5 秒缓存，见坑 9）。生命周期：首轮只当基线（打开页面时已经红的项不弹）→ 之后新变红的入栈 → 从故障集合消失的自动移除（= 恢复自动关闭）；`stale: true` 的响应整轮跳过（既不弹也不关，见坑 28）；点 × 记入 `dismissed`，恢复前不再弹、恢复后清标记。UI 是 `web/components/AlertStack.tsx`（`position: fixed` 右上角，最多 4 条 + 「还有 N 条异常 · 查看全部」，深色主题走现有令牌）。点通知 = 关掉这条 + `setPage('monitors')` + `focusMonitorId`，MonitorsPage 按 `id="monitor-<id>"` 找卡片、`scrollIntoView` 滚进视口、加 `.flash` 高亮 1.6 秒。测试：`tests/e2e-alert.mjs` **32 条断言全过**（`page.route` 伪造 payload + `page.clock` 快进 30 秒，**不需要真 Kuma**：基线不弹 / 变红弹 1 条 / 位置在右上且完整可见 / 短名 + 组名 + 故障信息 / 不自动关 / 恢复自动关 / 恢复后再坏又弹 / 点 × 关闭且恢复前不再弹 / 6 项只显示 4 条 + 还有 2 条 / 点通知跳转 + 高亮 + 同时关掉这条 / stale 不弹不关 / 暂停·待定·维护·黄·灰都不弹 / 无 console 报错）；回归 smoke / e2e / e2e-router(23) / e2e-alert 全绿，`pnpm typecheck` 0 错误、`pnpm build` 通过；截图 `docs/screenshots/monitor-alert.png`、`monitor-alert-jump.png`、`monitor-alert-dark.png`。

**已完成（2026-10-21，工程整理：测试归位 + 服务端/前端拆分，不改行为）**：用户要求「整理或重构当前便签夹项目，它由多个项目混合而成，用同一个前端」。方案定为**只整理不改行为**，四阶段落地：

① **测试归位**：`tmp/` 里 16 个冒烟/e2e/单测文件 `git mv` 到 `tests/`，新增 `tests/run.mjs`（串行 runner，三组 core/monitor/mail，`--only=` 选组，起跑前 `/api/health` 预检，给子进程注入 `ALERT_E2E_BASE`）+ `tests/README.md`；`package.json` 加 `test` / `test:e2e` / `test:mail`。

② **服务端归位**：`routes/monitors.ts`(614 行) → `server/kuma/routes.ts` + `feed.ts`（抓取缓存）+ `links.ts` + `backup.ts`；`kuma.ts` → `server/kuma/client.ts`；`monitor-actions.ts` → `server/kuma/actions.ts`；`routes/mail.ts` → `server/mail/routes.ts`；建表 SQL 拆到 `server/schema/core.ts` / `mail.ts`；`index.ts` 的杂项接口搬到 `routes/meta.ts`、静态托管搬到 `static.ts`，`index.ts` 从 239 行瘦到 62 行。

③ **前端归位**：`web/lib/api.ts`(233 行) → `web/lib/api/`（http/types/notes/assets/monitors/mail/core）+ `web/lib/cx.ts`，`api.ts` 保留门面再导出，**所有页面 import 零改动**；`web/styles.css`(786 行) → `web/styles/` 12 个分片 + `index.css` 按序 `@import`，`main.tsx` 改 import `./styles/index.css`。

④ **清理**：一次性探针（`dbg/dbg2/inspect/probe-*/verify-domain-link`）与生成物（`tmp/*.png`、e2e payload、旧日志）删除；截图脚本进 `tools/screenshots/`（附 README，注明须在项目根运行）、`seed-assets.mjs` 进 `tools/`；README / AGENTS / adding-assets / 设计文档里的旧路径同步更新。

⑤ **单测护栏（2026-10-21 追加）**：把埋在 `db.ts`/`store.ts`/`client.ts`/`feed.ts`/`meta.ts` 里的纯函数拆成 `server/tags.ts`、`server/dates.ts`、`server/mail/proxy.ts`、`server/kuma/redact.ts`、`server/kuma/beat.ts`、`web/lib/paths.ts`（原模块再导出，调用点零改动），用 Node 自带 `node:test` 补 `tests/unit/*.test.mts`（**57 条，秒级**），加 `pnpm test:unit` 并进 `pnpm test`；`tsconfig` 的 include 加 `tests/unit`，测试文件也走 typecheck。

验证：`pnpm typecheck` 0 错误、`pnpm build` 通过（CSS/JS 哈希与拆分前一致）、`pnpm test` 57 + 7 全过、`pnpm test:e2e --only=core` 全绿、`/api/*` 11 个端点逐个 200。顺手修了 `e2e-monitor-drawer` 的备份断言——备份目录只留 5 份，满 5 份后数量不再增加，改成比对「最新一份是否换人」。

## 2026-10-21 补充：邮件后端拆分

⑥ **邮件后端拆分**：`server/mail/client.ts`（570 行、30+ 函数，是服务端最胖的文件）按职责拆成 `types.ts`（数据模型）/ `parse.ts`（摘要解析，**纯函数**）/ `errors.ts`（错误翻译 + 代理提示）/ `pool.ts`（IMAP 连接池 + 只读锁 `withMailbox`）/ `client.ts`（多账号归并、正文缓存、文件夹、未读数）；`client.ts` 末尾再导出 `dropConnection`/`dropAllConnections`/`friendlyError`/`proxyOf`/`snippetFromText` 与全部类型，所以 `routes.ts` 的 import 零改动。

验证：`pnpm typecheck` 0 错误；新增 `tests/unit/mail-parse.test.mts`（13 条：quoted-printable / base64 / html 剥标签 / `[image:]` 占位符 / 零宽字符 / 240 字上限 / 地址与时间归一），单测总数 57 → **70**，`pnpm test:unit` 70/70；隔离实例（`PORT=7799` + `PINBOARD_DATA=tests\e2e-data`）跑 `MAIL_E2E_BASE=… node tests/run.mjs --only=mail` → **2/2 套件、e2e-mail 58/58**；主实例 `--only=core` → **11/11**；重启后 `/api/health`、`/api/mail/status`（marked 11 / accounts 1）、`/api/monitors`、`/api/stats` 全 200。

## 2026-10-21 补充：邮件前端拆分

⑦ **邮件前端拆分**：`web/pages/MailPage.tsx`（407 行，20+ 个 useState 全挤在一个组件里）拆成 `web/pages/mail/` 三件 —— `useInbox.ts`（账号 / 文件夹 / 当前页邮件 / 轮询刷新 / 筛选 / 选中与 `j`·`k` 导航，`PAGE=50` 与 `POLL_MS` 一并搬入）、`MailList.tsx`（`MailRowItem` 行 + 空态 + 分页条，`rowTime`/`senderName` 同文件）、`MailToolbar.tsx`（账号 chips + 文件夹下拉 + 「数据截至」+ 刷新 + 邮箱管理 + 搜索 + 只看未读）；`MailPage.tsx` 只剩组合与无账号空态。**e2e 依赖的 `.mail-row` / `.mail-pager` / `.mail-search` / `.mail-page-empty` 类名与文案一个都没动。**

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB，说明样式零改动）；隔离实例跑 mail 套件 **2/2、e2e-mail 58/58**；主实例 core 套件 **11/11（81s）**。`docs/architecture.md` 补 `web/pages/mail/` 分工，`AGENTS.md` 页面行同步。

## 2026-10-21 补充：观测页拆分

⑧ **观测页拆分**：`web/pages/MonitorsPage.tsx`（367 行：数据拉取 + 30 秒轮询 + 筛选 + 统计条 + 卡片/表格两套渲染 + 抽屉全挤在一起）拆成 `web/pages/monitors/` 六件 —— `useMonitors.ts`（拉取与 `load(force)`、30 秒轮询、分组/状态/关键词筛选、异常通知跳转后的定位高亮；**抽屉开着时停轮询**、**轮询必须走缓存只有手动刷新才 `force`** 这两条约束随代码搬了过去）、`MonitorStats.tsx`（四格统计）、`MonitorFilters.tsx`（分组 chips + 状态下拉 + 搜索 + 自动刷新 + 视图切换 + 手动刷新）、`MonitorCard.tsx`（卡片视图，`id="monitor-<id>"` 是异常通知跳转锚点）、`MonitorTable.tsx`（表格视图）、`status.ts`（`tone()` 四色判定 / `pct()` / `typeLabel()`，**纯函数**）；`MonitorsPage.tsx` 只剩组合与三种空态（读不到 / 没有匹配 / 加载中）。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）；新增 `tests/unit/monitors-status.test.mts`（9 条：四色前缀优先于状态码、前缀必须在开头、未知状态码回 null、`pct()` 的 99.95% 取整、类型名映射），单测 70 → **79**；monitor 套件 **3/3（55s）**、core 套件 **11/11（82s）** —— e2e-alert 的 E2/E3/E4（点通知跳转并高亮对应卡片、长列表滚进视口）全过，说明卡片锚点没拆坏。

## 2026-10-21 补充：资产页拆分

⑨ **资产页拆分**：`web/pages/AssetsPage.tsx`（264 行：统计条 + 两排筛选 + 卡片/表格 + 抽屉）拆成 `web/pages/assets/` 六件 —— `useAssets.ts`（拉取 + 搜索防抖 220ms + 标签栏统计 + 保存后重拉）、`AssetStats.tsx`（四格统计）、`AssetFilters.tsx`（类型 chips + 状态下拉 + 搜索 + 视图切换 + 登记按钮）、`AssetTagBar.tsx`（标签栏）、`AssetCard.tsx`（卡片视图）、`AssetTable.tsx`（表格视图）、`meta.ts`（`usedTagsOf()` 排序规则 / `cardMeta()` 中间几行取值，**纯函数**）；`AssetsPage.tsx` 只剩组合与空态。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）；新增 `tests/unit/assets-meta.test.mts`（10 条：标签栏只留有关联的、数量降序、同数按中文名称升序、不改原数组；卡片取值顺序、空值不占行、自定义字段最多 2 个、有 label 用 label、数字转字符串），单测 79 → **89**；core 套件 **11/11（80s）**、monitor 套件 **3/3（53s）** —— 依赖资产 UI 的 e2e（`e2e.mjs` 的登记/表格视图、`e2e-tagbar.mjs` 的 `.tag-bar` 筛选、`e2e-monitor-note.mjs` 的 `.asset-name`）全过。

## 2026-10-21 补充：两个编辑抽屉拆分

⑩ **编辑抽屉拆分**：`web/components/MonitorDrawer.tsx`（458 行）与 `web/components/AssetDrawer.tsx`（376 行）各自拆成「容器 + 分段」——
- 观测项：容器只留状态 / effect / 五个接口调用，界面切成 `web/components/monitor-drawer/` 五段（`NowSection` 顶部状态条、`BasicSection` 基本信息与频率 chip、`AdvancedSection` 折叠的超时与重试、`RunSection` 立即观测与逐步回显、`DangerSection` 暂停恢复与二次确认删除），纯逻辑进 `form.ts`（`toForm`/`sameForm`/`buildPatch`/`validateForm`）与 `display.ts`（`STATUS`/`TONE`/`TYPE_LABEL`/`toneOf`）。
- 资产：`web/components/asset-drawer/` 的 `BasicFields.tsx`（基本信息 + 标签 + 自定义字段 + 备注预览）、`LinkedNotes.tsx`（关联便签 / 就地记一条 / 时间与参考价）、`CustomFields.tsx`、`form.ts`（`blank`/`toForm`/`parseTags`/`buildPayload`）。
- e2e 依赖的类名与文案一个没动：`.monitor-drawer-run`、`.monitor-drawer-now`、`.monitor-drawer-result(.ok)`、`.monitor-drawer-confirm`、`input[name=name|interval|description|confirmName]`、「立即观测」「删除观测」「确认删除」；资产侧的 `.note-list`、`.composer`、原生 `confirm()` 删除。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB，说明样式零改动）；新增 `tests/unit/monitor-drawer-form.test.mts`（15 条）与 `tests/unit/asset-drawer-form.test.mts`（8 条），单测 89 → **112/112**；core 套件 **11/11（85s）**、monitor 套件 **3/3（55s，e2e-monitor-drawer 88 条全过）**。

顺手修的两处：
- `tests/e2e-monitor-drawer.mjs` 里两处「打开抽屉后固定等 600/700ms 再数元素」的竞态（详情接口要问 Kuma，慢起来 1s+）——改成先 `waitFor` 目标元素再断言，不放松任何条件。
- `tests/unit/assets-meta.test.mts` 的 `tag()` helper 原来返回 `never`，导致 `input.map(t => t.name)` 在 `tsc --noEmit` 下报 `TS2339: Property 'name' does not exist on type 'never'`（此前只跑过 `test:unit`，没跑 typecheck）；改成返回 `Tag` 后两条测试文件一起纳入类型检查。

## 2026-10-21 补充：邮件页两个组件拆分

⑪ **邮件阅读区与邮箱账号抽屉拆分**：`web/components/MailReader.tsx`（362 行）与 `web/components/MailAccountDrawer.tsx`（306 行）都改成「容器 + 部件」——
- 阅读区：容器只留取信、`mode`、图片开关、Shadow DOM 挂载与 `ResizeObserver`；部件在 `web/components/mail-reader/` —— `MailMeta.tsx`（主题 + 五条元信息）、`MailViewbar.tsx`（HTML/纯文本切换 + 隐藏/显示图片）、`MailAttachments.tsx`（附件清单）、`text.ts`（`addrText`/`addrList`/`bytes`）、`css.ts`（`scrubCss`）、`doc.ts`（`BASE_CSS`/`buildMailDoc`/`fitWidth`/图片开关的 localStorage 读写）。
- 账号抽屉：容器只留列表↔表单切换与四个接口调用；部件在 `web/components/mail-account/` —— `AccountForm.tsx`（常用邮箱 chip + 九个字段 + 提示）、`AccountList.tsx`（账号行 + 二次确认删除）、`form.ts`（`blankForm`/`toForm`/`applyPreset`/`buildBody`/`canTest`/`hintsFor`/`securityLabel`）。
- e2e 依赖的类名一个没动：`.mail-reader-subject`、`.mail-reader-meta`、`.mail-html`、`.mail-text`、`.mail-seg-btn`、`.mail-img-banner`、`.mail-attach-item`、`.mail-attach-name`、`.drawer .mail-form`、`.mail-form-grid input|select`、`.mail-msg`、`.drawer .mail-acc-item`（删除仍是「点垃圾桶 → 确认删除」两步）。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）；新增 `tests/unit/mail-reader-text.test.mts`（7 条）、`tests/unit/mail-scrub-css.test.mts`（7 条）、`tests/unit/mail-account-form.test.mts`（13 条），单测 112 → **139/139**；core 11/11、monitor 3/3、mail 2/2（隔离实例 7799）。

## 2026-10-21 补充：快照生成拆分

⑫ **快照生成拆分**：`server/snapshot.ts`（298 行）把四件事挤在一起（查库、拼 Markdown、写文件、防抖调度），拆成 `server/snapshot/` 三件 ——
- `rows.ts`：四类行与查询（`loadAssets`/`loadNotes`/`loadTags`/`loadFields`/`loadLastChange`，`tags` 用 `group_concat(t.name,'、')` 子查询拼）。
- `markdown.ts`：`renderSnapshot(data)` 与零件 `fmt/cell/indent/parseCustom/countBy`，**纯函数**（只 `import type` 自 rows.ts，运行时碰不到数据库），`now` 可注入以便固定输出。
- `write.ts`：`buildSnapshot()` / `writeSnapshot()` / `scheduleSnapshot(1500)`（防抖 + `unref` + `running/dirty` 合并）。
- `server/snapshot.ts` 只剩门面 + 入口：re-export 三件，并在**直接执行**（`pnpm snapshot`）时立即生成一次；`server/index.ts` 的 import 零改动。

**顺手修了一个真 bug**：隔离实例（`PINBOARD_DATA=tests\e2e-data` + `PORT=7799` 跑邮件 e2e）只隔离了数据库，启动时 `writeSnapshot()` 拿空库生成 1 KB 的 `SNAPSHOT.md`，把真库那份 40 KB 覆盖掉了（2026-10-21 踩过，`pnpm snapshot` 补回）。护栏在 `write.ts`：`const ISOLATED = DATA_DIR !== join(ROOT, 'data')`，隔离实例直接跳过写入；正式实例不设该变量，所以正式快照不受影响。已记为坑 30。

验证：`pnpm typecheck` 0 错误；**新旧实现输出逐行一致**（从 `git show HEAD:server/snapshot.ts` 取出旧实现跑一遍，与新版生成的 SNAPSHOT.md 比 700 行，除「生成时间」外完全相同）；新增 `tests/unit/snapshot-markdown.test.mts`（13 条：空库四处「暂无」、概览计数、中文类型/状态、custom 里的 ip 进表格、自定义字段中文 label、备注多行缩进、便签标记与关联资产、标签/字段表、坏 options 不抛错、不传 now 也能出时间），单测 139 → **152/152**；`pnpm test` 全过；重启后 `/api/health`、`/api/stats`、`/api/notes`、`/api/monitors` 全 200。

## 2026-10-21 补充：观测台 PATCH 校验拆出来

⑬ **观测台 PATCH 校验拆分**：`server/kuma/routes.ts`（289 行）里一半是 HTTP 胶水、一半是「名字 1–120 / 重名 / 策略按名字引用 /
频率 20–86400 / 超时 1–120 且小于频率 / 重试 1–3600 与 0–10 / showMsg 只认 true 与 1 / accepted_statuscodes 归一」这些规则，
埋在路由里一个都测不到。拆成：
- `server/kuma/patch.ts`（纯函数）：`buildMonitorPatch(body, bean, beans)` 按原顺序逐项校验（文案与状态码逐字照搬）、`normalizeForKuma()`、`policyNameRefs()`、`asInt()`。返回的 `next` 可能没有 `showMsg`（Kuma 的 `toJSON()` 不返回它），由路由补。
- `server/kuma/http.ts`（纯函数）：`isJsonContentType(ct)`、`kumaErrorStatus(e)`（404 / 502 判定）。
- `routes.ts` 289 → **190 行**：只剩取数、补 `showMsg`（新助手 `showMsgFromPage(id)`）、写回 Kuma、拼响应。

验证：`pnpm typecheck` 0 错误；新增 `tests/unit/kuma-patch.test.mts`（19 条：asInt 边界、名字空/超长/重名、改回自己不算重名、
策略引用旧名 409 与引用别人不拦、介绍 trim 与 500 边界、频率/超时/重试四组边界、超时必须小于频率（只改名也校验）、
showMsg 的 true/1/其他、`accepted_statuscodes` 转字符串与空值回 `['200-299']`、`conditions` 与 `policyJson` 三种归一化、
`policy_json` 下划线也认、`policyNameRefs` 字符串/对象/坏 JSON、`isJsonContentType`、`kumaErrorStatus`），单测 152 → **171/171**；
`pnpm test` 全过；重启后端点全 200；monitor e2e 3/3（e2e-monitor-drawer 88 条全过，含策略按名字引用拒绝改名、删除确认、415）、core 11/11。

## 2026-10-21 补充：「立即观测」配方拆分

⑭ **配方纯逻辑拆分**：`server/kuma/actions.ts`（253 行）一半是「读 `monitor-actions.json` + 挑配方」、一半是
kuma-check / http / command 三种步骤的执行器，挑配方的规则（id 优先于名字、置灰原因、每步超时）一条都测不到。拆成：
- `server/kuma/recipe.ts`（纯函数）：`parseRules()`（顶层数组与 `{recipes:[…]}` 都认，坏配置当没配方）、`normalizeSteps()`、
  `resolveFromRules()`（先 `id` 再 `name`；置灰三档：配方自带 `disabledReason` → 不认识的步骤类型 → 没有步骤；没配方时非推送型默认 `kuma-check`、推送型置灰）、
  `timeoutOf()`、`clip()`、`statusText()`。
- `server/kuma/runner.ts`：三种步骤的执行器 + `runRecipe()`（顺序跑、失败即中止、整体 60 秒上限），逻辑一行没改。
- `server/kuma/actions.ts` 只剩 30 行门面：`ACTIONS_FILE` + `loadRules()`（每次请求热读）+ `resolveAction()`，再导出 `runRecipe` 与类型，**`routes.ts` 的 import 零改动**。

验证：`pnpm typecheck` 0 错误；新增 `tests/unit/kuma-recipe.test.mts`（22 条：配置两种写法与坏结构、步骤归一与未知类型、
id 优先于名字、配方自带置灰原因、空配方、推送型没配方、每步超时按类型取默认与边界夹取、`clip`/`statusText`），单测 171 → **193/193**；
`pnpm test` 全过；重启（pid 21096，1.2s）后端点全 200；monitor e2e **3/3（54s，含立即观测的 http / command / kuma-check 三种步骤与热读配方）**、core **11/11（79s）**。
文档：`docs/architecture.md` 的 `actions.ts` 条目拆成 recipe / runner / actions 三条，`README.md` 的目录树按当前结构重写（server/ 与 web/ 子目录、tests/、tools/）。

## 2026-10-21 补充：邮件路由参数拆分

⑮ **邮件路由参数拆分**：`server/mail/routes.ts`（208 行）里一半是「取账号 → 调 client → 拼响应」的胶水，一半是
limit 夹取、附件三参数、`Content-Disposition` 拼装、测试连接补空字段、本地已读三档清理这类规则，埋在路由里测不到。拆成：
- `server/mail/params.ts`（纯函数）：`parseListQuery()`（limit 夹 1–100、offset 不为负、空白 folder 回 INBOX）、`pickTargets()`、
  `decorateItems()`（补账号标签/邮箱 + 本地已读）、`mergeAccountCounts()`（取不到计数给 null，前端显示「—」）、`posInt()`、
  `parseAttachmentQuery()`、`attachmentHeaders()`（filename 只留 ASCII、中文走 `filename*=UTF-8''`）、
  `testInputFrom()`/`fillTestInput()`/`missingTestField()`、`parseMarkBody()`、`parseClearQuery()`。
- `server/mail/routes.ts` 208 → **159 行**：只剩端点、取账号、调 client、拼响应；`shutdownMail()` 仍在末尾。

验证：`pnpm typecheck` 0 错误；新增 `tests/unit/mail-params.test.mts`（17 条），单测 193 → **210/210**；
`pnpm test` 全过；重启（pid 66396，1.1s）后 `/api/health`、`/api/mail/status`（`{"marked":11,"accounts":1}`）、`/api/mail/accounts`、`/api/stats` 全 200；
隔离实例（`PORT=7799` + `tests/e2e-data`）跑邮件 e2e **2/2、e2e-mail 58/58（25s）**，含附件下载头、本地已读不改服务器 unseen=96、编辑账号保留密码。
一处**测试假设错、代码对**：`parseListQuery({limit:'abc'}).limit` 是 NaN（`Math.max/min` 不纠正 NaN，原实现同样如此），断言改成实测行为并注明。

## 2026-10-21 补充：设置页拆分

⑯ **设置页拆分**：`web/pages/SettingsPage.tsx`（214 行）把外观、自定义字段、标签管理、导出/灌数据四块和它们的表单状态全塞在一个组件里。拆成：
- `web/pages/settings/useSettings.ts`：字段/标签表单状态 + `addField`/`removeField`/`addTag`/`removeTag`/`exportData`/`seed`，导出 `SettingsState`。
- `web/pages/settings/fields.ts`（**纯函数，有单测**）：`FIELD_TYPES`、`fieldTypeLabel()`（未知类型原样显示，别悄悄变「文本」）、
  `parseFieldOptions()`（中英文逗号都认）、`validateNewField()`、`exportFilename()`、`normalizeTagName()`、两条删除确认文案。
- 四张卡片：`AppearanceCard.tsx`（三档主题 chip）、`FieldsCard.tsx`（字段表 + 新建表单）、`TagsCard.tsx`（标签 chip + 新增）、
  `DataCard.tsx`（导出 JSON / 空库灌示例）；`SettingsPage.tsx` 只剩组合层（四张卡片按原顺序摆）。
- **e2e 依赖的东西一个没动**：`input[placeholder="新标签名"]`、按钮文案「添加」/「添加字段」/「导出 JSON」/「写入示例数据」、
  卡片顺序（`e2e.mjs` 用 `text=添加 >> nth=-1` 取最后一个「添加」，顺序变了会点错卡片）、`.tag` 文案。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）；新增 `tests/unit/settings-fields.test.mts`（7 条），单测 210 → **217/217**；
core e2e **11/11**（设置页新增标签那一步照常通过）。

## 2026-10-21 补充：应用外壳拆分

⑰ **应用外壳拆分**：`web/App.tsx`（201 行）把外壳状态（页面、tags/fields/stats/观测汇总/邮件汇总、ready/error、主题、
命令面板、异常通知跳转）和侧栏/顶栏的 JSX 全挤在一起。拆成 `web/app/` 四件：
- `useShell.ts`：全部外壳状态与三个 effect（`refreshMeta()`、主题写入 `<html data-theme>` 并监听 `prefers-color-scheme`、
  Ctrl/⌘+K 开合命令面板）+ `openAsset()` / `openMonitor()`（点异常通知：关通知 + 切观测台 + 定位 id）+ `useMonitorAlerts()`。
- `Sidebar.tsx` / `Topbar.tsx`：纯展示；e2e 依赖的 `.nav-item` / `.nav-label` / `.nav-badge` / `.topbar-title` / `.topbar-sub` 结构一个字没动。
- `titles.ts`（**纯函数，有单测**）：`pageTitle()`、`pageSubtitle()`——拿不到汇总数据时给静态说明（**不显示 0**），观测页四段按需拼接。
- `App.tsx` 只剩组合层：`const s = useShell()` → `Sidebar` + `Topbar` + 按 `s.page` 选页面 + `AlertStack` + `CommandPalette`。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）；
新增 `tests/unit/app-titles.test.mts`（6 条），单测 217 → **223/223**；core e2e **11/11（80s，含 e2e-router 的前进后退与深链）**。

