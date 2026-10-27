---
id: bqj.pinboard
parent: bqj
summary: pinfolio 八页应用：便签 / 资产台账 / 观测台 / 只读邮件 / 主机指标 / 服务（部署关系）/ 备份 / 设置，7788 单进程
when: 加便签或资产、改观测项、动 7788 的代码与库、查服务健康与主机指标
updated: 2026-10-26
---

# pinfolio（自用笔记 + 资产台账）

## 用途
本机单人用的「pinfolio」：随手写 Markdown 便签、用 `#标签` 自动归类、置顶/搜索/归档，另有一个资产台账页登记设备/服务器/账号/域名（自定义字段、到期提醒、价格统计），便签可以钉到某条资产上。2026-10-21 又加了一页**只读邮件**：把 Gmail / QQ / 163 等多个信箱合成一个收件箱，点开即读，且**不改动服务器上的任何状态**。2026-10-22 再加一页**主机**：6 台服务器每 5 分钟 push 一份 CPU / 内存 / 磁盘 / 服务状态，这里汇总展示 + 24 小时曲线。单进程单端口，数据只存本机 SQLite。

## 背景/来源
2026-10-19 由用户提出需求（"类似便签夹的项目，网页端，写东西订起来，加标签，再给个资产列表页"）后新建。项目就在本目录（`server/` + `web/` 单进程单端口），观测后端是上层工作区里另一个进程（`kuma/`，只留 JSON API），两边代码/数据库/端口都不合并；本文件是唯一工程约定。调研过 usememos/memos（时间线便签，无资产）、sysadminsmedia/homebox（资产台账，无随手记）、blinko、flatnotes，结论是没有单项目同时覆盖两边，缝合两套 Go 应用会得到两套账号/两套标签且无法互链，因此按用户选择走**单应用自研**：交互抄 Memos、数据模型抄 HomeBox，代码全部本目录自写，无第三方运行时代码拷贝。2026-10-21 用户又提出「多个邮箱合成一个收件箱」（此前在 azfree 上试过 Cypht，嫌页面太重、跨境太慢，已整体拆除），需求定稿为 `docs/mail-page-requirements.md` v1.1，随后照该文档做出只读的 `/mail` 页。

## 内容清单

**改任何模块之前，先读 [`docs/architecture.md`](docs/architecture.md) 里对应那段** —— 那里有每个文件的职责、关键常量，
以及一堆「别改成 X」的约束（别把页面状态改回 `useState`、别把标签弹层的 `bottom: calc(100% + 8px)` 写死回去、
邮件页不许出现一行 `STORE`……）。下面只是速查表，用来判断「该动哪个文件」。

