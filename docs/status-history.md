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

## 2026-10-21 补充：观测台取数拆分

⑱ **观测台取数拆分**：`server/kuma/feed.ts`（224 行）把「Kuma 状态页/心跳的取数与两层缓存」「列表拼装」「5 秒列表缓存」
「`groupOf`」「启动预热」挤在一个文件里，其中拼装逻辑（状态取哪一拍、`beats` 怎么截、`active/interval` 怎么补、
`uptime24` 怎么汇总）一条都测不到。拆成三件，`routes.ts` 的 import 零改动：
- `server/kuma/payload.ts`（**纯函数，有单测**）：`buildPayload({statusPage, heartbeats, beans, links, base, slug, beatWindow, now})`
  → `{kuma, updatedAt, summary, groups}`，外加 `groupNameIn()`。不碰网络与缓存，`now` 可注入。
- `server/kuma/source.ts`：`KUMA_BASE`/`KUMA_SLUG`、状态页清单（5 分钟 TTL + 启动预热 + 到期续一次，失败沿用旧值）、
  心跳（5 秒）、`invalidateSource()`（清两层缓存并让接下来 15 秒带 `x-apicache-bypass:1`）、`lastStatusPage()`。
- `server/kuma/feed.ts` 224 → **62 行**：只做编排（并行拉三份数据交给 `buildPayload`）、5 秒列表缓存、`lastPayload()`、
  `invalidate()`、`groupOf()`，并把拆出去的东西再导出。

验证：`pnpm typecheck` 0 错误；新增 `tests/unit/kuma-payload.test.mts`（15 条），单测 223 → **238/238**；
重启后 `/api/monitors` 仍是 19 项（up 18 / down 1、5 组、uptime24 0.9779）、`/api/monitors/1` 仍带 40 拍与 1 步配方、
`/api/stats` notes 3 / assets 17 与拆分前一致；monitor e2e **3/3（54s，e2e-monitor-drawer 88 passed）**、core e2e **11/11（80s）**。

## 2026-10-21 补充：邮件后端第二轮拆分

⑲ **邮件后端第二轮拆分**：`server/mail/client.ts`（246 行）里还挤着四层缓存与列表行的拼装/排序，
其中「无主题怎么兜、没 `\\Seen` 算不算未读、多账号归并怎么排、文件夹怎么排」这些口径一条都测不到。拆出两件：
- `server/mail/rows.ts`（**纯函数，有单测**）：`toRow()`、`rowTime()`、`compareRows()`（时间倒序 → uid 倒序 → 账号正序）、
  `filterSelectable()`（丢掉 `\\Noselect`）、`sortFolders()`（INBOX 第一 → special-use → 中文按拼音）。
- `server/mail/cache.ts`：`LIST_TTL`/`BODY_TTL`/`FOLDER_TTL`/`BODY_CACHE_MAX` 四个常量、四个 Map、
  `snapKey()`、`clearAccountCaches()`、`pruneBodyCache()`。
- `client.ts` 只剩 IMAP 操作（`testConnection`/`listFolders`/`getSnapshot`/`getChunk`/`listMessages`/`unseenCounts`/`getMessage`），
  并继续再导出 `clearAccountCaches` 与类型，`routes.ts` 的 import 零改动。

验证：`pnpm typecheck` 0 错误；新增 `tests/unit/mail-rows.test.mts`（9 条），单测 238 → **247/247**；
重启后 `/api/health`、`/api/mail/status`（marked 11 / accounts 1）、`/api/mail/accounts`、`/api/stats`、`/api/monitors` 全 200；
隔离实例（`PORT=7799` + `PINBOARD_DATA=tests\e2e-data`）mail e2e **2/2（25s，72/72 + 58/58）**、core e2e **11/11（91s）**。

## 2026-10-21 补充：观测项抽屉抽出状态 hook

⑳ **观测项抽屉抽出状态 hook**：`web/components/MonitorDrawer.tsx`（201 行）此前把 16 个 useState、详情 effect、
保存/暂停恢复/删除/立即观测四个接口调用全放在组件里，组件文件里既看不清界面也测不到判断。
- 新建 `web/components/monitor-drawer/useMonitorDetail.ts`：`useMonitorDetail({id, onClose, onChanged})` 搬走全部状态、
  详情 effect（切 id 时清空保存/删除/立即观测的回显）、`save`（只发 `buildPatch` 的改动字段）、`toggleActive`、
  `remove`、`runNow`，并返回 `m`/`action`/`canSave`/`runDisabled`/`confirmOk`；导出 `type MonitorDetailState`。
