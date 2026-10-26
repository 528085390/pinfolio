# 更新日志

本项目的改动都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号在 0.x 阶段只表示「大改了一轮」，不承诺向后兼容——这是自用小工具，UI 和接口随时可能变。

## [未发布]

### 服务（新页面 · 第 8 页）

- **新增「服务」页**（`/services`，侧栏在「主机」与「备份」之间）：**只登记「谁部署在谁上面」，不做任何探测**——没有状态、心跳与统计，也不会去建 Kuma 观测项。
  两种视角：服务器视角一台机一张卡（卡里是这台机的每条部署：种类、服务名、路径、启动方式与端口、观测项），
  服务视角一行一个服务、右边排出它部署在哪些机上（点机名跳回服务器视角并闪那张卡）。
  默认「紧凑」一屏能看完全部部署（路径与启动方式走悬停提示），可切「详细」表格视图（表头 + 列宽写死，列不会错位）。
- **点名字三种行为**：挂了观测 → 跳到观测台并高亮那张卡；没观测但填了 `url` → 新标签页打开管理页；两样都没有 → 灰字、点了不动。
- **数据在 `data/services.json`**（`SERVICES_FILE` 可换路径，每次请求热读、改完刷新即生效）：`{ servers, services, deploys, monitors }` 四段，
  坏条目跳过、指向没登记的服务器或服务的部署丢掉；仓库里只带示例 `services.example.json`。只读接口 `GET /api/services`。
- **主机页去掉卡底的服务 chip**：主机页只展示主机指标，部署关系归服务页（`host-services.json` 与 `/api/hosts` 的 `unitMonitors` 保留，前端不再画）。
- 观测页「快捷入口」那条 Immich 图库挪进了服务页（登记为 os 上的一条部署，`http://168.110.34.103:2283`）；快捷入口卡机制保留，只是本机这份 `quick-links.json` 现在是空数组。

### 依赖

- 前端构建升到 **Vite 8**（Rolldown 内核）+ `@vitejs/plugin-react` 6：构建从约 1.4 秒降到 0.4 秒，
  产物 `index.js` 475 kB / `index.css` 58 kB，体积与之前基本一致。
  `@vitejs/plugin-react` 的大版本必须跟 vite 配对，所以这两个要一起升。
- `@types/node` 继续留在 24.x，跟 `engines.node >= 24` 对齐；Node 26 已实测兼容
  （`node:sqlite` 的 `backup` 仍是模块级函数），等它进 LTS 再一起切。

## [0.2.0] - 2026-10-26

### 备份（新页面 · 第 7 页）

- **每天 03:00 自动打一个包**，落在 `data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz`，保留最近 14 份；
  `BACKUP=0` 关掉，`BACKUP_KEEP` / `BACKUP_DIR` / `BACKUP_HOUR` 可改保留份数、目录与时刻。
  包里是：库快照（`node:sqlite` 的 `backup()`，WAL 下不用停服）+ **当天每个时间点的观测心跳 CSV**
  + 观测项定义 + `data/*.json|txt`（含 `secret.key`）+ 根目录四个配置 + `manifest.json`（逐成员 sha256）。
- **观测历史单独留档**：每天的 `heartbeats-YYYYMMDD.csv.gz` 同时进 `data/audit/`，**不受 14 份限制**——
  Kuma 自己只留 365 天，要更久的审计只能靠这份（约 270 KB/天，一年 98 MB）。
- **远程数据库备份**（MySQL / PostgreSQL 二选一）：同一份 tar.gz 写进远端库的一行，密码跟其它凭据一样加密落盘，
  上传后回读 sha256 校验；页面里能测试连接、上传、把某一份取回本机、删除。
- **备份页**（侧栏第 7 项，手机底部栏第 7 个图标）：本机与远端两栏，各自显示份数、上次时间、上次结果，
  「立即备份」「删除单份」「内容清单」「下载」；远端栏可改配置或断开。
- 迁移前自动存一份 `pre-migrate-<版本>-<时间戳>.db`（保留 5 份），迁移失败不回滚但备份在。
- 命令行也能跑：`node dist/server.js --backup`（或 `pnpm start -- --backup`），`--local` / `--remote` 只跑一边。