| 层 | 文件 | 一句话 |
|---|---|---|
| 文档 | `README.md`（英）+ `README.zh.md` / `AGENTS.md` / `SNAPSHOT.md`（自动生成）/ `docs/*` | 使用说明 / 工程约定 / 数据快照 / 专题：功能细节（`features.md` + `.zh`）、HTTP API（`api.md` + `.zh`）、架构、录入、邮件需求、中英双语（`i18n.md`）、坑 65 条、进展记录 |
| 启停 | `start.cmd` / `stop.cmd` / `run-pinboard.vbs` / `tools/pinboard.ps1` | 双击启停；ps1 必须 UTF-8 **带 BOM**、vbs 必须 CRLF，否则静默不执行 |
| 数据 | `server/schema/{core,mail,metrics,attachments}.ts` → `db.ts` → `hydrate.ts` | 建表 / 打开库 + `all/get/run` + 标签同步 / 批量拼关联 |
| 纯函数 | `server/tags.ts`、`dates.ts`、`mail/{proxy,params,rows}.ts`、`kuma/{redact,beat,patch,http,recipe,payload,quick}.ts`、`services/{parse,edit}.ts`、`attachments/core.ts`、`web/lib/paths.ts`、`web/lib/images.ts`、`web/lib/masonry.ts` | 无副作用、可直接单测（`tests/unit/`）；**新纯逻辑往这几处加** |
| 路由 | `server/routes/{notes,assets,tags,fields,meta,attachments}.ts`、`server/mail/routes.ts`、`server/kuma/routes.ts`、`server/services/routes.ts` | 各页 HTTP 面；写接口都要求 `Content-Type: application/json` |
| 观测 | `server/kuma/{client,source,payload,feed,recipe,runner,actions,links,quick,backup,meta}.ts` + `routes.ts` | socket.io 客户端 / 取数与两层缓存（`source.ts`）/ 列表纯拼装（`payload.ts`）/ 编排（`feed.ts`）/ 立即观测（`recipe.ts` 纯逻辑、`runner.ts` 执行、`actions.ts` 读配置）/ 跳转链接与快捷入口卡（`links.ts` / `quick.ts`）/ Kuma 库备份 / 风味与「配没配」判定（`meta.ts` → `GET /api/monitors/meta`）；PATCH 校验在 `patch.ts` |
| 邮件 | `server/mail/{types,parse,params,rows,cache,errors,pool,client,store}.ts` | 类型 / 摘要解析（纯函数）/ 路由参数（纯函数）/ 列表行拼装与排序（纯函数）/ 四层缓存 / 错误翻译 / 连接池 / 归并列表（**只读**）/ 两张表 CRUD |
| 密钥 | `server/secrets/{crypto,key,migrate}.ts` | 主密钥加载（`PINBOARD_SECRET` → `data/secret.key` → 首次生成 0600）/ AES-256-GCM 加解密 `enc:v1:…` / 启动时把明文凭据就地加密（幂等）；**只防备份泄漏，防不了进程被控** |
| 备份 | `server/backup/{core,tar,collect,local,remote,run,schedule,premigrate}.ts` + `server/routes/backup.ts` + `web/pages/BackupPage.tsx` | 纯函数（文件名 / 保留 / CSV 转义 / ustar）/ 取库快照与当天心跳 CSV / 落本机 / 写 MySQL·PostgreSQL（`mysql2`、`pg` 懒加载）/ 编排与定时（每天 03:00，`BACKUP=0` 关）；**心跳按 UTC 日边界查**（坑 41） |
| 部署 | `Dockerfile` / `docker-compose.yml` / `deploy/Caddyfile` / `docs/deploy.zh.md` | 多阶段镜像（build 装全量 → `pnpm build`；runtime 只 `pnpm install --prod` + `dist/`）；**前端包在 devDependencies**，别挪回 dependencies |
| 入口 | `server/index.ts`（66 行）、`server/static.ts` | 挂路由 + 快照中间件 / `dist/web` 托管与 SPA 深链 |
| 快照 | `server/snapshot.ts` + `server/snapshot/{rows,markdown,write}.ts` | 取数 / 渲染（纯函数，有单测）/ 写文件与 1.5 秒防抖；`pnpm snapshot` 立即重生成，隔离实例不写 |
| 指标 | `server/metrics/{config,hostmeta,onboard,services,store,poll,routes}.ts` + `server/kuma/{kuma-cli,provision}.ts` + `host-services.json` + `tools/node-metrics/` | 6 台采集端（bash + timer，零常驻）→ my-server nginx PUT 落盘 → 这里每 5 分钟拉回 `host_metrics`；**整条 JSON 存 `data` 列不拆字段**，`MIN_GAP_MS` 4 分钟别去掉；清单增/暂停/删走 `hostmeta.ts` 的纯函数 + `saveHosts()` 原子写回（保留 `base` 与未知键），服务 chip → 观测项的映射在 `services.ts`；「接入这台机器」的安装命令在 `onboard.ts`，加主机顺带建观测项在 `kuma/provision.ts` + `kuma-cli.ts`（走 kuma 的 `add`/`del`/`group-add`/`group-del` CLI） |
| 前端壳 | `web/App.tsx`、`web/app/*`、`web/lib/router.ts` | 组合层 + `useShell`（页面/主题/命令面板/异常通知跳转）+ `Sidebar`/`Topbar`/`titles.ts`；页面状态从 URL 取，**别改回 `useState`** |
| 页面 | `web/pages/*` + `web/pages/{notes,mail,monitors,hosts,services,assets,settings}/*` | 便签（useNotes/useComposer/NoteCard/Composer/FilterBar/useImageUpload/useMasonry）、邮件（useInbox/MailList/MailToolbar）、观测（useMonitors/Stats/Filters/Card/Table/status/QuickLinks）、主机（useHosts/HostCard/AddHostDrawer/OnboardModal/DeleteHostModal）、**服务（`model.ts` 纯逻辑 + `ServicesPage.tsx` 两种视角 + `services/drawers.tsx` 三个编辑抽屉；数据走 `GET /api/services` 读 `data/services.json`，部署支持 `autostart?: boolean` 开机自启动打标并展示右下角徽标，页面里能增删改（9 个写接口，写盘前自动备份），原来那份 sample.ts 静态样例已删）**、资产（useAssets/Stats/Filters/TagBar/Card/Table/meta）、设置（useSettings + 四张卡片 + fields.ts） |
| 组件 | `web/components/*` + `web/components/{monitor-drawer,asset-drawer,mail-reader,mail-account}/*` | 抽屉（`FormDrawer` 是共用壳；两个编辑抽屉各自拆成容器 + 分段/表单，纯逻辑在各自的 `form.ts`，观测抽屉的状态与接口调用在 `monitor-drawer/useMonitorDetail.ts`；命令面板的行拼装在 `command-palette/items.ts`）/ 心跳色条 / 异常通知栈 / 邮件阅读区（Shadow DOM，清洗规则在 `mail-reader/doc.ts`、`css.ts`）/ 邮箱账号抽屉（规则在 `mail-account/form.ts`） |
| 前端数据 | `web/lib/api.ts`（门面）+ `web/lib/api/*`（九域）+ `cx.ts`/`format.ts`/`monitors.ts` | 请求与类型 / 工具函数 / 告警轮询 |
| 双语 | `shared/i18n/{core.ts,en/*.ts}` + `web/lib/i18n/` + `server/i18n.ts` | **中文原文就是 key**，`t('保存')` → `Save`，缺条目回落中文；前端在 `web/App.tsx` 根部 `useLocale()` 订阅一次；服务端靠 `AsyncLocalStorage` + `Accept-Language`，import 必须带 `.js`；模块常量里存中文原文、渲染时过 `t()`（坑 62、63）；规矩见 [`docs/i18n.md`](docs/i18n.md) |
| 样式 | `web/styles/`（14 片，`index.css` 定层叠顺序） | 改样式先看 `index.css` 的 `@import` 顺序 |
| 测试 | `tests/`（`unit/` 495 条单测 + 17 套 e2e + `run.mjs` + `fakeimap/`） | `pnpm test` / `pnpm test:e2e`，用法见 `tests/README.md`；`node tests/run.mjs --only=ci` 是 CI 那一档（core + 引导卡，**不需要 Kuma / 邮箱 / 采集端**） |
| 工程化 | `LICENSE`（AGPL-3.0-or-later）/ `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md` / `.github/`（CI、release、dependabot、issue 与 PR 模板）/ `tools/ci-chrome-path.mjs` + `tools/release-notes.mjs` / `docs/{deploy,upgrade,faq,backup-restore}.md`（英）+ 同名 `.zh.md`（中）、`docs/release.md`（维护者发版手册，中） | CI 三个 job（test / e2e `--only=ci` / docker 只构建不推）；推 `v*.*.*` tag 出双架构镜像并建 Release（正文从 CHANGELOG 抽） |
| 工具 | `tools/i18n-scan.mjs`（找没包 `t()` 的中文，`--check` 可进 CI）、`tools/screenshots/`、`tools/node-metrics/`（另有本地私有的 `seed-assets.mjs`、`streak-panel-trigger.cjs`，不进版本库） | 两个截图脚本（都须在项目根跑）：`shots.mjs` 拍本机真实数据 → `tmp/`；`demo-shots.mjs` 拍灌了示例数据的隔离实例 → `docs/screenshots/`（README 那 7 张就是它出的，`BASE`/`PASSWORD` 环境变量指定目标，只许 127.0.0.1）。另含**服务器的采集端**（`build-install.mjs` 打成单文件安装器，托管在 `<站点根>/nm/`；安装/排错/回滚见该目录 `README.md`） |