- `form.ts` 新增三条**纯函数**（都能单测）：`canSaveForm(form, base, saving)`（有改动 + 三项校验全过 + 不在保存中，
  没有基准时一律 false）、`runDisabledOf(action, m, running)`（没配方 / 配方置灰 / 正在跑 / 已暂停 / 详情没到 都不能点）、
  `confirmMatches(m, confirmName)`（去首尾空白后必须完全一样）。
- `MonitorDrawer.tsx` 只剩组合层：`const d = useMonitorDetail({...})` + `FormDrawer` 外壳 + 五段（Now/Basic/Advanced/Run/Danger）。
  **界面结构、类名、文案一个没动**（e2e-monitor-drawer 依赖 `button` 文本「保存」、「删除观测」/「确认删除」、`.monitor-drawer-confirm`）。

验证：`pnpm typecheck` 0 错误；`tests/unit/monitor-drawer-form.test.mts` 15 → 19 条，单测 247 → **251/251**；
`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）、JS `index-4cmWmmsU.js` 415.66 kB；
monitor e2e **3/3（63s，e2e-monitor-drawer 88 passed 0 failed）**、core e2e **11/11（80s）**。

## 2026-10-21 补充：命令面板的行拼装抽成纯模块

㉑ **命令面板的行拼装抽成纯模块**：`web/components/CommandPalette.tsx`（155 行）里，结果行的文案拼装、
键盘上下移动的下标、「命令/结果」标题与「没有找到「x」」空态都写在组件里，测不到。
- 新建 `web/components/command-palette/items.ts`（**纯函数**）：`NOTE_LABEL_MAX = 70`、`noteLabel(content)`
  （连续空白压成一个空格再截断）、`noteSub(tags)`（有标签列 `#标签`，没有写「便签」）、`assetSub(a)`
  （`KIND_META[kind].label` + 可选「 · 位置」）、`moveSel(sel, delta, length)`、`paletteHint(term, loading, count)`
  → `{group, empty}`。
- `CommandPalette.tsx` 只用这些函数，JSX / 三个 effect（重置、170ms 防抖搜索、键盘）原样不动。
- 两处**实测行为、别改成猜的**：① 长度 0 时按 ↓ 会得到 -1（原实现 `Math.min(-1, s+1)`，下一轮 `items.length`
  变化会把 sel 重置回 0）；② 不认识的资产类型让 `assetSub` 回字符串 `'undefined'`（`KIND_META[kind]?.label` 拼空串）。
- 新增 `tests/unit/command-palette-items.test.mts`（8 条），单测 251 → **259/259**。

验证：`pnpm typecheck` 0 错误；`pnpm build` 通过且 **CSS 产物哈希未变**（`index-BslNVajD.css` 37.28 kB）、
JS `index-Cya2EhMt.js` 415.91 kB；core e2e **11/11（80s）**（含 `e2e.mjs` 的命令面板搜索、`e2e-archive` 的 Ctrl+K 不返回归档便签、
`e2e-mail` 的「邮件」入口）。

## 2026-10-22：心跳色条悬停看「这一拍」

㉒ **观测台心跳色条支持逐拍悬停**（用户需求）：原来 40 段色条只有整条原生 `title`「最近 N 次心跳」，
鼠标移上去根本看不出某一段是哪次探测。现在移到任意一段就弹出这一拍的时间（`MM-DD HH:mm:ss`）、状态、
相对时间、响应毫秒、「第 i/N 拍」与心跳消息。
- **数据从列表接口直出**，不新开接口、不做悬停时懒加载（用户要「瞬时」）：`server/kuma/payload.ts` 的
  `buildPayload` 给每个观测项加 `beatTimes`（`toIso`）/ `beatMsgs`（新增 `clipMsg`：去首尾空白，
  超 `BEAT_MSG_MAX = 400` 字截断加 `…`）/ `beatPings`，三条与 `beats` 严格等长，末拍时间 == 卡片「检查」那一行。
- 前端 `web/components/BeatStrip.tsx` 加可选 `details`：整条按 `clientX` 反推第几拍（比 40 个 `onMouseEnter` 稳，
  划过 2px 缝隙不闪），`createPortal` 到 `document.body` + `position: fixed` 渲染 `.beat-tip`
  （`z-index: 70`、`pointer-events: none`），`left` 夹在视口内、色条离上沿太近就改成往下弹，
  滚动（**capture: true**）/resize 时收起；有 `details` 时摘掉原生 `title`（免得两个提示框同时冒出来）。见坑 31。
- 卡片传 payload 的三条数组，抽屉传详情接口的 `beats`（`NowSection.tsx`），一个组件两处复用；
  `web/lib/format.ts` 新增 `stamp()`（同年省年份、精确到秒）。
- 单测：`kuma-payload.test.mts` +2（三条数组等长且末拍对齐、超长消息截断/空白消息空串）、
  `web-format.test.mts` +1（`stamp`），单测 259 → **262/262**。
