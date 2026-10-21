# pinfolio

一个跑在本机的小工具：**随手写便签**，加 `#标签` 自动归类，再配一份**资产台账**，把服务器、域名、账号、设备这些东西登记清楚——到期了会提醒，便签能直接钉在某条资产上。再加一页**邮件**，把 Gmail / QQ / 163 几个信箱合到一个只读收件箱里；还有一页**观测台**，把所有机器/服务的实时状态并排摆出来。

单进程、单端口、单个 SQLite 文件，不联网、无账号、无 Docker。打开 http://127.0.0.1:7788 就能用。

- 运行方式：代码放在哪个目录都行，`pnpm install && pnpm build && pnpm start` 就能跑
- 技术栈：Node 24 + TypeScript + Hono + `node:sqlite`；前端 Vite 7 + React 19 + 手写 CSS
- 数据：`data/pinboard.db`（只在本机）

## 截图

截图没跟着仓库发布——页面里都是本机真实的便签、邮箱和机器名，公开出来不合适。想看图就本地跑起来自己拍：

```powershell
node tools/screenshots/shots.mjs      # 便签 / 资产 / 设置 / 命令面板 / 深色
node tools/screenshots/shots-assets.mjs
```

产物写到 `tmp/shot-*.png`（已 gitignore）。

## 功能

### 便签
- 顶部输入框直接写，**Ctrl / ⌘ + Enter** 保存；支持 Markdown（标题、列表、代码块、链接）。
- 正文里写 `#标签` 会自动归类，中文标点后面也能识别（`。#整理` 有效），标签颜色自动分配。
- **完成状态**：点卡片左侧的圆圈，或**双击卡片正文**，标记「已完成」；再点/再双击回到未完成。完成态是绿色对勾 + 「已完成」胶囊 + 正文淡化加删除线，卡片原地不动、不会跳走。
- 筛选：全部 / 未完成 / 已完成 / 置顶 / 按标签 / ＋新标签；右侧可搜索（防抖）。
- 置顶的便签单独成区，永远排在最上面。
- 行内编辑（铅笔）、**归档**（Archive 图标，默认列表不再有删除）、把便签关联到某条资产。
- **已归档**：归档的便签默认不显示，点筛选行的「已归档」chip（带条数）进只读视图，在那里才能「恢复」或「永久删除」（红色按钮 + 确认弹窗）。Ctrl+K 全局搜索不返回归档便签。

### 标签
- 内置 12 个预设标签：待办、想法、阅读、工作、学习、生活、灵感、重要、整理、运维、账号、购物（`server/db.ts` 的 `PRESET_TAGS`，只在首次建库时写入一次，删掉不会自己长回来）。
- 输入框下方「标签」按钮打开弹层，点一下就插入 `#标签 `，不用记拼写；弹层底部可**新建标签**（名称 + 颜色）。
- 筛选行只显示「有便签在用」的标签，避免刷屏；完整列表在弹层和设置页里。
- 标签在便签和资产之间**共用同一套**——这也是把两者做进一个应用的原因。

### 资产台账
- 类型：设备 / 服务器 / 账号 / 域名 / 其他；状态：在用 / 闲置 / 退役 / 丢失（列表按 在用 → 闲置 → 其他 排序）。
- 通用字段：名称、位置、供应商、序列号、价格 + 币种、购买日期、到期日期、链接、备注（Markdown）。
- **自定义字段**：在设置页定义 key、显示名、类型（文本 / 数字 / 日期 / 链接 / 单选 / 布尔），所有资产通用。当前预置了 `ip`（IP / 地址）、`login`（登录方式）、`secret_at`（密钥 / 凭证位置）、`renew_cycle`（续费周期：月付 / 季付 / 年付 / 买断）。
- 到期提醒：卡片和统计卡按天数显示「还剩 N 天 / 已过期」，30 天内到期会高亮计数。
- 卡片视图 / 表格视图切换；按类型、状态筛选；**标签栏**常显「有资产在用」的标签（`#标签 数量`，按关联数从多到少、同数按名称排，点一下筛选、再点取消）；搜索名称 / 序列号 / 备注。
- 点卡片打开右侧抽屉：编辑全部字段、看关联的便签、在抽屉里直接新增便签、删除资产。