### 部署

- **三种跑法**：Windows 双击 `start.cmd`（本机，不变）／裸机 `pnpm install && pnpm build && pnpm start`／**`docker compose up -d`**（开源用户主路径）。
  容器镜像 `ghcr.io/528085390/pinfolio`，多阶段构建、以非 root 的 `node` 跑、只把 `/data` 当卷、端口默认只绑 `127.0.0.1:7788`。
- **可选自动 TLS**：`docker compose --profile tls up -d` 再起一个 Caddy，设 `PINBOARD_DOMAIN` 就自动签证书，只暴露 80/443（`deploy/Caddyfile`）。
- **服务端也打包了**：`pnpm build` 现在出 `dist/web/`（前端）+ `dist/server.js`（esbuild 单文件，197 KB），生产启动用 `node dist/server.js`（`pnpm start:dist`）；`tsx server/index.ts` 留作开发。
  顺带把前端包（react / marked / dompurify / lucide-react）挪进 `devDependencies`——运行时依赖只剩 7 个包，镜像里的 `node_modules` 从 300 MB 级降到 23 MB。
- **新增 `HOST` 环境变量**（默认仍是 `127.0.0.1`，容器里设 `0.0.0.0`）；`engines: node >= 24`、`packageManager: pnpm@12.3.4` 写进 `package.json`。
- **迁移前自动快照**：有 pending 迁移时先 `VACUUM INTO data/backups/pre-migrate-v<版本>-<时间戳>.db`（保留 5 份），快照失败就中止升级——宁可停在旧版本，也不留一个没有退路的半迁移库。
- 部署手册 `docs/deploy.md`（Docker / 裸机 / Windows / 环境变量全表 / 接不接 Kuma / 验收清单）。

### 配置

- **支持项目根的 `.env`**：`pnpm start` / `pnpm start:dist` 用 `node --env-file-if-exists=.env` 自动读；
  仓库带 `.env.example`（全量环境变量带注释），`.env` / `.env.local` 已进 `.gitignore`。
- **`TRUST_PROXY=1` 后设备 IP 会自己纠正**：`touchSession()` 发现 IP 变了立刻写库（不受 60 秒续期节流限制），
  之前经反代 / 隧道来的会话永远停在 `127.0.0.1`，现在下一次访问就更新成真实地址。

### 安全

- **凭据不再明文落盘**：邮箱密码、Kuma 口令、指标采集 token 改成 AES-256-GCM 密文（`enc:v1:<iv>:<tag>:<ct>`），
  密钥来自 `PINBOARD_SECRET`（32 字节 base64）或首次启动自动生成的 `data/secret.key`（0600）。
  升级后第一次启动会就地加密已有明文，日志打一行「凭据已就地加密」，之后幂等不再动。
  **`secret.key` 要跟数据库一起备份**：丢了这些凭据就解不开，只能在页面里重填；它绝不进版本库。
- 密码解不开时（换了主密钥 / 数据被改）账号列表直接提示「请点编辑重填一次」，不再假装成「没设密码」。
- **安全审查修了四处**（隔离环境里实测的，见 `docs/pitfalls.md` 48–51）：
  登录限流的客户端 IP 改成取 `X-Forwarded-For` 的**最后一段**（原来取第一段，配 nginx 的
  `$proxy_add_x_forwarded_for` 时每次换个头就是一条新 IP，限流形同虚设）；
  systemd 单元名加字符集白名单（它会被拼进 Kuma 的 `ssh_command` 在目标机上按 shell 跑）；
  「读私钥」只收真私钥（匹配 `-----BEGIN … PRIVATE KEY-----`）且限 64 KB；
  畸形 URL 编码回 400 而不是 500。
- **新增安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、
  `Permissions-Policy`、CSP 的 `frame-ancestors 'none'; base-uri 'self'`，HTTPS 下再发 HSTS。
  完整 CSP 暂时不加：会挡住子路径部署注入的 `window.__PB_BASE__` 与邮件里用户主动加载的远程图片。

### 主机