- 新增 `tests/e2e-monitor-beat-tip.mjs`（**27 条断言**，已进 `tests/run.mjs` 的 monitor 套件）：API 形状与末拍对齐、
  悬停最后一拍与第 35 拍看时间·消息·响应·「第 i/N 拍」、提示框完整在视口内、`pointer-events: none`、移开就消失、
  第一行卡片（贴页头）不越界、抽屉里的色条同样弹框；截图 `tmp/shot-beat-tip.png`、`tmp/shot-beat-tip-drawer.png`。
  首跑踩到「抽屉还没渲染完就 `count()`」→ 改成 `waitForSelector('.drawer .monitor-beats')`，别用固定 sleep 赌。

验证：`pnpm typecheck` 0 错误；`pnpm test` **262/262**（另 snippet 7 条）；`pnpm build` 通过
（CSS `index-GP1ktyR3.css` 38.11 kB —— 变大是新增 `.beat-tip` 那几片；JS `index-DtlJ5SI-.js` 418.15 kB）；
`tools\pinboard.ps1 restart` 后 `/api/monitors` 实测每项 `beats/times/msgs/pings` 都是 40 且末拍时间 = `time`；
`e2e-monitor-beat-tip` **27/27 ALL PASS**（真实 Chrome，1440×950，浅色主题截图目视通过）。

㉓ **悬停的那一段会稍微变大、把左右邻居挤开**（同日追加，用户要「小动画」）：`.monitor-beats i` 加
`transition: flex-grow 0.12s ease, transform 0.12s ease`，`i.hot` 是 `flex-grow: 2.6` + `scaleY(1.2)`。
**必须用 `flex-grow`**：只有它参与布局才挤得动邻居（`transform` 只画不排版，邻居不会让位）。实测 40 段时
那一段 4.4 → 11.1px、高度 18 → 21.6px，右邻居左边界 +6.1px、左邻居右边界 −0.5px（右边段多，增长偏右是必然的，
视觉上仍是「这一段撑开、两边让位」）。
- **「第几拍」改成取 `ev.target` 的 `data-i`**，不再按 `clientX` 等宽反推：那一段变宽会把边界一起推走，
  按坐标算会把自己算到邻居身上、再抖回来（见坑 32）；划在 2px 缝隙上时保持原状不闪；提示框锚点也改成
  那一段自己的 `getBoundingClientRect()` 中心。
- e2e 加 6 条断言（变宽、变高、左边界左移、左邻居右边界左移、右邻居左边界右移、移开恢复原样），并把「点某一段」
  从「按悬停前算好的坐标」改成「先 park 到角落等动画回位、再取这一段自己的盒子」——上一段的放大还没退回去时
  坐标就是偏的（首跑就是这样挂的：左邻居只挪了 0.5px，阈值定太死）。27 → **33 条断言**。
- 验证：`pnpm typecheck` 0 错误；`pnpm test` **262/262**；`pnpm build` 通过（CSS `index-JKW27H8A.css` 38.22 kB、
JS `index-BCcNG_vR.js` 418.21 kB）；`restart` 后 `e2e-monitor-beat-tip` **33/33 ALL PASS**、全量 e2e **15/15**；
浅/深色截图 `tmp/shot-beat-grow-light.png` / `-dark.png`（deviceScaleFactor 3 放大看）目视通过。

## 2026-10-22 补充：主机指标页（6 台服务器 CPU / 内存 / 磁盘 / 服务）

㉔ **新增「主机」页**（用户问「现在能看到服务器内存 CPU 了吗」——此前 Kuma 19 项全是端口/HTTP 探活，
拿不到任何 CPU/内存数字，之前汇报的读数都是临时 SSH 上去跑的）。方案 A + 拓扑 1，用户拍板「按你推荐的做」：
**每台机自己 push → my-server 落盘 → 本机 pinfolio 每 5 分钟拉回来入库 → `/hosts` 页展示**。
- 拓扑是被 pinfolio 的约束逼出来的：它只监听 `127.0.0.1:7788`、公网不可达，所以必须由服务器推到一个公网端点，
  再由本机去拉。公网端点就用 my-server 现成的 nginx —— 它编译了 `http_dav_module`，`dav_methods PUT` 直接落盘，
  **不新增任何进程、端口或后端服务**。
- 为什么不选 node_exporter + Prometheus + Grafana：每台常驻 15–25 MB，本机再加 ~200 MB；oj 只有 945 MB
  （历史上装 dnf-automatic 把它拖死过）。现在服务器侧**零常驻**：oneshot 一次 96–267 ms、峰值内存几 MB、磁盘 2 KB。