### 观测台
- 数据源是**本机的 Uptime Kuma**（默认 `http://127.0.0.1:3001`，状态页 slug `obs`），Kuma 只当探测后端，页面在 pinboard 里。
- **Kuma 自带的 `http://127.0.0.1:3001/status/obs` 已于 2026-10-19 下线**（返回 404），观测只看这一页。Kuma 的
  `/api/status-page/obs`、`/api/status-page/heartbeat/obs` 两个 JSON 接口保留，是这里的数据来源。
- 卡片一屏放完：4 列（≥1700px 宽屏 6 列），按机器分组排列（12 项时 2560×1440 两行、1600×900 三行；2026-10-20 加到 15 项 / 5 组后行数相应增加）。
- 每张卡片：名称 + 机器 + 类型、**最近 40 次心跳**的色条（绿=正常 / 红=故障 / 黄=待定 / 灰=维护）、响应毫秒、最近检查时间、24h 可用率、窗口内异常次数。
- 顶部四格：观测项 / 正常 / 异常 / 24h 可用率；下面可按机器、状态筛选，或按名称 / 消息搜索。
- 默认 30 秒自动刷新（可关），也可以手动点刷新；卡片视图 / 表格视图切换。
- **跳转管理页**：有管理界面的观测项，标题后面带一个 ↗，点标题在新标签页打开对应项目的管理页（表格视图里同样可点）。映射写在根目录的 `monitor-links.json`，改完刷新页面即生效，不用重启。
  仓库里只带一份示例 `monitor-links.example.json`，**复制成 `monitor-links.json` 再改**（真文件已 gitignore，免得把自家面板地址提交上去）：

  ```json
  [
    { "id": 1, "name": "本地面板", "url": "http://127.0.0.1:7863/panel/", "label": "本地控制台" },
    { "id": 3, "name": "线上入口", "url": "https://example.com/panel/", "label": "线上控制台" }
  ]
  ```

  没配跳转的观测项（比如只探端口的 nginx / xray）就不显示 ↗。

  **按 `id` 匹配（优先）**：观测项可以在抽屉里改名，名字不是稳定键，所以规则以 `id` 为准，`name` 只当注释与兜底。
  换文件位置设 `MONITOR_LINKS` 环境变量。
- **点卡片（或表格行）打开右侧观测项详情抽屉**，和资产详情同一套交互：
  - **基本信息**：名称、介绍、检查频率（带 30 秒 / 1 分钟 / 5 分钟 / 10 分钟 / 30 分钟快捷键）；展开「高级设置」还能改超时、重试次数、重试间隔、是否常显消息。这些都**写回 Kuma**（Kuma 是唯一事实源，CLI 与 `SNAPSHOT.md` 看到的是同一份），保存后列表立即刷新。
  - **暂停 / 恢复观测**：暂停后卡片和表格行都变淡并标「已暂停」，Kuma 不再探测（历史心跳保留）；恢复即重新开始。
  - **删除观测**：抽屉里二次确认，**必须把观测项名字原样输一遍**按钮才可用；确认后先自动备份一份 `kuma/data/kuma.db` 到 `kuma/backups/kuma-YYYYMMDD-HHMMSS.db`（只留最近 5 份），再连同历史心跳一起从 Kuma 删除，不可撤销。
  - **立即观测**：不等下一个周期，立刻跑一遍这个观测项的「观测配方」，逐步骤回显耗时和结果。默认配方 = 让 Kuma 重启检查循环、马上真探一次；特殊观测项（比如每日打卡这种推送型、或要顺带刷新上游的）在根目录 `monitor-actions.json` 里按观测项 id 配多步配方，**改完不用重启**，刷新页面即生效。