- **服务 chip 能跳观测台了**：`host-services.json` 里配到观测项的服务（nginx、MyApp 网关 / 管理端、xray、sing-box、caddy）
  右边多一个 ↗ 小箭头，点一下切到观测页、滚到那张卡并高亮 1.6 秒（不开详情抽屉）；没配到的仍是纯文字 chip，
  观测项被删或改名后自动退回纯文字。
- **主机页能加 / 暂停 / 删**：工具条「+ 添加主机」写 `data/metrics.json`（原子写回，保留 token 与未知键，**不用重启**）；
  卡片右上角 hover 出「暂停 / 恢复」与「删除」，删除要手输 id、默认连 30 天历史样本一起删。
  暂停的机卡片变虚线灰底、副标题算「N 台暂停」，既不算离线也不算陈旧，历史曲线保留。
- 刚加、还没装采集端的主机不再刷红条（卡片自己写「还没收到这台机的上报」）。
- **加主机能一条命令装好采集端**：「+ 添加主机」抽屉分三段（基本信息 / 采集端 / 观测项），保存后弹出「接入这台机器」——
  一条 `curl … && sudo bash …` 命令（复制即用）+「立即检查」+ 首帧状态。命令由 `GET /api/hosts/:id/onboard` 生成，
  **上报 token 只在这一个接口出现**，`/hosts` 列表与 `SNAPSHOT.md` 里都没有。
- **加主机时能顺手建观测项**：可勾端口探测 / HTTP 站点 / systemd 服务（走 SSH，默认不勾），保存时在观测台建同名分组与观测项
  （命名 `<组短名> / <服务名>`，id 记进 `data/metrics.json` 的 `monitors`）；**建失败不影响主机**，错误显示在页面上。
  彻底删主机时连观测项、空出来的分组与 `host-services.json` 里的映射一起回收（组里还有别的项时保留分组）。
- **采集端改成单文件安装器**：`tools/node-metrics/build-install.mjs` 把四件套内联成 `node-metrics-install.sh`，
  托管在 my-server 的 `/nm/`（不带 token）；新增 kuma CLI 的 `group-add` / `group-del` 子命令用于建/删分组。

### 观测台

- 心跳色条可以逐拍悬停：鼠标移到任意一段，弹出这一拍的时间（精确到秒）、状态、相对时间、响应毫秒、
  「第 i/N 拍」与心跳消息；卡片和详情抽屉都能用。提示框走 `createPortal` + `position: fixed`，
  不会被 `.content` 滚动容器裁掉（见坑 31）。
- 悬停的那一段会稍微变大（宽 + 高）、把左右邻居挤开，鼠标移开自动回位（120ms 过渡；靠 `flex-grow` 参与布局才挤得动，见坑 32）。
- **快捷入口卡**：筛选条下面多一排「快捷入口」，只跳转、**不参与观测**（没有状态、心跳与统计，点一下在新标签页打开那个服务）。
  配置在根目录 `quick-links.json`（每次请求热读，改完刷新页面即生效，不用重启），仓库里只带 `quick-links.example.json`；
  `url` 只认 http(s)，`name` 留空退回 host，同一 URL 只留第一条，`icon` 认 `image` / `globe`。当前是空数组（2026-10-26 起 Immich 图库挪进了服务页）。
- **没接 Kuma 也有引导**：观测页不再空白或报错，而是给一张三步引导卡（起 Kuma → 建 slug=obs 的状态页 → 填 `KUMA_URL` / `KUMA_SLUG` / `KUMA_PASS`），
  并写明「其余六页照常可用」。判定在 `GET /api/monitors/meta`：显式配了 `KUMA_URL`/`KUMA_PASS`，或者默认地址上读得到公开状态页，都算接上了。
- **兼容上游原版 Kuma**：按观测项 bean 里有没有 `policyJson` 认自家 fork（`KUMA_FLAVOR=auto|fork|upstream` 可强制，缓存 5 分钟，探测失败按上游算）；
  上游版下详情抽屉不渲染「立即观测」，其余照常。仓库自带的 fork 专属能力只在自家 fork 上出现。

### 工程化（开源）

- **许可证从 MIT 换成 GNU AGPL-3.0-or-later**：`LICENSE` 是全文，`package.json` 与 README 两版同步改；
  自用、修改、商用都可以，把改过的版本当网络服务对外提供要公开改动。版本号 `0.1.0` → `0.2.0`。