## 怎么用
双击 `start.cmd`（后台隐藏启动；已在运行就只开浏览器），停止双击 `stop.cmd`；或手动：

环境：Node ≥ 24（用到内置 `node:sqlite` 的 `backup()`，本机 Node v24.16.0）、pnpm 12。无需数据库服务、无需编译原生模块；想用容器就跑 `docker compose up -d`（见 `docs/deploy.zh.md`）。

```powershell
cd <项目目录>
pnpm install          # 首次；pnpm 12 需 pnpm-workspace.yaml 的 allowBuilds 才放行 esbuild
pnpm start            # 生产模式：tsx server/index.ts，访问 http://127.0.0.1:7788
pnpm dev              # 开发模式：API 7788 + Vite 5273（/api 代理到 7788）
pnpm build            # 前端到 dist/web + 服务端打包到 dist/server.js（改前端后必须执行，server 直接读该目录）
pnpm start:dist       # 跑打好的 dist/server.js（= 容器里的启动方式）
pnpm typecheck        # tsc --noEmit
```

要点：
- **默认只监听 127.0.0.1，且必须登录**（`HOST` 可覆盖，容器里设 `0.0.0.0`）。要远程访问就走反代 + HTTPS，别把 7788 裸奔到公网。
- 密码忘了：`powershell -File tools\pinboard.ps1 stop` → `node --import tsx server/index.ts --reset-password` → `start`；给脚本发 API token：`node --import tsx server/index.ts --new-token <名字>`（明文只打印一次）。
- 配置写环境变量，或放进项目根的 `.env`（`pnpm start` / `pnpm start:dist` 走 `node --env-file-if-exists=.env` 自动读；仓库带 `.env.example`，`.env` 已 gitignore）。本机那份只有一行 `TRUST_PROXY=1`——frp 从公网进来，不开的话设备 IP 全是 127.0.0.1。
- 数据目录 `data/`（可用环境变量 `PINBOARD_DATA` 覆盖），库文件 `data/pinboard.db`（WAL 模式，同目录还有 -wal/-shm）。
- 凭据加密的主密钥在 `data/secret.key`（或环境变量 `PINBOARD_SECRET`，32 字节 base64）。**它丢了，邮箱密码 / Kuma 口令 / 指标源就都解不开**——备份要连它一起备，也绝不进版本库（见坑 40）。
- **自动备份**（2026-10-26 起，第 7 页「备份」）：每天 03:00 打一个包到 `data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz`，保留 14 份；`BACKUP=0` 关，`BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` 可调。包里 = 库快照 + 当天心跳 CSV + 观测项 + `data/*.json|txt`（含 `secret.key`）+ 根目录四个配置 + `manifest.json`；`kuma.db` 只在周日那份。命令行 `node dist/server.js --backup`（`--local` / `--remote`）。恢复见 `docs/backup-restore.zh.md`。
- 另可配 MySQL / PostgreSQL 当远端目的地（页面里填，密码加密存 settings），上传后回读 sha256 校验。
- 每天的 `heartbeats-YYYYMMDD.csv.gz` 同时在 `data/audit/` 留一份，**不受 14 份限制**（Kuma 只留 365 天，长期审计靠它）。
- 老办法仍然可用：停服务后复制 `data/`，或设置页「导出 JSON」。
- 改服务端代码必须重启 `pnpm start`（tsx 非 watch）；改前端需 `pnpm build` 后刷新。
- 端口被占（`EADDRINUSE 127.0.0.1:7788`）时先 `tools\pinboard.ps1 stop`（或双击 `stop.cmd`），它会连同 tsx 子进程一起结束并等端口释放；实在清不掉再用 `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*pinboard*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`。**只杀包装进程会留下 tsx 子进程继续占 7788。**
- 日志在 `logs/pinboard.log`（`tools\pinboard.ps1 logs` 看最后 40 行）。服务挂了先看它。
- 示例数据：空库时设置页有按钮，或 `curl -X POST http://127.0.0.1:7788/api/seed`（仅空库生效）。