- 改名会同步到 Kuma；如果别的观测项的「策略」是按名字引用了它，改名会被拒绝并说明是谁引用了，避免策略静默失效。
- Kuma 挂了不会白屏：退回上一次数据并在顶部提示；连一次都没读到过，就显示「读不到观测项」+ 具体原因 + 重试按钮。
- **为什么分两半缓存**：Kuma 的 `/api/status-page/obs` 偶尔要 5–30 秒才回（它自己按 5 分钟缓存，缓存过期那一刻正好赶上 12 个探测在跑就会很慢），而心跳接口只要几十毫秒。所以后端把「观测项清单」缓存 5 分钟（启动时预热、每 5 分钟续一次）、心跳按需现取，页面正常 0.1–0.4 秒出全部卡片。

### 邮件（只读合并收件箱）
- 自己填 IMAP 服务器（Gmail / QQ / 163 / 任意 IMAP），**多个信箱合成一个收件箱**，按时间倒序；顶部的账号 chip 可只看某一个信箱，chip 上带未读数。
- **只收信，不改变服务器上的任何状态**：只用 `SELECT` / `SEARCH` / `FETCH(BODY.PEEK[])`，一行 `STORE` 都没有——打开邮件**不会**把服务器上的未读变成已读（客户端库 imapflow 的 `fetch` 天生就用 `BODY.PEEK`）。
- **已读只记在本机**：点开一封邮件，这一行变淡，标记存在本地库 `mail_local_read` 里，绝不写回服务器。设置抽屉里可以「清除本地已读标记」。
- 列表行：发件人、主题、1–2 行纯文本摘要、时间、所属信箱；未读加粗、已读淡化，账号筛选 chip 带未读数。**分页 50 封 / 页**，翻到最后一页为止（不会只显示最近一批）。
- 右侧阅读区不跳页：主题 / 发件人（名字 + 地址）/ 收件人 / 抄送 / 时间 / 信箱，正文 HTML 与纯文本一键切换。
- **排版**：邮件正文渲染在 **Shadow DOM** 里，邮件自带的 `<style>` 与内联 `style` 原样保留（只在邮件区域内生效，不会污染便签夹），营销邮件的表格/多栏排版基本保持原样；固定宽度（如 720px）的邮件会等比缩小以适应阅读区，不会被裁掉。
- **安全**：正文仍经 DOMPurify 兜底清洗（去掉 script/iframe/form 等，剥掉 `@import`/`expression()`/`javascript:`/`position:fixed`），链接一律新标签页打开；`cid:` 内嵌图走本地附件接口。
- **图片**：**远程图片默认加载**（这样排版与配图才是原样）。不想给发件人追踪信号时，点阅读区顶部「隐藏图片」即可切到虚线占位，隐藏后正文顶部会提示「已拦截 N 张外部图片」并可一键恢复，选择记在本机浏览器里。⚠️ 加载远程图片**不会**改邮箱里的已读状态（本页永不回写服务器），但会给发件人一个「这封被打开过」的追踪信号。
- 附件只列清单 + 下载，不落库；超过 25 MB 的邮件不下载正文，直接提示。
- 搜索框在当前已加载的 50 封里做客户端筛选（发件人 / 主题 / 摘要），另有「只看未读」；`j` / `k` 上下选邮件。
- **自动收信**：页面开着时每 60 秒静默回源一次（只更新列表和未读数，不动你正在读的正文），切到别的标签页就暂停、切回来立刻补一次；工具栏的「数据截至 11:05:03」是这批数据真正从邮箱服务器取回的时刻。想立刻看新的就点「刷新」（绕过缓存）。
- 缓存：列表 60 秒、正文 10 分钟（只在内存里，不写磁盘），手动点「刷新」或自动轮询时绕过缓存并重新取未读数。
- 账号连接失败不会拖垮整页：那个信箱的 chip 上会出现红色感叹号，鼠标悬停看原因；其它信箱照常显示。
- 163 需要客户端发 `IMAP ID`（否则报 `Unsafe Login`），imapflow 登录时自动发，不用管；Gmail 要「应用专用密码」，QQ / 163 要「授权码」，填登录密码一定失败。
- **代理（Gmail 必备）**：国内直连 `imap.gmail.com:993` 经常被墙（表现为「连接超时」），账号抽屉里有个**「代理（可选）」**字段，填本机 SOCKS5 代理即可，如 `socks5://127.0.0.1:10808`（只写 `127.0.0.1:10808` 会自动补 `socks5://`）。也支持 `http(s)://` / `socks4://`；QQ / 163 留空直连。整库兜底可以设环境变量 `PINBOARD_MAIL_PROXY`（账号没填时生效）。