- 采集端 `tools/node-metrics/`（5 个文件 + README）：`node-metrics.sh`（110 行，只读 `/proc/stat` 两次采样算 CPU、
  `/proc/meminfo` 算内存与 swap、`/proc/loadavg`、`df -P -B1` 每路径一条、`systemctl list-units --state=failed` 计数、
  `WATCH_UNITS` 逐个 `is-active`、`ps --sort=-rss` 前三个进程）、`install.sh`（写 `/etc/node-metrics.conf` 600 + 装 unit/timer +
  立刻跑一次）、service（`MemoryMax=32M` / `CPUQuota=20%` / `TimeoutStartSec=60` 兜底）、
  timer（`OnBootSec=2min` + `OnUnitActiveSec=5min` + `AccuracySec=30s` + **`RandomizedDelaySec=20s`**）、
  `nginx-metrics.conf`（ingest 段 `limit_except PUT { deny all; }`，GET 段 `default_type application/json` + `no-store`）。
- **6 台时间戳不同步是正常的**：随机延迟 20 秒 + 精度 30 秒故意错峰，免得 6 台同时 PUT。第一天误以为是数据没更新，
  实测当时 18:50:33，my-server 推的 18:50:28、oj 18:49:32，其余 4 台还在 18:45 —— 没毛病。
- 服务端：`server/schema/metrics.ts`（`host_metrics(host, ts, data, received_at)`，主键 `(host, ts)`）+
  `server/metrics/{config,store,poll,routes}.ts`。**整条采集 JSON 原样存 `data` 列、不拆字段** —— 采集端以后加字段，
  服务端一行都不用改。`data/metrics.json` 存拉取 token 与 6 台的 `label`（`note` 只写机房、不写 IP）。
- `MIN_GAP_MS = 4 分钟`：页面每次刷新都会催一次拉取，这道闸让定时器永远能过、刷新基本白跑，
  不会把 my-server 打穿；「立即拉取」走 `force` 绕过。库里一条样本都没有时 `GET /api/hosts` 会**等**这次拉取完，
  否则首屏拿到空数组。
- 前端：`web/pages/HostsPage.tsx` + `web/pages/hosts/{useHosts,HostCard}` + `web/styles/hosts.css`（第 13 片样式）、
  侧栏「主机 N/M」徽标、命令面板 `a3h`、`TITLES.hosts = '主机'`。`pageSubtitle` 的 `s` 参数新增**可选** `host?: HostSummary`
  —— 可选才不破老测试。卡片四格 CPU / 内存 / 负载 1m / 已运行 + 24 小时曲线（SVG，`vectorEffect="non-scaling-stroke"`）+
  磁盘条 + 服务 chip + 底栏 OS 与 top 进程；样本 `< 2` 个时写「还没有曲线」，**不画假线**。
- 坑：采集 JSON 里 `top` 的字段名是 **`rss_kb`** 不是 `rss`（照 `ps` 的直觉写会全变 `undefined`）；
  经 pwsh → ssh_skill 传远程命令时**单引号会炸**（PowerShell 拆串、静默无输出），要比 6 台的时间戳直接用本机
  `Invoke-RestMethod https://metrics.example.com/metrics/<token>/<id>.json` 更省事。

验证：6 台 `node-metrics.service` 全 `status=0/SUCCESS`、timer 有 NEXT，`/var/www/metrics/` 6 个 JSON（479–579 B）；
`/api/hosts` 返回 `hosts=6 samples=7 pollOk=6 failed=0`、6 台全 `online=true`；`pnpm typecheck` 0 错误、
`pnpm test:unit` **263/263**、`pnpm build` 通过（CSS 43.23 kB / JS 425.61 kB）；`tools\pinboard.ps1 restart` 后
Playwright 截图 `tmp/hosts.png`（1440×1000）目视：侧栏「主机 6/6」、六张卡 2 行 3 列、磁盘条/服务 chip/top 进程都正常。
真机读数（2026-10-22 18:45）：my-server 36% / 56%、az 17% / 10%、oj 1.5% / 40%、os 11% / 3%、ox 14% / 43%、
aws-node 11% / 42.5%，`failed_units` 全 0。

**已完成（2026-10-22，主机页可写 + 服务 chip 跳观测台）**：用户要求「点一下部署的服务可以自动跳到观测那边，如果没有观测就不跳，并且把主机页的增加、暂停、删除功能补上」；问到跳过去要不要展开详情时答「高亮那张卡片够了」。两块一起做，**没有新增任何依赖**：