## 状态

**当前状态（2026-10-26）**：7788 运行中，八页（便签 / 邮件 / 资产 / 观测 / 主机 / 服务 / 备份 / 设置）全部可用；**界面中英双语**（`feat/i18n`，默认跟随浏览器语言，设置 → 外观里手动切，服务端错误也跟着 `Accept-Language` 变，数据与日志不翻——见 `docs/i18n.md`）；
**便签能存图片**（2026-10-26 加）：输入框里粘贴 / 拖入 / 点「图片」选文件都行，行内编辑同样支持；正文里存的是 `/api/attachments/<id>` 的 Markdown（与部署前缀无关），图片真身 `data/uploads/` 随备份包走、孤儿 7 天回收；观测台心跳色条可逐拍悬停看时间与消息（悬停那一段会放大、把邻居挤开），筛选条下面还有一排「快捷入口」卡（`quick-links.json`，整卡外链、**不参与观测**；2026-10-26 起 Immich 挪进服务页，本机这份是空数组）；服务页只登记部署关系（`data/services.json`，每次请求热读、`SERVICES_FILE` 可换路径，页面里能增删改、写盘前自动备份到 `data/services-backups/`），不探测、不建观测项；主机页只展示 6 台服务器指标（每 5 分钟采集，24 小时曲线 + 磁盘条 + top 进程；**2026-10-26 起卡底不再画服务 chip**，部署关系归「服务」页），主机能在页面上加 / 暂停 / 删（`data/metrics.json` 原子写回，不用重启），加的时候还能顺手勾端口 / HTTP 站点 / systemd 服务观测项，保存后弹「接入这台机器」：一条命令装好采集端、立刻上报首帧。工程整理已收口——
服务端按职责拆分（`server/kuma/*`、`server/mail/*`、`server/routes/meta.ts`、`server/static.ts`），
前端 api 与样式分片，`tests/` 里有 495 条单测 + 17 套 e2e（`pnpm test` / `pnpm test:e2e`）。
已知长期红：本机 app-api `/healthz` 返回 503（上游账号问题，不是观测台的问题）。
未做：Gmail 跨页翻页（`hasMore:true` 的下一页）待信箱多于一页时复测；kuma 的 Windows Defender 排除项随旧路径失效，
需管理员重跑 `kuma\tools\add-defender-exclusions.ps1`。