### 全局
- **每页都有自己的地址**：`/notes`、`/mail`、`/assets`、`/monitors`、`/settings`。切页时地址栏跟着变，**刷新（F5）不会跳回便签页**，前进/后退也按页面走；直接打开 `http://127.0.0.1:7788/monitors` 能直达观测台。根路径 `/` 和未知路径一律归到 `/notes`，`document.title` 随页面变（如「观测台 · 便签夹」）。
- **Ctrl / ⌘ + K** 命令面板：搜便签、搜资产，或执行「新建便签 / 打开邮件 / 登记资产 / 打开观测台 / 打开设置 / 导出 JSON」。
- 主题：浅色 / 深色 / 跟随系统，记在 `localStorage` 的 `pinboard-theme`。
- 设置页可导出整库 JSON 备份（`pinboard-YYYY-MM-DD.json`）；空库时可一键灌示例数据。

## 快速开始

### 方式一：双击 `start.cmd`（推荐）
服务在**后台隐藏运行**，不会留下一个挡在前面的命令行窗口：
已经在运行就只打开浏览器；没运行就在隐藏窗口里 `pnpm start`，轮询到 `/api/health` 返回 200 后自动打开 http://127.0.0.1:7788 ，双击出来的那个窗口随即自己关掉。

日志：`logs/pinboard.log`（追加，不轮转）。停止：双击 **`stop.cmd`**。

### 方式二：命令行

```powershell
cd D:\pinfolio
pnpm install     # 首次
pnpm start       # 生产模式，http://127.0.0.1:7788
```

要求：Node ≥ 22（用到内置 `node:sqlite`，实测 Node 24.16）、pnpm。不需要 Docker、不需要装数据库、不需要编译原生模块。

停止服务：双击 `stop.cmd`，或

```powershell
& D:\pinfolio\tools\pinboard.ps1 stop     # 结束整条 node 链并等端口释放
& D:\pinfolio\tools\pinboard.ps1 status   # 看状态 / 日志用 logs
```

（方式二是前台运行，那种情况下关掉命令行窗口也就停了。）

## 数据与备份

| 项 | 说明 |
|---|---|
| 数据库 | `data/pinboard.db`（SQLite，WAL 模式，同目录还有 `-wal` / `-shm`） |
| 换位置 | 启动前设环境变量 `PINBOARD_DATA` 指向别的目录 |
| 备份 | 停服务后整个复制 `data/`；或设置页「导出 JSON」 |
| 观测台 | 读的是 Uptime Kuma，不在这个库里；换地址设 `KUMA_URL` / `KUMA_SLUG` 环境变量。抽屉里改名 / 改频率 / 暂停 / 删除都直接改 Kuma；删除前会自动把 Kuma 库备份到 `kuma/backups/`（留最近 5 份） |
| 邮件 | 信箱配置和本地已读标记也在同一个库里（`mail_accounts` / `mail_local_read`）；**IMAP 密码是明文存的**，只因为库在本机、服务只监听 127.0.0.1——别把 `data/` 或导出的 JSON 发给别人 |
| 邮件正文 | 不落盘，只在内存里缓存 10 分钟；重启就没了 |
| 恢复 | 把备份的 `data/` 放回去（JSON 导出目前只用于查阅，没有导入按钮） |
| 删库 | 停服务后删掉 `data/pinboard.db*`，下次启动自动重建空库，可在设置页灌示例数据 |