① **服务 chip → 观测台**：新增仓库根 `host-services.json`（`[{host, unit, match?, monitor?}]`，`match` 在该主机分组内按**短名**不分大小写包含匹配，`monitor` 按 id 钉死）。服务端 `server/metrics/services.ts` 用 `getStatusPage()`（5 分钟缓存，Kuma 挂了就当空）把规则解析成 `unitMonitors: { unit: { id, name } }` 随 `GET /api/hosts` 下发；前端 `HostCard` 只给**有映射**的 chip 渲染成 `button.host-unit` 并加 `ArrowUpRight` 小箭头，点了走 `s.openMonitor(id)` → 切到观测页 + 滚到 `#monitor-<id>` + `.flash` 高亮 1.6 秒（复用异常通知那条路，**不自动开抽屉**）；没映射、或观测项被删/改名后自动退回纯文字 chip，`title` 说明原因。预置映射：my-server 与 az 的 nginx→「Nginx 站点」、app-api→「网关 API」、app-manager→「管理端」；oj / aws 的 xray→「Xray」；os / ox 的 sing-box→「sing-box」；aws caddy→「Caddy」。故意不映射 memwatch / glados-sub / az sing-box / aws hysteria-server（本来就没有对应观测项）。

② **增加 / 暂停 / 删除**：`data/metrics.json` 仍是唯一事实源，新增 `server/metrics/hostmeta.ts`（纯函数 `parseHosts` / `normalizeHostInput` / `addHost` / `patchHost` / `removeHost` / `mergeMetricsFile` / `visibleFailures`；id 限 `[A-Za-z0-9][A-Za-z0-9._-]*` 1–32 位、label ≤40 字、note ≤60 字）。`config.ts` 加 `saveHosts()`：读-改-**原子写**（`.tmp` + `renameSync`，保留 `base` 与未知键——`base` 带拉取 token，见坑 33）+ `resetMetricsConfig()`。路由新增 `POST /api/hosts`（重名 **409**）、`PATCH /api/hosts/:id`（`paused:false` 立刻补一帧）、`DELETE /api/hosts/:id?confirm=<id>&purge=1`（手输 id 才删，`purge` 连 `deleteSamples()` 一起删 30 天历史）。**暂停 = 本机不再拉**（`pollAll` 过滤 `paused`），卡片保留、灰虚线、标「已暂停」、不算离线也不算陈旧、曲线留着；采集端 timer 照推（要彻底停得去那台机 disable，卡片与文档都写了这句）。前端：工具条「+ 添加主机」→ `AddHostDrawer`（FormDrawer 三字段 + 「加完先是还没收到上报」提示）、卡片 hover 出「暂停/恢复」「删除」两个图标按钮、`DeleteHostModal` 手输 id + 「同时删掉历史样本」默认勾选；顺带去掉 `online/hosts.length` 里硬编码的 `|| 6`。

③ **顺手两处收口**：`pollFailed` 过 `visibleFailures`（删掉/暂停的不再刷红条）且要求「至少有过一帧样本」（刚加还没装采集端的机不刷红条，卡片自己写「还没收到这台机的上报」）；可点 chip 与纯文字 chip 原本长得一样，给可点的加 ↗ 箭头 + hover 变亮。

验证：新增 `tests/unit/metrics-hosts.test.mts`(17) 与 `metrics-services.test.mts`(11)，**单测 293/293**；`pnpm typecheck` 0 错误、`pnpm build` 通过（CSS 45.02 kB / JS 430.91 kB）；写接口用 `tmp/verify-hosts.sh` 十步 curl 实测（重名 409 / 非法 id 400 / 暂停后不再拉 / confirm 写错 400 / purge 删除 / 收尾 `data/metrics.json` 的 `base` 61 字节未损）；浏览器 `tmp/verify-ui.mjs` 两轮：6 张卡、11 个可点 chip / 4 个纯文字、点 my-server 的 nginx chip 后 URL 变 `/monitors`、`#monitor-5` 有 `.flash` 且在视口内；添加→7 张卡且红条 0 条、暂停→灰虚线 + 「已暂停」、恢复、删除弹窗未输 id 时确认按钮 disabled、输 id 后回到 6 张卡。整包 `pnpm test` 全过；`pnpm test:e2e` **15/15 套件、187 秒全绿**（`e2e-monitor-note` 因 2026-10-22 观测项改成可读名而找不到 `my-server / app-api` 与 `oracle-proxy / xray`，已把常量改成现名 `my-server / MyApp 网关 API` / `oj / Xray 代理服务`，并把「必须存在一条没写说明的观测项」改成有就验、没有就 SKIP）。文档：architecture / api(zh) / features(zh) / AGENTS / pitfalls(33–35) / CHANGELOG 同步。

**已完成（2026-10-22，一条命令接入主机 + 加主机顺带建观测项）**：用户提出「添加主机允许附带一些观测项，也要有获取主机信息的渠道啊，你这样添加一个主机，怎么拿到它的 cpu 内存这些」；两次选择后定为「采集端参数 + 观测项两个都填」、按完整设计做。**没有新增任何依赖**：

