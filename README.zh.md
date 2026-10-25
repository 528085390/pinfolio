# pinfolio

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/unit%20tests-376%20passing-brightgreen)](#%E5%BC%80%E5%8F%91)

**中文** · [English](README.md)

一个跑在本机的小工具：**随手记便签**（写 `#标签` 自动归类）、**资产台账**（服务器 / 域名 / 账号 / 设备，带到期提醒和关联便签）、**观测台**（一眼看所有机器和服务）、**邮件**（多个邮箱合并成一个只读收件箱）。

一个进程、一个端口、一个 SQLite 文件，没有云端、没有账号、不用 Docker。打开 http://127.0.0.1:7788 就能用。

- 仓库：<https://github.com/528085390/pinfolio> —— 自用小工具，公开出来给需要的人参考，没发布到 npm。
- 运行方式：代码放哪都行，`pnpm install && pnpm build && pnpm start`
- 技术栈：Node 24 + TypeScript + Hono + `node:sqlite`；前端 Vite 7 + React 19 + 手写 CSS
- 数据：`data/pinboard.db`（只在本机）

## 截图

不随仓库发布：每张图都会带上作者真实的便签、邮箱和机器名。自己跑起来拍：

```powershell
node tools/screenshots/shots.mjs      # 便签 / 资产 / 设置 / 命令面板 / 暗色
```

产物写 `tmp/shot-*.png`（已 gitignore）。

## 功能

### 便签
- 顶部输入框直接写，**Ctrl / ⌘ + Enter** 保存，支持 Markdown。
- 正文里的 `#标签` 自动归类（中文标点也认：`。#杂事`），每个标签的颜色由名字算出。
- **完成态**：点卡片左边的圆圈，或**双击卡片本体**，标记完成；再点/双击取消。卡片原地变样（打勾 + 划线 + 变暗），不会跳到别处。
- 筛选：全部 / 未完成 / 已完成 / 置顶 / 按标签 / 新建标签，右侧带防抖搜索；置顶便签单独一段。
- **已归档**便签默认隐藏，筛选行的「已归档」chip（带数量）进只读视图，可以「恢复」或「永久删除」。Ctrl+K 全局搜索不会返回归档便签。

### 标签
- 内置 12 个：待办 / 想法 / 阅读 / 工作 / 学习 / 生活 / 灵感 / 重要 / 整理 / 运维 / 账号 / 购物。
- 输入框下的「标签」按钮弹出标签层，点一下插入 `#标签 `，不用记拼写；筛选行只显示在用的标签。**便签和资产共用同一套标签**——这也是两者放在同一个应用里的主要原因。

### 资产台账
- 类型：设备 / 服务器 / 账号 / 域名 / 其他；状态：在用 / 闲置 / 退役 / 丢失。
- 字段：名称、位置、厂商、序列号、价格 + 币种、购买日期、到期日期、链接、备注（Markdown），外加设置页定义的**自定义字段**（文本 / 数字 / 日期 / 链接 / 下拉 / 是-否）。
- 到期提醒：卡片和统计卡上显示「还剩 N 天 / 已过期」，30 天内到期的单独计数。
- 卡片 / 表格两种视图，按类型、状态、标签筛选（标签条显示在用标签），搜索覆盖名称、序列号、备注。

### 观测台
- 数据来自**本机的 Uptime Kuma**（默认 `http://127.0.0.1:3001`，状态页 `obs`）；Kuma 只当探测后端，界面在这里。
- 一屏看完：顶部四块统计（观测项 / 正常 / 异常 / 24h 可用率），下面按机器分组的卡片，每张带最近 40 次心跳、响应时间、24h 可用率和窗口内异常次数。30 秒自动刷新，卡片 / 表格可切换。
- 点卡片打开抽屉：改名、改频率、暂停 / 恢复、删除（手输名字二次确认）、**立即观测**；全部写回 Kuma。
- 完整行为、跳转管理页、立即观测配方：[`docs/features.zh.md`](docs/features.zh.md#观测台)。

### 邮件
- 任意 IMAP 服务器，多个邮箱合并成一个按时间排序的收件箱，账号 chip 上带未读数。
- **只读**：只用 `SELECT` / `SEARCH` / `FETCH(BODY.PEEK[])`，一行 `STORE` 都没有——打开邮件**不会**在服务器上标记已读。「本页已读」只记在本地 `mail_local_read`。
- 正文渲染在 **Shadow DOM** 里，保留邮件自带的排版，再过一遍 DOMPurify；每页 50 封，HTML / 纯文本一键切换，附件只列出可下载、不落盘。
- 远程图片默认加载，可在阅读区「隐藏图片」换成占位符；页面开着时每 60 秒静默收一次信。
- 细节（代理设置、163 / Gmail 的坑、缓存、安全处理）：[`docs/features.zh.md`](docs/features.zh.md#邮件只读合并收件箱)。

### 主机
- 6 台服务器的 **CPU / 内存 / 负载 / 磁盘 / 服务状态**汇总在一页：每台一张卡，四格读数 + 24 小时曲线 + 磁盘条 + 关注服务的 chip，`failed_units` 与在线状态一眼可见。
- 采集端在**每台服务器自己身上**（`tools/node-metrics/`，systemd timer 每 5 分钟跑一次、跑完即退，零常驻），数据推到一台公网机的 nginx 落盘，本机每 5 分钟拉回来存进 SQLite。
- 5 分钟没更新就标「N 分钟前」、超过 15 分钟算陈旧；「立即拉取」手动催一次。
- 细节（字段、安装、回滚、为什么不上 Prometheus）：[`docs/features.zh.md`](docs/features.zh.md#主机指标) 与 [`tools/node-metrics/README.md`](tools/node-metrics/README.md)。

### 备份
- **自动跑**：每天 03:00 打一个包到 `data/backups/`（`BACKUP=0` 关掉，`BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` 可调），保留 14 份，多的删最旧。
- **包里有什么**：库的一致性快照（`node:sqlite` 的 `backup()`，WAL 下不用停服）、**当天每个时间点的观测心跳 CSV**（`time,monitor_id,monitor_name,status,msg,ping`，审计用）、观测项定义、`data/*.json|txt`（含 `secret.key`）、根目录四个配置，以及逐成员 sha256 的 `manifest.json`；Kuma 全量库**只放在周日那份**里。
- **比 Kuma 活得久的审计**：每天的 CSV 同时在 `data/audit/` 留一份，**不受 14 份限制**（Kuma 自己只留 365 天）。
- **第二个目的地：远程数据库**（MySQL / PostgreSQL）：同一个包写进远端库的一行，上传后回读 sha256 校验，密码跟其它凭据一样加密落盘；页面里能测试连接、上传、取回、删除。
- **备份页**（侧栏第 7 项、手机底部第 7 个图标）：两个目的地各显示份数 / 上次时间 / 上次结果，可「立即备份」、下载、看清单、删除单份。
- 恢复步骤、`secret.key` 丢了怎么办、审计 CSV 怎么用：[`docs/backup-restore.md`](docs/backup-restore.md)。

### 全局
- **每页都有自己的地址**（`/notes` `/mail` `/assets` `/monitors` `/hosts` `/backup` `/settings`）：F5 不会跳回便签页，前进 / 后退可用，链接能直达。
- **Ctrl / ⌘ + K** 命令面板：搜便签、搜资产，或执行「新建便签 / 打开邮件 / 新增资产 / 打开观测台 / 打开主机 / 导出 JSON」。
- 主题：浅色 / 深色 / 跟随系统；设置页可把整库导出成 JSON，空库可一键写入示例数据。

## 快速开始

### 方式一：双击 `start.cmd`（推荐）
后台隐藏启动，等 `/api/health` 返回 200 后打开 http://127.0.0.1:7788。日志在 `logs/pinboard.log`。停服务双击 **`stop.cmd`**。

### 方式二：命令行

```powershell
cd <项目目录>
pnpm install     # 第一次
pnpm start       # http://127.0.0.1:7788
```

要求 Node ≥ 24（用到内置的 `node:sqlite`）和 pnpm 12。不用数据库服务、没有需要编译的原生模块。停服务用 `stop.cmd` 或 `.\tools\pinboard.ps1 stop`。

### 方式三：Docker

```bash
docker compose up -d     # http://127.0.0.1:7788，数据在命名卷 pinfolio-data 里
PINBOARD_DOMAIN=pin.example.com docker compose --profile tls up -d   # 顺带起 Caddy，自动 HTTPS
```

镜像 `ghcr.io/528085390/pinfolio`（amd64 + arm64）。数据全在容器的 `/data`（库、`secret.key`、备份）。反代、升级、回滚、环境变量、验收清单都在 [`docs/deploy.md`](docs/deploy.md)。

## 部署

| 方式 | 面向 | 入口 |
|---|---|---|
| Docker Compose | 大多数人 | `docker compose up -d`，可选 Caddy profile 自动 TLS |
| 裸机（Linux / macOS） | 不想装 Docker | `pnpm install && pnpm build && node dist/server.js` |
| 裸机（Windows） | 作者本机 | `start.cmd` |

三种都只监听回环地址，对外一律前置 HTTPS。应用自带单用户密码登录（首次访问进 `/setup`），但那不能替代 TLS。详见 [`docs/deploy.md`](docs/deploy.md)。

## 数据与备份

| 项目 | 说明 |
|---|---|
| 数据库 | `data/pinboard.db`（SQLite，WAL）—— 便签、标签、资产、自定义字段、关联、邮箱设置全在里面 |
| 备份 | 自动：每天 03:00 在 `data/backups/` 打一个包（保留 14 份），可另配 MySQL / PostgreSQL 远端库镜像。手动：备份页「立即备份」或 `node dist/server.js --backup`。恢复见 [`docs/backup-restore.md`](docs/backup-restore.md) |
| 审计归档 | `data/audit/heartbeats-YYYYMMDD.csv.gz` —— 每天一份观测心跳 CSV，长期保留（不受 14 份限制） |
| 备份环境变量 | `BACKUP=0` 关、`BACKUP_HOUR=3`、`BACKUP_KEEP=14`、`BACKUP_DIR=<data>/backups`、`KUMA_DB` 指定心跳来源 |
| 换位置 | 启动前把 `PINBOARD_DATA` 指到别的目录 |
| 观测项 | 从 Uptime Kuma 读，不在这个库里（`KUMA_URL` / `KUMA_SLUG` 可改指向） |
| 邮件 | IMAP 密码**加密落盘**（`enc:v1:…`），密钥在 `data/secret.key` 或 `PINBOARD_SECRET`；正文不落盘（内存缓存 10 分钟） |
| 主密钥 | `data/secret.key`（或 `PINBOARD_SECRET`，32 字节 base64）加密邮箱密码、Kuma 口令与指标 token。**丢了这些字段就解不开** —— 要跟库一起备份，绝不进版本库 |
| 重置 | 停服务，删 `data/pinboard.db*`，重新启动就是空库 |

## 目录结构

```
pinfolio/
├─ start.cmd / stop.cmd        启停（后台隐藏窗口）
├─ tools/                      pinboard.ps1（控制脚本）、screenshots/、seed-assets.mjs、chrome-path.mjs、streak-panel-trigger.cjs
├─ monitor-actions.json        「立即观测」的配方（按观测项 id / 名字匹配）
├─ monitor-links.example.json  观测项 → 管理页跳转表示例（复制成 monitor-links.json 再用）
├─ server/                     Hono 后端
│  ├─ index.ts                薄入口：挂路由、快照中间件、启动
│  ├─ db.ts、schema/、hydrate.ts
│  ├─ snapshot/               rows / markdown（纯函数）/ write
│  ├─ mail/                   types、parse、errors、pool、client、cache、rows、store、routes
│  ├─ kuma/                   client、source、payload、feed、recipe、runner、actions、links、backup、patch、routes
│  ├─ backup/                 core（纯函数）、tar、collect、local、remote、run、schedule
│  ├─ secrets/                crypto、key、migrate（AES-256-GCM 静态加密）
│  └─ routes/                 notes、assets、tags、fields、meta
├─ web/                        React 前端（pages/、components/、lib/、styles/、app/）
├─ tests/                      unit/（node:test）+ 15 套 Playwright e2e + fakeimap/
├─ docs/                       architecture、pitfalls、features、api、status-history……
├─ data/  dist/web/  tmp/  logs/   运行数据、构建产物、临时文件、日志
└─ SNAPSHOT.md                 自动生成的数据快照（不要手改）
```

每个文件的职责见 [`docs/architecture.md`](docs/architecture.md)。

## 开发

```powershell
pnpm dev        # 7788 跑 API（tsx watch）+ 5273 跑 Vite，/api 走代理
pnpm build      # 重新构建前端到 dist/web —— 改完前端必须跑
pnpm typecheck  # tsc --noEmit
pnpm start      # 生产模式，不是 watch：改完后端要重启
pnpm test       # typecheck + 376 条单测（不需要服务在跑）
pnpm test:e2e   # core + monitor 套件（需要 7788 和 Kuma 3001）
pnpm test:mail  # 邮件套件，对着隔离实例跑
```

e2e 用 `playwright-core` 驱动真实界面，浏览器用本机已装的 Chromium（可用 `CHROME_PATH` 覆盖）；邮件套件自带假 IMAP 服务器。分组与隔离实例的用法见 `tests/README.md`。

## 常见问题

**端口被占用（`EADDRINUSE 127.0.0.1:7788`）** —— 多半是上次留下的进程，用 `stop.cmd` 停掉再启动。

**改了代码没生效** —— 前端要 `pnpm build` 后刷新；后端要重启（`pnpm start` 不是 watch 模式）。

**能不能映射到公网 / 手机访问** —— 可以，但前面要挂 HTTPS：内置单用户密码登录（首次访问会让你设密码），默认仍只监听 127.0.0.1（容器里设 `HOST=0.0.0.0`），反代后面加 `TRUST_PROXY=1` 才会读 `X-Forwarded-*`。设置页的「公网访问」卡里有一种手机可达的接法。

**为什么价格合计是 0** —— 价格和到期日期默认是空的，填了才计入；而且合计是把各币种数字直接相加、不换算汇率，别当财务数据用。

## 技术栈与来源

- 后端：Hono + `@hono/node-server`，数据库用 Node 24 内置的 `node:sqlite`，所以没有 `better-sqlite3` 之类的原生模块要编译。
- 邮件：[imapflow](https://github.com/postalsys/imapflow) + [mailparser](https://github.com/postalsys/mailparser)，纯 JS；`fetch` 走 `BODY.PEEK`，永远不会写 Seen 标记。
- 设计参考：[usememos/memos](https://github.com/usememos/memos) 的便签时间线与 `#标签`、[sysadminsmedia/homebox](https://github.com/sysadminsmedia/homebox) 的资产 / 位置 / 自定义字段 / 到期。**没有抄它们的代码**；两者都是独立的多用户服务，覆盖面也不到本项目需求的一半。

## 文档

- [`docs/features.zh.md`](docs/features.zh.md)：各页完整行为（中文）；英文版见 [`docs/features.md`](docs/features.md)。
- [`docs/api.zh.md`](docs/api.zh.md)：完整 HTTP API（中文；英文 [`docs/api.md`](docs/api.md)）。
- [`CHANGELOG.md`](CHANGELOG.md)：改了什么、哪个版本改的。
- [`AGENTS.md`](AGENTS.md)：工程约定、模块职责和 45 条踩过的坑，**改代码前先读**。
- [`docs/adding-assets.md`](docs/adding-assets.md)：加资产 / 加便签的唯一手册。
- [`SNAPSHOT.md`](SNAPSHOT.md)：自动生成的数据快照，任何写入后 1.5 秒重写（不要手改）。
- `docs/` 其余（`architecture.md`、`pitfalls.md`、`status-history.md`、`mail-page-requirements.md`）是内部文档。

## 许可

[MIT](LICENSE)。随便用、随便改、商用也行，出事别找我。