> 便签、标签、资产、自定义字段、关联关系全在同一个库里，复制 `data/` 就等于完整备份。

## 目录结构

```
pinboard/
├─ start.cmd               启动脚本（后台隐藏启动，已在运行就只开浏览器）
├─ stop.cmd                停止脚本（后台运行没有窗口可关，必须用这个）
├─ run-pinboard.vbs        隐藏窗口启动器（CRLF，被 start.cmd 调用）
├─ tools/pinboard.ps1      start|stop|restart|status|logs 控制脚本（UTF-8 带 BOM）
├─ logs/                   运行日志 pinboard.log（不进版本库）
├─ monitor-links.example.json  观测项 → 管理页跳转表的示例（复制成 monitor-links.json 再用）
├─ monitor-actions.json    「立即观测」的配方表（按观测项 id / 名字配多步，改完不用重启）
├─ package.json            scripts 与依赖
├─ vite.config.ts          前端构建（root=web，产物到 dist/web，/api 代理到 7788）
├─ tsconfig.json
├─ pnpm-workspace.yaml     pnpm 12 的构建白名单（esbuild）
├─ SNAPSHOT.md             自动生成的数据快照（资产 + 便签 + 标签，勿手改）
├─ server/                 后端（Hono）
│  ├─ index.ts             薄入口（62 行）：挂路由 + 快照中间件 + 启动
│  ├─ static.ts            dist/web 托管与 SPA 深链
│  ├─ db.ts                打开库、SQL 封装、标签解析与同步、预设标签、迁移
│  ├─ schema/              core.ts（便签/资产/标签/字段）、mail.ts（信箱 + 本地已读）
│  ├─ hydrate.ts           便签/资产的行数据补全（标签、关联资产、便签数）
│  ├─ tags.ts / dates.ts   纯函数：标签解析与配色 / 到期天数
│  ├─ snapshot/            rows.ts 取数 / markdown.ts 渲染（纯函数）/ write.ts 写盘与 1.5 秒防抖
│  ├─ mail/                types / parse（摘要解析）/ errors / pool（连接池 + 只读锁）/ client（归并 + 缓存）/ store（两张表）/ routes
│  ├─ kuma/                client（socket.io）、feed（抓取缓存）、recipe（配方纯逻辑）、runner（执行）、actions（读配置）、
│  │                       links（跳转表）、backup（库备份）、patch / http（PATCH 校验与 HTTP 小工具）、routes
│  └─ routes/              notes.ts / assets.ts / tags.ts / fields.ts / meta.ts（健康、bootstrap、搜索、统计、导出、seed）
├─ web/                    前端（React 19）
│  ├─ App.tsx              布局、侧栏、主题、命令面板
│  ├─ pages/               NotesPage / MailPage / AssetsPage / MonitorsPage / SettingsPage + 各自子目录（notes/ mail/ monitors/ assets/）
│  ├─ components/          抽屉 / 心跳色条 / 异常通知栈 / 命令面板 / ui + monitor-drawer/ asset-drawer/ mail-reader/ mail-account/
│  ├─ lib/                 api.ts（门面）+ api/（六域）、router.ts、format.ts、monitors.ts、cx.ts、paths.ts
│  └─ styles/              12 个分片，index.css 定层叠顺序
├─ tests/                  单测（unit/，pnpm test:unit）+ 14 套 Playwright e2e（run.mjs）+ fakeimap/
├─ tools/                  screenshots/（截图脚本，须在项目根跑）、seed-assets.mjs
├─ docs/                   architecture.md / pitfalls.md（30 条）/ status-history.md / adding-assets.md / mail-page-requirements.md
├─ data/                   运行时数据（不进版本库）
├─ dist/web/               前端构建产物（server 直接托管）
└─ tmp/                    运行期日志与截图（可随时删）
```