① **采集端一条命令装好**：新增 `tools/node-metrics/build-install.mjs`，把 `install.sh` / `node-metrics.sh` / `.service` / `.timer` 内联成单文件 `node-metrics-install.sh`（heredoc 分隔符 `NODE_METRICS__<NAME>__EOF`，头部写源文件指纹，`--check` 逐字节比对；尾部不用 `exec`，否则 `trap` 不跑、临时目录残留）。生成物 9529 B、sha256 前 16 位 `04fa43e4157b1f51`，托管在 my-server 的 nginx `/nm/`（`alias /var/www/nm/`、`autoindex off`、`Cache-Control: no-store`、**不带 token**），公网 `curl` 下来与本地字节一致。命令由服务端 `server/metrics/onboard.ts` 的纯函数拼：`buildIngestUrl()` 把拉取地址 `…/metrics/<token>/` 换成上报地址 `…/metrics-ingest/<token>`，`buildInstallCommand()` 用 `shq()` 转义四个位置参数，`parseUnits()` / `parseDisks()` 校验服务清单与磁盘路径（16 个 / 8 个上限）。

② **抽屉三段 + 顺带建观测项**：「+ 添加主机」现在是 基本信息（id / 显示名 / 备注）→ 采集端（服务清单 / 磁盘路径 / 地址）→ 观测项（端口 / HTTP 站点 / systemd 服务，默认都不勾）。保存时 `server/kuma/provision.ts`（纯函数 `groupNameFor` / `planMonitors` / `mergeServiceRules`）把勾选的模板摊成要建的观测项（命名 `<组短名> / <服务名>`，端口 1–65535、HTTP 必须 http(s)、systemd 走 SSH `systemctl is-active <unit>`），`server/kuma/kuma-cli.ts` 薄封装 kuma 仓库的 CLI（`ensureGroup` / `addMonitor` / `deleteMonitor` / `deleteGroup`），并在 kuma 侧给 `tools/kuma-monitor.cjs` 补了 `group-add` / `group-del` 两个子命令（组里还有观测项时拒绝删组）。**观测项失败不回滚主机**：`provision: {ok:false,error}` 回给前端显示，指标照样收；建到一半失败会把已建出来的删掉。建成的 id 记进 `data/metrics.json` 的 `monitors` 与 `group`，服务清单的映射走 `host-services.json` 的 `monitor:<id>`（精确钉死，改名不影响跳转）。保存后弹 `OnboardModal`「接入这台机器」：一条命令 + 复制 + 「立即检查」+ 首帧状态（`GET /api/hosts/:id/onboard`，**token 只在这一支出现**，列表与 `SNAPSHOT.md` 里都没有）；没样本的卡片写「还没收到这台机的上报」+「接入指引」按钮，随时能再打开。

③ **删主机要回收**：`DELETE ?confirm=<id>&purge=1` 现在除历史样本外，还按 `monitors` 逐个 `deleteMonitor()`（失败的 id 进 `monitorsFailed`）、组空了 `deleteGroup()`、并 `removeServiceRules()` 清掉 `host-services.json` 里这台机的映射；删除弹窗的勾选文案同步改成「同时删掉历史样本（30 天曲线），以及加主机时顺带建的观测项」。

验证：`pnpm typecheck` 0 错误、`pnpm test:unit` **319/319**（新增 monitors / group / removeServiceRules / onboard / provision 用例）、`pnpm build` 通过（CSS 46.74 kB / JS 437.44 kB）。接口用 node fetch 跑完整生命周期（`tmp/zz-lifecycle*.cjs`）：建主机 + 端口 + HTTP + systemd 三项 → `provision.ok=true`、Kuma 里多出 145/146/147 三项与组 13、`data/metrics.json` 记 `monitors/group`、`host-services.json` 多一条 `monitor:147`；`DELETE ?confirm=…&purge=1` → `monitorsDeleted=3`、组 13 与映射一并消失、组列表回到 1,2,3,4,5,7,8；错误分支核对 404 / 「勾了观测项就要填主机地址」/「读不到私钥」；`/api/hosts` 列表 grep `metrics-ingest` = 0（token 不外泄）。浏览器 `tmp/verify-onboard.mjs` 走完整流程（抽屉三段 → 保存 → 接入弹窗命令 224 字符含安装器地址 → 新卡「接入指引」→ 删除后回 6 卡、页面告警条 0），截图 `tmp/shots/hosts-{7,8,9}-*.png`（弹窗里的 token 截图前替换成 `<TOKEN>`）。**真机**：在 my-server 上备份 `/etc/node-metrics.conf` 后，用弹窗里那条命令原样装了一台 `zz-real`（采集预览 JSON 正常、service `status=0/SUCCESS`、timer NEXT 5min），pinboard 侧 `POST /hosts/refresh` 后该机有 `cpu 22.3` 与 `units{nginx:active}`、`onboard ready=true firstSampleAt=2026-10-22T14:24:18Z`；收尾恢复原配置并重启 timer、`rm /var/www/metrics/zz-real.json`、补一帧后 my-server `staleSec=2` 三项服务 active、`DELETE ?purge=1` 清掉 `zz-real`，Kuma 回到 **24 项 / 7 组**、无 zz 残留。坑清单补 36–39（真 token 别进仓库且 `read` 会把 32 位 hex 遮成 `<TOKEN>`、Git Bash 的 `curl -d` 发中文变 U+FFFD、改了采集端四件套必须重新打包并重传 `/nm/`、删主机必须回收观测项与映射）。文档：architecture / api(zh) / features(zh) / AGENTS / pitfalls(36–39) / CHANGELOG / tools/node-metrics/README 同步。