- **CI**（`.github/workflows/ci.yml`，push 到 master/arch/dev 与所有 PR）：三个 job —— `test` 跑 `pnpm test` + `pnpm build`；
  `e2e` 装 Playwright 的 chromium 后跑 `node tests/run.mjs --only=ci`；`docker` 用 buildx 真构建一次镜像（不推），
  镜像构建挂了在 PR 上就能看见。concurrency 会取消同分支的旧 run。
- **发版自动化**（`.github/workflows/release.yml`）：推 `v*.*.*` tag → buildx + QEMU 构建 `linux/amd64` + `linux/arm64`
  推到 `ghcr.io/528085390/pinfolio`（版本 tag + latest），再用 `tools/release-notes.mjs` 从 CHANGELOG 抽本版本段落建 GitHub Release，
  带 `-` 的 tag（如 `v0.3.0-rc.1`）自动标成 prerelease。人工清单在 `docs/release.md`。
- **测试加了 `ci` 分组**：`node tests/run.mjs --only=ci` = core 全套 + 新的 `tests/e2e-monitor-empty.mjs`（自起一个没接 Kuma 的实例，
  验证观测页出引导卡、`/api/monitors/meta` 判 `configured: false`），**不需要 Kuma / 邮箱 / 采集端**，CI 与贡献者都能跑。
  `tests/e2e-router.mjs` 里「观测页加载出来了」的判定从「有观测项」改成「有 `.page-monitors`」，没数据时也能过。
- **社区文件**：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`（Contributor Covenant 2.1）、`SECURITY.md`（走私密渠道、给支持版本）、
  issue 表单（bug / 功能）与 PR 模板、`.github/dependabot.yml`（npm 每周分组、actions 与 docker 每月；typescript / vite / react 大版本忽略）。
- **文档补齐三篇**：`docs/upgrade.md`（Docker / 裸机 / Windows 升级与回滚、迁移前快照怎么用）、`docs/faq.md`（部署形态、ARM、
  多用户、手机、忘记密码、为什么 AGPL 等 20 问）、`docs/release.md`（维护者发版手册）。README 两版更新 badge（CI / 许可 / 镜像 / 单测数）、
  单测数 376 → 390、坑数 → 47，并删掉「no accounts, no cloud, no Docker」那句过时描述。

## [0.1.0] - 2026-10-21

第一次公开。此前一直是本地自用，2026-10-21 集中做了一轮工程整理（行为未变）之后开放。

### 便签

- 时间线便签：随手写、置顶、双击进编辑、Ctrl/⌘+Enter 保存、Esc 取消。
- `#标签` 自动识别（中文标点、括号边界都认，URL 里的 `#anchor` 不算），标签颜色由名字哈希决定。
- 标签弹层：按剩余空间自动选向上/向下展开；点外部、Esc、滚动都自动收起。
- 搜索、按标签筛、只看置顶、只看待办/已完成。
- 删除改为归档，归档视图里才能永久删除。
- 便签可以钉在某条资产上，资产抽屉里能就地记一条。

### 资产台账

- 设备 / 服务器 / 账号 / 域名 / 其他五类资产，状态、位置、厂商、序列号、价格、购买日、到期日、URL、标签、备注。
- 自定义字段（文本 / 数字 / 日期 / 网址 / 下拉 / 布尔），字段可在设置页增删。
- 到期提醒：到期前 N 天进入「即将到期」，过期标红。
- 卡片 / 表格两种视图，标签条常显并带关联数，按数量降序。
- 关联便签列表、创建与更新时间、参考价统计。

### 观测台

- 接本机 Kuma 的 JSON API，把 19 个观测项按分组并排摆出来：状态、ping、24h 可用率、40 格心跳条、最近消息。
- 列表 5 秒缓存 + 30 秒轮询；Kuma 状态页有 5 分钟缓存，写操作后 15 秒内才带 `x-apicache-bypass`。
- 观测项详情抽屉：改名 / 介绍 / 频率 / 超时 / 重试，暂停与恢复，删除（要求手输名字，删前自动备份 Kuma 库，只留 5 份），立即观测（按 `monitor-actions.json` 的配方跑 kuma-check / http / command 三步）。
- 异常通知：新故障右上角弹出，恢复自动关，点通知跳到对应卡片并高亮。