## HTTP API

所有接口都在 `http://127.0.0.1:7788/api` 下，JSON 进 JSON 出，无鉴权（只监听本机）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回数据库路径 |
| GET | `/bootstrap` | 启动数据：`{ tags, fields }` |
| GET | `/stats` | 统计：便签数、未完成数、已完成数、资产数、在用数、总价、30 天内到期、已过期、到期列表 |
| GET | `/search?q=` | 全局搜索，返回 `{ notes, assets }` |
| GET | `/export` | 导出整库 JSON |
| POST | `/seed` | 灌示例数据（仅空库时生效） |
| GET | `/notes` | 列表，支持 `q` `tag` `pinned` `done` `archived` `assetId` |
| GET/POST | `/notes/:id`、`/notes` | 单条 / 新建 |
| PATCH/DELETE | `/notes/:id` | 修改（`content` `pinned` `done` `archived` `assetId`）/ 删除 |
| GET | `/assets` | 列表，支持 `q` `kind` `status` `tag` |
| GET | `/assets/:id` | 详情，附 `linkedNotes`（已带标签） |
| POST/PATCH/DELETE | `/assets`、`/assets/:id` | 新建 / 修改 / 删除 |
| GET/POST | `/tags` | 标签列表（带便签数、资产数）/ 新建 |
| PATCH/DELETE | `/tags/:id` | 改名改色 / 删除 |
| GET/POST | `/fields` | 自定义字段列表 / 新建 |
| PATCH/DELETE | `/fields/:id` | 修改 / 删除 |
| GET | `/monitors` | 观测台数据：`{ kuma, updatedAt, summary, groups }`，聚合 Kuma 状态页 + 心跳；`?fresh=1` 强制重取观测项清单（清单缓存 5 分钟，心跳 5 秒） |
| GET | `/monitors/:id` | 单个观测项详情：`{ monitor, latest, beats, action, link }`（敏感字段已脱敏，不含 SSH 私钥 / 密码 / token） |
| PATCH | `/monitors/:id` | 改名 / 改介绍 / 改频率 / 改超时重试（`name` `description` `interval` `timeout` `maxretries` `retryInterval` `showMsg`），写回 Kuma；重名、被策略按名字引用、超时 ≥ 频率都会被拒 |
| POST | `/monitors/:id/pause`、`/monitors/:id/resume` | 暂停 / 恢复观测（Kuma 不再探测，历史心跳保留） |
| DELETE | `/monitors/:id?confirm=<名字>` | 删除观测项（名字必须原样输对）；先备份 `kuma/data/kuma.db` 到 `kuma/backups/`，再连带历史心跳删除 |
| POST | `/monitors/:id/check` | 立即观测：按配方顺序执行并逐步骤返回 `{ ok, steps: [{ type, label, ok, detail, ms }], latest }`；暂停中或推送型没配方会被拒 |
| GET/POST | `/mail/accounts` | 信箱列表（`?counts=1` 带未读数）/ 新建。**任何返回都不含密码**，只给 `hasPassword`；带 `proxy` 字段（空 = 直连） |
| PUT/DELETE | `/mail/accounts/:id` | 修改（密码留空 = 不改）/ 删除（连带清掉本地已读标记） |
| POST | `/mail/accounts/test` | 测连接，收原始参数或 `{id}`（复用已存密码与代理）；失败返回可读中文原因（配了代理会说明是「经代理 …」失败） |
| GET | `/mail/folders?account=` | 文件夹列表（带 special-use，只列可选中的） |
| GET | `/mail/messages?account=all\|<id>&folder=INBOX&limit=50&offset=0` | 合并收件箱一页；`?fresh=1` 绕过 60 秒缓存（前端每 60 秒自动轮询也用它）。返回 `{ items, total, unseen, hasMore, errors, partial, fetchedAt }`，`fetchedAt` 是这批数据从 IMAP 取回的时刻 |
| GET | `/mail/message?account=&folder=&uid=` | 单封正文（`text` / `html` / 附件清单） |
| GET | `/mail/attachment?account=&folder=&uid=&index=` | 下载附件（`Content-Disposition` 带中文文件名） |
| POST/DELETE | `/mail/local-read` | 标记本地已读 / 取消（`account=all` 或指定 id 清空）。**没有写服务器的接口** |