**历史进展（2026-10-19 起，逐条记录）见 [`docs/status-history.md`](docs/status-history.md)**
—— 新增进展写那里，别往这里堆；这里只留「当前状态 + 截止日期」。

已知问题与坑（都踩过，勿回退）——**完整 65 条见 `docs/pitfalls.md`**（编号稳定；本文件与代码注释里的「见坑 N」都指那里的第 N 条，新增只往后加）。最要命的 5 条先记在这里：
1. **默认只监听 127.0.0.1 + 必须登录**：要远程访问就前置反代并开 HTTPS（`TRUST_PROXY=1` 才读 `X-Forwarded-*`），不要直接映射 7788（坑 6）。
2. **邮件页一行 `STORE` 都不许有**：只读靠 `getMailboxLock(readOnly:true)` + `BODY.PEEK`，「本页已读」只写本地 `mail_local_read`（坑 12）。
3. **`tools/pinboard.ps1` 必须 UTF-8 带 BOM**（`edit`/`write` 写出来的没有 BOM，改完补 `239,187,191`）、`run-pinboard.vbs` 必须 CRLF，否则脚本静默不执行（坑 10）。
4. **Kuma 的 `editMonitor` 是全量覆盖、`toJSON()` 少 `showMsg`/`manual_status`**：PATCH 必须取整 bean、只改要改的几个字段、从状态页补 `showMsg` 再回传，否则静默清空（坑 21）。
5. **观测台不能每个请求都 `?fresh=1`，`stale` 响应不能拿来判定恢复**：前者撞 Kuma 5 分钟缓存过期时的 5–30 秒卡顿，后者会把所有告警当「已恢复」全关掉（坑 9、坑 28）。