### 邮件

- 多账号 IMAP 合并收件箱，**只读**：一律 `getMailboxLock(readOnly: true)` + `BODY.PEEK`，一行 `STORE` 都没有。
- 账号级 SOCKS5 / HTTP 代理（Gmail 直连被墙时用）。
- 自动收信：60 秒轮询，页面不可见时不跑，工具栏显示「数据截至」。
- HTML 正文用 Shadow DOM 隔离渲染并缩放适配，保留邮件自带样式；远程图片默认显示；附件可下载。
- 「本页已读」只写本地 `mail_local_read`，不改服务器 `\Seen`。
- 文件夹切换、关键词搜索、只看未读、J/K 键盘选信、分页。

### 其他

- 设置页：三档主题（跟随系统 / 亮 / 暗）、自定义字段管理、标签管理、导出 JSON、空库时写入示例数据。
- 命令面板 Ctrl/⌘+K：搜便签与资产，也能跳页面。
- `SNAPSHOT.md`：数据快照自动生成（写操作后 1.5 秒重写，也可 `pnpm snapshot`），方便新会话一眼看全数据。
- 单进程、单端口、单个 SQLite 文件；只监听 `127.0.0.1`、无鉴权，不做公网映射。

### 工程整理（2026-10-21，行为未变）

- 测试从 `tmp/` 归位到 `tests/`，加 `tests/run.mjs` 统一跑：`pnpm test`（typecheck + 单测 + 摘要断言）、`pnpm test:e2e`（core / monitor / mail 三组）、`pnpm test:mail`。
- 单测从 0 到 **259 条**（Node 自带 `node:test`，零新依赖）：把纯函数从「一 import 就有副作用」的模块里拆出来才测得动——标签解析、代理地址归一、Kuma 脱敏、心跳映射、PATCH 校验、配方挑选、快照渲染、邮件摘要解析、行排序、命令面板拼装、各页表单逻辑。
- 页面与组件拆分（都只搬代码，不改行为）：便签页、邮件页、观测页、资产页、设置页、App 外壳、两个编辑抽屉、邮件阅读区与账号抽屉、命令面板；编辑类抽屉共用 `FormDrawer` 外壳。
- 服务端按职责拆分：`kuma/{client,source,payload,feed,recipe,runner,actions,links,backup,patch,http,routes}`、`mail/{types,parse,params,rows,cache,errors,pool,client,store,routes}`、`snapshot/{rows,markdown,write}`、`schema/{core,mail}`。
- 前端 `lib/api.ts` 拆成六域 + 门面（调用点零改动），样式拆成 12 片按层叠顺序 `@import`。
- 文档：`AGENTS.md` 只留速查表与红线，坑清单 / 架构 / 进展历史分别搬进 `docs/pitfalls.md`、`docs/architecture.md`、`docs/status-history.md`。

### 修复

- 观测备份剪枝正则被转义吃掉，实际上从没删过旧备份。
- 邮件列表摘要残留 HTML 注释、`[image: …]` / `[cid: …]` 占位符与零宽字符。
- 标签弹层被 `.content` 裁掉一半（改成按剩余空间选展开方向）。
- 隔离实例（`PINBOARD_DATA`）会把项目根下的 `SNAPSHOT.md` 写坏，现在隔离实例不写快照。
- 邮件截图脚本的假 IMAP 路径失效，而且默认会删掉目标实例的邮箱账号（改成必须显式指定 `SHOT_BASE`）。

### 公开前处理

- 改名 **pinfolio**（此前内部叫「便签夹 / pinboard」）。
- Kuma 口令不再写死在代码里：读环境变量 `KUMA_PASS`，或本机 `data/kuma-pass.txt`。
- 文档里的真实服务器 IP 换成文档保留段（`203.0.113.x`），本机绝对路径改成通用写法，截图不进仓库。
- 重写 git 历史，去掉早期提交里的口令与 IP。