示例：

```powershell
# 新建一条便签
curl.exe -X POST http://127.0.0.1:7788/api/notes -H "Content-Type: application/json" \
  -d '{"content":"续费 my-server 的证书 #运维 #待办"}'

# 标记完成
curl.exe -X PATCH http://127.0.0.1:7788/api/notes/1 -H "Content-Type: application/json" -d '{"done":true}'
```

## 开发

```powershell
pnpm dev        # API（7788，tsx watch）+ Vite（5273），/api 自动代理
pnpm build      # 重新构建前端到 dist/web —— 改前端后必须执行，server 直接读这个目录
pnpm typecheck  # tsc --noEmit
pnpm start      # 生产模式（tsx server/index.ts，非 watch：改服务端要手动重启）
```

改完前端：`pnpm build` → 浏览器 Ctrl+F5。改完后端：重启 `pnpm start`。

测试都在 `tests/`，截图脚本在 `tools/screenshots/`（产物仍写 `tmp/`，已被 .gitignore 忽略）：

```powershell
pnpm test          # typecheck + 摘要清洗单测（不需要服务在跑）
pnpm test:e2e      # 核心 + 观测套件（需要 7788 已在跑、Kuma 在 3001）
pnpm test:mail     # 邮件套件（建议用隔离实例，见下）
node tests/run.mjs --only=core   # 只跑某一组：core / monitor / mail / all
```

邮件套件要隔离实例（库里有真实邮箱时尤其重要）：`$env:PINBOARD_DATA='tests\e2e-data'; $env:PORT='7799'; pnpm start`，再 `$env:MAIL_E2E_BASE='http://127.0.0.1:7799'; pnpm test:mail`，跑完删掉 `tests/e2e-data`。

| 脚本 | 作用 |
|---|---|
| `tests/run.mjs` | 串行 runner（core / monitor / mail 三组，汇总通过数；`--only=` 选组） |
| `tests/smoke.mjs` | API 冒烟（增删改查、标签、关联、统计、导出） |
| `tests/e2e.mjs` | Playwright UI 端到端（13 条断言） |
| `tests/e2e-done.mjs` / `tests/done-smoke.mjs` | 完成状态：UI + API |
| `tests/e2e-dblclick.mjs` | 双击卡片切换完成（8 条断言） |
| `tests/e2e-filter.mjs` | 完成状态下筛选行的行为（4 条断言） |
| `tests/e2e-archive.mjs` | 归档 / 已归档视图 / 恢复 / 永久删除 / Ctrl+K 排除（20 条断言） |
| `tests/e2e-mail.mjs` | 邮件页端到端（72 条断言：加账号 / 列表 / 分页 / 正文 / 图片显示与隐藏 / 本地已读 / 筛选 / 键盘 / 文件夹 / 账号增删改 / 60 秒自动收信），自带假 IMAP 服务器 |
| `tests/fakeimap/server.mjs` | 假 IMAP 服务器（hoodiecrow-imap，120 封信 + 附件 + 追踪像素），**只装在 `tests/fakeimap/` 自己的 node_modules 里**，不是项目依赖 |
| `tests/fakeimap/mail-api-smoke.mjs` | 邮件 API 冒烟（58 条断言，含「打开邮件后服务器未读数不变」与代理字段校验） |
| `tools/screenshots/shots.mjs` / `tools/screenshots/shots-assets.mjs` / `tools/screenshots/shots-mail.mjs` | 批量截图 |
| `tools/seed-assets.mjs` | 按当前资产清单重建台账（一次性脚本） |