## 迁移建议
这个目录本身就能当仓库根。搬到别的机器/路径时带走：`server/`、`web/`、`tools/`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`.gitignore`、`start.cmd`、`stop.cmd`、`run-pinboard.vbs`、本文件；不要带 `data/`（个人数据）、`dist/`、`logs/`、`node_modules/`、`tmp/`。
需要改的硬编码：端口 7788（`server/index.ts` 与 `vite.config.ts` 代理）。端口/监听地址/数据目录都能用环境变量覆盖（`PORT` / `HOST` / `PINBOARD_DATA`）。登录鉴权已内置（首启 `/setup` 设密码，或 `PINBOARD_PASSWORD` 初始化）；HTTPS 交给前面的反代。
邮件功能另外依赖 `imapflow` + `mailparser`（纯 JS，已在 `package.json` 里，不需要额外服务）；`tests/fakeimap/` 的假 IMAP 服务器只是测试用，搬家不用带。
主机页的数据来自 `data/metrics.json`（拉取基址 + 6 台清单 + token，**含 token 所以没进版本库**）和 6 台机上的 `tools/node-metrics/`（`/etc/node-metrics.conf` 里的 URL 必须与它一致）；搬到别的机器时两边都要改，否则主机页只会显示「拉取失败」。`host-services.json`（服务 chip → 观测项的映射）要跟着走，缺了只是 chip 不能点，不会报错。
「接入这台机器」的命令由 `GET /api/hosts/:id/onboard` 生成（**token 只在这一个接口出现**，`/hosts` 列表与 `SNAPSHOT.md` 里都没有）；安装器托管地址优先读 `METRICS_INSTALL_URL`，其次 `PUBLIC_URL`，都没有就按请求来源推 `<origin>/nm/node-metrics-install.sh`；换托管机改环境变量即可。加主机时顺带建的观测项走 kuma 仓库的 CLI（`KUMA_CLI` 可覆盖路径，默认 `../kuma/tools/kuma-monitor.cjs`），所以 pinboard 与 kuma 的相对位置变了要设这个环境变量，否则观测项建不出来（主机照样能加）。

## 可清理项
- `tmp/` —— 只剩运行期日志与截图，可整目录删。测试在 `tests/`（用法见 `tests/README.md`），截图脚本在 `tools/screenshots/`（`shots.mjs` 拍真实数据进 `tmp/`，不进版本库；`demo-shots.mjs` 拍示例数据进 `docs/screenshots/`，随仓库发布），一次性数据脚本 `tools/seed-assets.mjs`。
- `logs/` —— 运行日志，可随时清空；已进 `.gitignore`（`*.log`）。
- `dist/` —— 构建产物，`pnpm build` 可重建。
- `data/` —— 个人数据，删掉等于清库（谨慎）。

## 设计约束（用户 2026-10-19 明确，别再改）

- 便签与资产是**两个纯粹独立的页面**，不需要产生任何关联：**不要再新增任何便签↔资产联动功能，也别主动提议**。
- `notes.asset_id` 与资产抽屉里的「关联便签」是既有的可选能力，**保留不动、不扩展**（当前 0 条便签使用）。

## 硬规矩：提交信息用英文（用户 2026-10-26 明确）

- **commit message 一律英文**（首行 < 70 字符，需要时带 `fix:` / `feat:` / `docs:` / `chore:` 前缀，理由写正文）。面向非中文使用者，`git log` 是他们了解这个项目的入口。
- 代码注释、`AGENTS.md`、`docs/pitfalls.md`、`docs/status-history.md` 这类内部文档继续中文，不用改。

## 硬规矩：测试数据不进真实库（用户 2026-10-23 明确）

- **任何测试、一次性脚本、手工验证，都不许往 `data/pinboard.db` 里写便签 / 资产 / 标签 / 会话。** 真实库只装用户自己的数据。
- `pnpm test:e2e`（`tests/run.mjs`）默认自己起隔离实例：用 `node:sqlite` 的 `backup()` 把真实库快照到 `%TEMP%\pinfolio-e2e-<时间戳>`，删掉 `password_hash` / `tunnel.*` / `sessions` / `api_tokens`，再起一个 `PINBOARD_DATA` 指向临时目录的私有实例，跑完连目录一起删。**真实库一个字节都不碰。**
- 单个 e2e 脚本必须设 `E2E_BASE`（`tests/env.mjs` 没有就直接退出）；`E2E_BASE` 指到 7788 时 runner 会警告。
- 测试需要的数据写在隔离库里（现建现删），**不要**在真实库留「测试便签」「E2E资产」这类残留。
- 清理污染记录要先跟用户的真实数据清单比对（条数 / 标题 / id），别直接 `DELETE FROM notes`。