**已完成（2026-10-22，观测台「快捷入口」卡）**：用户说「加到pinfolio，观测里作为一个卡片，但是不观测，点击可以跳转就行」—— 想把刚部署的 Immich（`http://203.0.113.11:2283`）放进观测页。**故意没有建 Kuma 观测项**：那会多出一个永远「已暂停 / 无数据」、色条空白的假监控，还多一份要维护的探测；改成原生的「快捷入口」卡。

① **数据**：仓库根新增 `quick-links.json`（`[{ name, url, note?, label?, icon? }]`，规矩同 `monitor-links.json` —— 真文件 gitignore，仓库只带 `quick-links.example.json`）；服务端新增纯函数模块 `server/kuma/quick.ts`（`parseQuick()` / `loadQuick()` / `isHttpUrl()` / `hostOf()`：只认 http(s)、`name` 留空退回 host、同一 URL 只留第一条、name ≤40 / note ≤60），`loadQuick()` **每次请求热读**（改完刷新页面即生效）。`feed.ts` 的 `collect()` 把它一起交给 `buildPayload`，`Payload` 多一个 `quick` 字段（`BuildInput.quick?` 可选，老调用点与 17 条 payload 单测一行没改）。`summary` / `groups` / 分组筛选 / 搜索**一律不含**这些卡。

② **前端**：新增 `web/pages/monitors/QuickLinks.tsx` —— 整张卡就是 `<a target="_blank" rel="noreferrer noopener">`，没有 onClick、不开抽屉；图标 `image`→相机 / `globe`→地球 / 其余→链环。`MonitorsPage` 在筛选条下面渲染「快捷入口 · 不参与观测」一行（`.quick-head` 带一条分隔线，复用 `.monitor-grid` 的列宽对齐观测卡），卡高只留一行头部（`.quick-card { min-height: 0 }`，实测 61 px）。`web/lib/api/monitors.ts` 加 `QuickLink` 类型与 `quick?: QuickLink[]`（老服务端不返回按空数组处理），`web/lib/api.ts` 门面再导出。

③ **当前内容**：一条 Immich 图库，`note` = `os · 东京 · 照片`、`icon` = `image`。

验证：新增 `tests/unit/kuma-quick.test.mts`（8 例：非数组 / 坏条目跳过 / 默认值 / name 退回 host / 同 URL 去重 / 截断与去空白 / `isHttpUrl` / `hostOf`）；`pnpm test:unit` **327/327**、`pnpm typecheck` 0 错误、`pnpm build` 通过（CSS 47.56 kB / JS 438.62 kB）；`tools\pinboard.ps1 restart` 后 `GET /api/monitors` 的 `quick` 一条、`groups` 仍 7 组 25 项；Playwright（`tmp/quick-check.mjs`）在 `/monitors` 实测：`.quick-card` 1 张、文本「Immich 图库 / os · 东京 · 照片」、`href` 正确，点一下**只弹新标签页**（popup = `http://203.0.113.11:2283/`）、抽屉 `.drawer` 数量 0、控制台 0 报错；截图 `tmp/quick-links.png`（1680×1050）目视：卡在筛选条下方第一行、与观测卡同列宽、不抢风头。文档：architecture / api(zh) / features(zh) / AGENTS / CHANGELOG 同步。

**已完成（2026-10-25，静态加密 03）**：邮箱密码、Kuma 口令、指标源 token 改成 AES-256-GCM 密文（`enc:v1:<iv>:<tag>:<ct>`），主密钥 = `PINBOARD_SECRET` → `data/secret.key`（0600）→ 首次启动生成；启动时 `migrateSecrets()` 把还躺在明文里的凭据就地加密，日志打一行「凭据已就地加密 -> 邮箱 N 条 / Kuma 口令 N / 指标源 N」，重启幂等。新增 `tests/unit/secrets.test.mts` 12 例（加解密往返、篡改/未知版本抛错、密钥文件生成、明文迁移只跑一次、`hasSettings()` 空表判定）；`pnpm test:unit` **364/364**。真机（7791 隔离实例，数据是主库副本）复测：库里 `mail_accounts.password` 变 `enc:v1:…`、`data/kuma-pass.txt` 与 `data/metrics.json` 的 base 同改；`/api/monitors` 25 项、`/api/hosts` 6 台真实指标、`/api/mail/messages` 真实收信全部正常。

