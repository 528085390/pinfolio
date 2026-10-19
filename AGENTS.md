# pinboard —— 便签夹（自用笔记 + 资产台账）

## 用途
本机单人用的「便签夹」：随手写 Markdown 便签、用 `#标签` 自动归类、置顶/搜索/归档，另有一个资产台账页登记设备/服务器/账号/域名（自定义字段、到期提醒、价格统计），便签可以钉到某条资产上。单进程单端口，数据只存本机 SQLite。

## 背景/来源
2026-10-19 由用户提出需求（"类似便签夹的项目，网页端，写东西订起来，加标签，再给个资产列表页"）后新建。同日用户要求整体迁出杂项工作区，目录从 `D:\projects\pinboard` 先移到 `D:\pinfolio_zc\pinboard`，2026-10-19 晚又随「两个项目合并」搬到 **`D:\pinfolio`**（与观测后端 `D:\kuma` 同属工作区根 `D:\pinfolio`；旧的 `D:\pinfolio_zc`、`D:\pinfolio_az` 两个根已删除），此后**不再受 `D:\projects\AGENTS.md` 的 R1–R7 约束**，本文件是唯一工程约定。调研过 usememos/memos（时间线便签，无资产）、sysadminsmedia/homebox（资产台账，无随手记）、blinko、flatnotes，结论是没有单项目同时覆盖两边，缝合两套 Go 应用会得到两套账号/两套标签且无法互链，因此按用户选择走**单应用自研**：交互抄 Memos、数据模型抄 HomeBox，代码全部本目录自写，无第三方运行时代码拷贝。

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
- `docs/screenshots/` —— README 引用的 6 张截图（notes / assets / asset-drawer / tag-picker / note-done / dark），从 `tmp/` 挑出来固化，不受 `tmp/` 清理影响。
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
- `server/index.ts` —— 端口 7788、`/api/health`、`/api/bootstrap`、`/api/search`、`/api/stats`、`/api/export`、`POST /api/seed`（仅空库时写 2 个字段定义 + 4 资产 + 4 便签）、静态文件托管 dist/web、notFound/onError。
前端（Vite 7 + React 19 + 手写 CSS，无 UI 框架）：
- `web/App.tsx` —— 侧栏导航（便签/资产/设置 + 计数）、主题切换（localStorage `pinboard-theme`，data-theme）、Ctrl/⌘+K 命令面板。
- `web/pages/NotesPage.tsx` —— 顶部 composer（Ctrl/⌘+Enter 保存，含「标签」弹层与新建标签）、置顶区/全部区、筛选 chips（全部/未完成/已完成/置顶/标签/＋新标签/已归档）、防抖搜索、行内编辑、归档、关联资产；**完成状态**：圆形对勾按钮或**双击卡片正文**都能切换（双击忽略按钮/链接/标签/编辑框，并清掉浏览器默认选中文字），切换走本地乐观更新、不重排列表，只有处于「已完成/未完成」筛选时才重新拉取。
  **归档模式（`archivedMode` state，2026-10-20 加）**：默认视图**没有硬删除**，卡片右上角是「归档」（`PATCH {archived:true}`，`archive()`）。点筛选行的「已归档」chip 进入**只读归档视图**：`load()` 带 `archived='1'`，隐藏 composer / 完成圆圈 / 置顶 / 编辑 / 标签 chips / 全部·未完成·已完成·置顶 chips，双击不再切完成，卡片只留「恢复」（`restore()` → `PATCH {archived:false}`）与「永久删除」（`remove()`，danger 样式，confirm「永久删除这条便签？不可恢复。」）。`toggleArchivedMode()` 会清掉 tag/pinnedOnly/doneFilter/editingId。归档条数由 `App.tsx` 传 `archivedCount={stats?.archived ?? 0}` 显示在 chip 上。**别把 DELETE 入口加回默认视图**——用户明确要求「删除改归档，只在已归档里允许永久删除」。
- `web/pages/AssetsPage.tsx` —— 统计卡（总数/在用/30 天内到期/已过期）、类型 chips、状态与标签筛选、卡片/表格两种视图。
- `web/pages/MonitorsPage.tsx` —— 观测台：四格统计 + 机器/状态筛选 + 搜索 + 卡片/表格视图 + 30 秒轮询；卡片含 40 段心跳色条、响应毫秒、24h 可用率、异常次数，标题带 ↗ 跳 `monitor-links.json` 配的管理页。手动点刷新才带 `?fresh=1`，轮询走后端缓存。
- `web/pages/SettingsPage.tsx` —— 外观、自定义字段、标签管理、导出 JSON、空库灌示例数据。
- `web/components/AssetDrawer.tsx` —— 资产详情抽屉（新建/编辑/删除、自定义字段按类型渲染、备注 Markdown、关联便签增删）。
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

## 迁移建议
项目已经独立在 `D:\pinfolio`，这个目录本身就能当仓库根。搬到别的机器/路径时带走：`server/`、`web/`、`tools/`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`.gitignore`、`start.cmd`、`stop.cmd`、`run-pinboard.vbs`、本文件；不要带 `data/`（个人数据）、`dist/`、`logs/`、`node_modules/`、`tmp/`。
需要改的硬编码：端口 7788（`server/index.ts` 与 `vite.config.ts` 代理）、数据目录 `data`（`server/db.ts` 的 DATA_DIR）。要给别人用需自行加登录鉴权与 HTTPS。

## 可清理项
- `tmp/` 整个目录 —— 开发期脚本与截图，可随时删（`docs/screenshots/` 已另存一份，删了不影响 README）：
  - 冒烟与端到端：`tmp/smoke.mjs`、`tmp/e2e.mjs`、`tmp/done-smoke.mjs`、`tmp/e2e-done.mjs`、`tmp/e2e-dblclick.mjs`、`tmp/e2e-filter.mjs`、`tmp/e2e-archive.mjs`
  - 截图：`tmp/shots.mjs`、`tmp/shots-assets.mjs`，产物 `tmp/shot-*.png`
  - 一次性数据脚本：`tmp/seed-assets.mjs`（按当前资产清单重建台账）
  - 排障残留：`tmp/inspect.mjs`、`tmp/dbg.mjs`、`tmp/dbg2.mjs`、`tmp/server.out.log`、`tmp/server.err.log`
- `logs/` —— 运行日志（`pinboard.log`，追加不轮转），可随时清空/删除；已进 `.gitignore`（`*.log`）。
- `dist/` —— 构建产物，`pnpm build` 可重建。
- `data/` —— 个人数据，删掉等于清库（谨慎）。
