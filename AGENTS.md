# pinboard —— 便签夹（自用笔记 + 资产台账）

## 用途
本机单人用的「便签夹」：随手写 Markdown 便签、用 `#标签` 自动归类、置顶/搜索/归档，另有一个资产台账页登记设备/服务器/账号/域名（自定义字段、到期提醒、价格统计），便签可以钉到某条资产上。2026-10-21 又加了一页**只读邮件**：把 Gmail / QQ / 163 等多个信箱合成一个收件箱，点开即读，且**不改动服务器上的任何状态**。单进程单端口，数据只存本机 SQLite。

## 背景/来源
2026-10-19 由用户提出需求（"类似便签夹的项目，网页端，写东西订起来，加标签，再给个资产列表页"）后新建。同日用户要求整体迁出杂项工作区，目录从 `D:\projects\pinboard` 先移到 `D:\pinfolio_zc\pinboard`，2026-10-19 晚又随「两个项目合并」搬到 **`D:\pinfolio`**（与观测后端 `D:\kuma` 同属工作区根 `D:\pinfolio`；旧的 `D:\pinfolio_zc`、`D:\pinfolio_az` 两个根已删除），此后**不再受 `D:\projects\AGENTS.md` 的 R1–R7 约束**，本文件是唯一工程约定。调研过 usememos/memos（时间线便签，无资产）、sysadminsmedia/homebox（资产台账，无随手记）、blinko、flatnotes，结论是没有单项目同时覆盖两边，缝合两套 Go 应用会得到两套账号/两套标签且无法互链，因此按用户选择走**单应用自研**：交互抄 Memos、数据模型抄 HomeBox，代码全部本目录自写，无第三方运行时代码拷贝。2026-10-21 用户又提出「多个邮箱合成一个收件箱」（此前在 azfree 上试过 Cypht，嫌页面太重、跨境太慢，已整体拆除），需求定稿为 `docs/mail-page-requirements.md` v1.1，随后照该文档做出只读的 `/mail` 页。

## 内容清单

**改任何模块之前，先读 [`docs/architecture.md`](docs/architecture.md) 里对应那段** —— 那里有每个文件的职责、关键常量，
以及一堆「别改成 X」的约束（别把页面状态改回 `useState`、别把标签弹层的 `bottom: calc(100% + 8px)` 写死回去、
邮件页不许出现一行 `STORE`……）。下面只是速查表，用来判断「该动哪个文件」。

| 层 | 文件 | 一句话 |
|---|---|---|
| 文档 | `README.md` / `AGENTS.md` / `SNAPSHOT.md`（自动生成）/ `docs/*` | 使用说明 / 工程约定 / 数据快照 / 五篇专题（架构、录入、邮件需求、坑 29 条、进展记录） |
| 启停 | `start.cmd` / `stop.cmd` / `run-pinboard.vbs` / `tools/pinboard.ps1` | 双击启停；ps1 必须 UTF-8 **带 BOM**、vbs 必须 CRLF，否则静默不执行 |
| 数据 | `server/schema/{core,mail}.ts` → `db.ts` → `hydrate.ts` | 建表 / 打开库 + `all/get/run` + 标签同步 / 批量拼关联 |
| 纯函数 | `server/tags.ts`、`dates.ts`、`mail/proxy.ts`、`kuma/{redact,beat}.ts`、`web/lib/paths.ts` | 无副作用、可直接单测（`tests/unit/`）；**新纯逻辑往这几处加** |
| 路由 | `server/routes/{notes,assets,tags,fields,meta}.ts`、`server/mail/routes.ts`、`server/kuma/routes.ts` | 各页 HTTP 面；写接口都要求 `Content-Type: application/json` |
| 观测 | `server/kuma/{client,feed,actions,links,backup}.ts` | socket.io 客户端 / 抓取缓存 / 立即观测配方 / 跳转链接 / Kuma 库备份 |
| 邮件 | `server/mail/{types,parse,errors,pool,client,store}.ts` | 类型 / 摘要解析（纯函数）/ 错误翻译 / 连接池 / 归并列表与缓存（**只读**）/ 两张表 CRUD |
| 入口 | `server/index.ts`（62 行）、`server/static.ts` | 挂路由 + 快照中间件 / `dist/web` 托管与 SPA 深链 |
| 前端壳 | `web/App.tsx`、`web/lib/router.ts` | 侧栏/主题/命令面板；页面状态从 URL 取，**别改回 `useState`** |
| 页面 | `web/pages/*` + `web/pages/notes/*` + `web/pages/mail/*` | 便签（useNotes/useComposer/NoteCard/Composer/FilterBar）、邮件（useInbox/MailList/MailToolbar）、资产、观测、设置 |
| 组件 | `web/components/*`（`FormDrawer` 是两个编辑抽屉的共用壳） | 抽屉 / 心跳色条 / 异常通知栈 / 邮件阅读区（Shadow DOM） |
| 前端数据 | `web/lib/api.ts`（门面）+ `web/lib/api/*`（六域）+ `cx.ts`/`format.ts`/`monitors.ts` | 请求与类型 / 工具函数 / 告警轮询 |
| 样式 | `web/styles/`（12 片，`index.css` 定层叠顺序） | 改样式先看 `index.css` 的 `@import` 顺序 |
| 测试 | `tests/`（`unit/` 70 条单测 + 14 套 e2e + `run.mjs` + `fakeimap/`） | `pnpm test` / `pnpm test:e2e`，用法见 `tests/README.md` |
| 工具 | `tools/screenshots/`、`tools/seed-assets.mjs` | 截图脚本（须在项目根跑，产物进 `tmp/`）、批量灌数据 |

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
前端 api 与样式分片，`tests/` 里有 70 条单测 + 14 套 e2e（`pnpm test` / `pnpm test:e2e`）。
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