跑 UI 测试用本机已有的 Chromium：`C:\Users\you\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`（`playwright-core` 已装为 devDependency，没有下载新浏览器）。

## 常见问题

**端口被占（`EADDRINUSE 127.0.0.1:7788`）**
多半是上一个服务进程没退干净，用上面「停止服务」那段命令清掉再启动。

**把项目目录搬走 / 改名后启动报 `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`（拒绝访问）**
pnpm 的虚拟 store 路径变了，删掉重装即可：`Remove-Item .\node_modules -Recurse -Force` 然后 `pnpm install`（有本地缓存，很快）。

**改代码没生效**
前端改动要 `pnpm build` 再刷新；后端改动要重启进程（`pnpm start` 不是 watch 模式，开发时用 `pnpm dev`）。

**数据在哪，怎么搬走**
整个 `data/` 目录复制走即可；换机器连 `node_modules` 都不用带，`pnpm install` 重装就行。

**能放到公网 / 手机上访问吗**
不能直接放——**没有任何登录鉴权**，只监听 127.0.0.1。要用手机访问得自己加鉴权 + HTTPS 反代。

**价格统计为什么是 0**
价格和到期日默认是空的，只有填了才会进统计；另外目前总价是各币种数字直接相加，跨币种不换算，别当财务数据用。

## 技术栈与来源

- 后端：Hono + `@hono/node-server`，数据库用 Node 24 内置的 `node:sqlite`（`DatabaseSync`），所以不需要 `better-sqlite3` 之类的原生模块，装完就能跑。
- 前端：Vite 7 + React 19 + 手写 CSS（暖纸色 `#f6f3ec` / 强调色 `#b45309`），图标用 lucide-react，Markdown 用 marked + DOMPurify 清洗。
- 邮件：收信 / 解析用 [imapflow](https://github.com/postalsys/imapflow) + [mailparser](https://github.com/postalsys/mailparser)（同作者，纯 JS，无原生编译）。选它是因为 `fetch` 天生走 `BODY.PEEK`（不会写 `\Seen`）、登录时按服务器能力自动补发 `IMAP ID`（163 必需）、`getMailboxLock` 能直接以只读 `EXAMINE` 打开信箱。
- 设计参考：交互学 [usememos/memos](https://github.com/usememos/memos)（时间线便签、`#标签`、置顶），数据模型学 [sysadminsmedia/homebox](https://github.com/sysadminsmedia/homebox)（资产、位置、自定义字段、到期）。这两个项目各自只覆盖一半需求，且都是带账号体系的独立服务，所以本项目按需求自写，**没有拷贝它们的代码**。

## 文档

- 本文件：面向使用者的功能、启动、备份、API。
- [`AGENTS.md`](AGENTS.md)：面向后续开发者/agent 的工程约定、模块职责、踩过的坑（改代码前先读）。
- [`docs/adding-assets.md`](docs/adding-assets.md)：**加资产、加便签都看这一篇**（网页与 API 两条路、字段含义、标签规则、四类资产模板、批量脚本、常见错误、一页速查）。
- [`SNAPSHOT.md`](SNAPSHOT.md)：**自动生成**的当前数据全表（资产总表 + 每条详情 + 全部便签 + 标签/字段总览）。
  任何写操作后 1.5 秒内自动重写，手动 `pnpm snapshot`；**不要手改**。新会话想一眼看全现有数据就读它，不必查库。
- 跨项目的启停 / 备份 / 故障排查：[`../docs/runbook.md`](../docs/runbook.md)（工作区根 `D:\pinfolio\README.md` 是总入口）。