**已完成（2026-10-26，自动备份 05）**：新第 7 页「备份」，两个目的地。本机：每天 03:00 打 `data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz`（保留 14 份，`BACKUP=0` 关）；远端：MySQL / PostgreSQL 的一行（`payload` 存整包，上传后回读 sha256 校验）。包内 = 库快照（模块级 `backup()`）+ 当天心跳 CSV + 观测项 JSON + `data/*.json|txt`（含 `secret.key`）+ 根目录四个配置 + `manifest.json`；`kuma.db` 只在周日那份。每天的 CSV 另存 `data/audit/`，不受 14 份限制（Kuma 自己只留 365 天）。实施中修掉四个真 bug：心跳按本地日边界查 0 行（Kuma 存 UTC，见坑 41）、远端主键 50 字符装不进 `VARCHAR(36)`（坑 42）、MySQL `DATETIME` 不吃 ISO（坑 43）、`pg` 的 `query()` 返回 `{rows}`（坑 44）。验收：本机包 455 KB / 11 个成员（快照 notes 4·assets 18·tags 27·settings 5、CSV 550 行 + 表头）；MySQL 8.0.42 与 PostgreSQL 18.3 各传一份、回读 sha256 一致；远端取回本机与删除都通；本机下载文件与磁盘 sha256 一致。单测新增 `backup-core` 7 例 + `backup-remote` 5 例，`pnpm test` **376/376** + 7 片段。

**已完成（2026-10-26，容器化部署 04）**：三种跑法落地，开源用户主路径变成 `docker compose up -d`（可选 `--profile tls` 起 Caddy 自动签证书）。新增 `Dockerfile`（多阶段：builder 装全量依赖跑 `pnpm build`，runtime 只 `pnpm install --prod` + `dist/`，非 root `node`、`VOLUME /data`、`HEALTHCHECK` 打 `/api/health`）、`.dockerignore`、`docker-compose.yml`（端口默认只绑 `127.0.0.1:7788`，`HOST=0.0.0.0`、`TRUST_PROXY=1`、命名卷 `pinfolio-data`）、`deploy/Caddyfile`、`docs/deploy.md`（Docker / 裸机 Linux·macOS 含 systemd 单元 / Windows / 环境变量全表 / 接不接 Kuma / 六步验收）。

**服务端打包**：`pnpm build` = `vite build` + `esbuild server/index.ts --bundle --platform=node --format=esm --target=node24 --packages=external --outfile=dist/server.js`（197.2 kB），新增 `pnpm start:dist`；`tsx server/index.ts` 留作开发。**依赖分层**：`dompurify` / `lucide-react` / `marked` / `react` / `react-dom` 从 `dependencies` 挪到 `devDependencies`（服务端零引用，实测 grep 0 命中），运行时依赖只剩 7 个包——`pnpm install --prod` 后 `node_modules` **23 MB**（原先含 react 等是 300 MB 级）。`package.json` 补 `engines: node >= 24`、`packageManager: pnpm@12.3.4`。

**迁移前快照补上**：`server/backup/premigrate.ts` 的 `snapshotBeforeMigrate()` 用 `VACUUM INTO`（**不能直接拷 .db，WAL 里的事务会丢**，见坑 46）拍 `data/backups/pre-migrate-v<版本>-<时间戳>.db`、保留 5 份、不碰 `pinfolio-*.tar.gz`；`migrate(db, MIGRATIONS, { dataDir })` 在跑 pending 之前调它，**失败就抛错中止升级**。新增 `tests/unit/premigrate.test.mts` 3 例（全新库不拍 / 升级前拍且快照里是升级前数据 / 保留 5 份）。

验证：`pnpm typecheck` 0 错误、`pnpm test:unit` **380/380**、`pnpm build` 出 dist/web（CSS 56.26 kB / JS 461.36 kB）+ dist/server.js 197.2 kB；本地 `node dist/server.js` 与「只装 --prod 依赖」两个目录都跑通（health 200 / `/` 200 / `/api/auth/state` 200）；把源码 tar 到 my-server 上 `pnpm install` + `pnpm build` 产物字节数与本机一致、`--prod` 目录跑起来也 200。**本机与服务器都没有 docker，镜像本身未 build 过**（Dockerfile 按官方多阶段写法，待有 Docker 的机器验证）。

