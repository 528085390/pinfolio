# pinfolio 开源化改造设计（鉴权 / 密钥 / 移动端 / 部署）

- 日期：2026-10-23
- 状态：待复核（第 1、3、4 节已确认；第 2 节被驳回；第 5 节为提案，待复核）
- 分类：architectural（从「单人本机、无鉴权」变成「公网可部署、有身份边界」）
- 关联：`docs/architecture.md`、`docs/runbook.md`、`AGENTS.md`

## 1. 背景与目标

pinfolio 目前是单人本机工具：只监听 `127.0.0.1`，没有任何鉴权，密钥以明文存在库里和文件里。

目标（用户 2026-10-23 明确）：

1. 做成**别人能自部署的开源项目**；
2. 用户自己**多设备访问**（手机、另一台电脑）；
3. **手机上能正常用**。

形态定为 **单用户自托管**（不做多用户）：满足多设备需求，也是自托管工具的常见形态；多用户要 10 张表加 `user_id` 并做隔离，工作量 3–5 倍。

## 2. 非目标

- **不做多用户 / 注册 / 权限角色**。一个实例一个用户。
- **不把六个页面做成可选模块**（用户 2026-10-23 明确驳回：保留全部页面）。
- 不引入 better-auth 等鉴权框架（依赖重、按多用户设计），不靠反代 `basic_auth`（没有登出、设备管理、API token）。
- 不做「捆绑 Kuma fork 发布」，也不内置重写探测（观测后端仍是可选外部依赖）。
- 不改 Kuma 的探测逻辑与策略求值器。
- 本轮不动代码：本文件只是设计落盘。

## 3. 现状与约束（决定方案形状的事实）

| 事实 | 影响 |
|---|---|
| `server/index.ts:49` 写死 `hostname: '127.0.0.1'` | 容器里必须能改成 `0.0.0.0`，要新增 `HOST` 环境变量 |
| `server/` 全目录没有任何 `Authorization` / cookie / session 代码 | 鉴权从零加，没有历史包袱，也没有现成中间件 |
| 数据表只有 tags / field_defs / assets / notes / note_tags / asset_tags / mail_accounts / mail_local_read / host_metrics | 没有 `settings` 表，密钥、口令、开关无处可存，需要新增 |
| `mail_accounts.password` 是明文 TEXT 列；`data/kuma-pass.txt` 明文；`data/metrics.json` 里 base 带采集 token | 备份 / 库文件一旦泄漏即全泄；需要静态加密 |
| `server/db.ts:67-77` 用手写 `PRAGMA table_info` + `ALTER TABLE` 补列，`user_version` 只当「预设标签已写」标记 | 表结构演进靠约定，升级要收敛成有序迁移 |
| `/api/health` 曾返回数据库绝对路径（`server/routes/meta.ts`） | 已改成只返回 `{ ok: true }`；开源版不能再回显主机信息 |
| SQLite `busy_timeout = 0` | 并发写会立刻 SQLITE_BUSY；容器化后更该设成 5000 |
| WAL 下 `data/pinboard.db` 与 `-wal` 体积严重不匹配（348KB vs 4.1MB） | 热拷会丢数据，备份必须走 `backup()` 而不是复制文件 |
| Node 24.16 的 `node:sqlite` 导出里有 `backup()` 函数（`DatabaseSync.prototype.backup` 为 undefined） | 可以不停服做一致快照 |
| `package.json` 的 `start` 是 `tsx server/index.ts`，`tsx` 在 devDependencies | 镜像要么把 tsx 挪进依赖，要么把服务端打成单文件 |
| web 构建产物在 `dist/web`（`vite.config.ts:7`），由 `server/static.ts` 托管 | 镜像只需带 `dist/web` + 服务端产物 |
| 观测页依赖外部 Kuma（`KUMA_URL`，默认 `http://127.0.0.1:3001`） | 开源用户没有 Kuma 时，页面不能空转或报错 |

## 4. 决策记录

| 决策 | 选择 | 理由 | 被否掉的 |
|---|---|---|---|
| 产品形态 | 单用户自托管 | 多设备够用；多用户工作量 3–5 倍 | 多用户（10 张表 + 隔离） |
| 观测后端 | 可选外部集成，六页常驻 | 不替别人的 fork 背书；不重写探测 | 捆绑 fork 发布、内置重写探测 |
| 鉴权实现 | 自研 Hono 中间件 | 依赖轻、贴合单用户 | better-auth（重、多用户）、反代 basic_auth（无登出/设备/Token） |
| 部署主路径 | Docker 单容器 + 前置 Caddy 做 TLS | 自托管用户最熟；TLS 交给 Caddy | 裸机为主、K8s、多容器拆分 |
| Windows 启动 | 保留 `start.cmd` 作裸机/开发模式 | 用户本机继续用 | 只支持 Docker |
| 会话 | 30 天滑动 + 设备列表 | 手机不想天天登录，但能踢掉陌生设备 | 短会话（体验差）、无设备管理（不可控） |
| 密钥来源 | `PINBOARD_SECRET` 环境变量 **和** `data/secret.key` 都支持 | 容器用户喜欢 env，裸机用户喜欢文件 | 只支持一种 |
| 可选模块 | **驳回**，六页常驻 | 用户 2026-10-23 明确要求保留 | 按配置隐藏页面、侧栏裁切 |
| 开源许可证 | **AGPL-3.0** | 用户 2026-10-23 拍板：别人改完必须同样开源，防止拿去做闭源 SaaS | MIT、Apache-2.0 |
| 镜像发布 | `ghcr.io/<owner>/pinfolio` | 与仓库同源、免另注册、CI 用 GITHUB_TOKEN 即可推 | Docker Hub |
| 服务端打包 | esbuild 单文件 `dist/server.js` | 镜像里没有源码和 tsx，启动快、体积小 | 镜像带 tsx + 源码 |
| 自动备份 | **默认开启**，`BACKUP=0` 关闭 | 用户多半不会自己配 cron，「装完就有人兜底」是应有默认值 | 默认关、只写文档 |
| 历史清理 | 删库重建 | 旧对象只有删库能彻底清（实测旧 blob 仍可下载）；0 star / 0 fork / 0 issue，删了无损失 | 提工单、不处理 |

## 5. 第 1 节：鉴权与密钥（已确认）

### 5.1 身份模型

单用户、**无注册接口**。密码只有两个来源：

1. 首次访问 `/setup` 设置；
2. 启动时给了 `PINBOARD_PASSWORD`，直接以它初始化（跳过 `/setup`）。

密码哈希：`scrypt(N=16384, r=8, p=1)`，16 字节随机 salt，存 `settings` 表；比较用 `timingSafeEqual`。

### 5.2 新增数据表

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,          -- 随机 16B hex
  token_hash   TEXT NOT NULL,             -- sha256(cookie 值)
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ua           TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL,               -- 只存 hash，明文只在创建时显示一次
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
```

### 5.3 登录 / 会话

- 登录成功 → 生成 32 字节随机 token，cookie 名 `pb_session`，属性 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`。
- 库里只存 `sha256(token)`；每次请求校验哈希 + `expires_at`，命中则把 `expires_at` 顺延 30 天、更新 `last_seen_at`（滑动会话，写操作节流：同一会话 60 秒内不重复写库）。
- 登出：删当前会话行 + 清 cookie。

### 5.4 设备管理（设置页）

- 列出所有会话：UA 摘要、IP、最近活跃、创建时间；当前设备标「本机」。
- 单个踢下线、全部下线（保留当前会话）。

### 5.5 防爆破

- 同 IP 15 分钟内 5 次失败 → `429`，并进入指数退避（30s → 60s → 120s …，上限 15 分钟）。
- 成功登录清零；计数在内存里，同时落 `settings`（进程重启不丢）。
- 只对 `POST /api/auth/login` 生效。

### 5.6 CSRF

不引入 token。依赖两条：`SameSite=Lax`（跨站表单 POST 不带 cookie）+ 现有约定「写接口必须 `Content-Type: application/json`」（跨站表单发不出这个类型）。中间件对写方法强制校验该头。

### 5.7 机器访问（API token）

- 设置页生成 token（`pb_` + 32 字节 base64url），**明文只显示一次**，库里只存 hash。
- 请求头 `Authorization: Bearer <token>` 通过鉴权，不走 cookie、不需要 CSRF 校验。
- 用途：`tools/seed-assets.mjs`、e2e 脚本、将来的外部脚本。

### 5.8 路由边界

| 路径 | 是否公开 |
|---|---|
| 静态资源、SPA 壳（`/`、`/notes` …） | 公开（壳里没有数据） |
| `GET /api/health` | 公开，只返回 `{ ok: true }` |
| `POST /api/auth/login`、`GET /api/auth/state`、`POST /api/auth/setup` | 公开 |
| 其余 `/api/*` | **默认全锁**，未登录返回 `401`（前端跳登录页） |

实现：在 `server/index.ts` 的 `api` 上挂一个中间件，白名单放行，其余校验会话或 Bearer。

### 5.9 静态加密（密钥落库）

- 主密钥：`PINBOARD_SECRET`（32 字节 base64）优先；没有就读 `data/secret.key`；都没有则首次启动生成并写文件（`0600`）。
- 派生：`HKDF-SHA256(secret, info="pinfolio/v1")` → 32 字节 AES key。
- 加密：`AES-256-GCM`，随机 12 字节 IV，存储格式 `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`（版本前缀留给将来轮换）。
- 覆盖范围：`mail_accounts.password`、Kuma 口令（从 `data/kuma-pass.txt` 迁进 `settings`）、`data/metrics.json` 里的采集 token。
- 迁移：启动时扫描上述字段，遇到没有 `enc:v1:` 前缀的就地加密（幂等，可反复跑）。

**边界说明（已向用户说明）**：静态加密只防「备份 / 库文件泄漏」，防不了进程被控——能读内存或能执行代码的攻击者照样拿到明文。

### 5.10 反代信任

- 默认不信任 `X-Forwarded-*`；只有 `TRUST_PROXY=1` 时才读 `X-Forwarded-For`（真实 IP）和 `X-Forwarded-Proto`（决定 cookie 是否加 `Secure`）。
- HSTS、证书、HTTP→HTTPS 跳转全部交给 Caddy，应用层不碰。

## 6. 第 2 节：可选模块（已驳回）

用户 2026-10-23 明确：**不做成可选模块，六页保留**。因此取消：

- `/api/meta` 的能力判定与侧栏裁切；
- 按配置隐藏页面；
- `ALLOW_LOCAL_ACTIONS` 之类的开关。

保留下来、与本议题无关的三件事：

1. **清掉仓库里的个人痕迹**（已执行，见附录 A）；
2. **密钥加密落原位**：`data/metrics.json` 的 base、`data/kuma-pass.txt` 各写成 `enc:v1:...` 字符串，不动存储结构；
3. **Kuma 风味探测**：`KUMA_FLAVOR` 默认自动探测；连的是上游原版 Kuma 时，不渲染策略编辑器与「立即观测」，避免对不支持的接口发请求。

## 7. 第 3 节：移动端（已实现，待你验收）

### 7.1 断点与形态

| 宽度 | 形态 |
|---|---|
| > 900px | 左侧 228px 侧栏（现状） |
| 561–900px | 64px 图标栏（现状） |
| ≤ 560px | **底部标签栏**：六个图标 + 文字，高 52px + `safe-area-inset-bottom` |

内容区在 390px 下从「390 − 64 − 32 = 294px」拿回完整的 390px。

### 7.2 改动清单

| 文件 | 改动 |
|---|---|
| `web/styles/shell.css` | `.app` 高度用 `100dvh` 兜底（`100vh` 在前） |
| `web/styles/misc.css` | 新增 `@media (max-width:560px)` 块：侧栏 fixed 到底部、横向排列、隐藏 brand/foot、`.nav-item` 纵向排列且 `min-height:52px`、`.page` 底部留 80px + safe-area、toast 上移 |
| `web/styles/controls.css` | ≤560px 时输入框 `font-size:16px`（防 iOS 聚焦自动放大）、按钮最小高度 38px |
| `web/styles/overlay.css` | ≤560px 抽屉满宽、底部按钮让出 safe-area、模态 `max-height:92dvh` |
| `web/styles/hosts.css` | 网格 `minmax(min(330px,100%),1fr)`（原来 330px 在 390 宽下溢出，被 `overflow-x:hidden` 静默裁掉）；`.host-sum` 允许换行，避免中文被拆成「在 线」 |
| `web/styles/assets.css` | 网格 `minmax(min(292px,100%),1fr)`；≤560px 表格横向滚动、隐藏字段表的 key 列 |
| `web/styles/notes.css` | ≤560px 隐藏编辑器底栏提示 |
| `web/styles/mail.css` | ≤560px 邮件「列表 / 正文二选一」：`.mail-body.is-reading` 隐藏列表、显示正文；工具条 chips 独占一行横向滑动；读信时用 `:has()` 收起工具条拿回整屏 |
| `web/pages/mail/MailPage.tsx` | `<div className={M.sel ? 'mail-body is-reading' : 'mail-body'}>` + 正文顶部「返回列表」按钮 |
| `web/pages/mail/useInbox.ts` | 新增 `close()`（`setSel(null)`）并导出 |
| `web/pages/settings/FieldsCard.tsx` | 表格加 `data-fields` 类，供窄屏隐藏 key 列 |

### 7.3 验收方式

390×844、`deviceScaleFactor: 2`、`isMobile`、`hasTouch`，逐页断言 `document.documentElement.scrollWidth <= innerWidth` 且无元素右边界越界；邮件页实测「点开只显示正文、返回后回到列表」。

## 8. 第 4 节：部署与升级

### 8.1 三种跑法（同一套代码）

| 方式 | 面向 | 入口 |
|---|---|---|
| Windows 裸机 | 作者本机 | `start.cmd` → `127.0.0.1:7788`（不变） |
| Linux/macOS 裸机 | 想自己装的人 | `pnpm i && pnpm build && HOST=127.0.0.1 pnpm start` |
| Docker Compose | 开源用户主路径 | `docker compose up -d` + 前置 Caddy 自动 TLS |

### 8.2 镜像

- 多阶段构建：
  - `builder`：`node:24-bookworm-slim` + corepack 启用的 pnpm → `pnpm install --frozen-lockfile` → `pnpm build`（web）→ 服务端打包；
  - `runtime`：`node:24-bookworm-slim`，非 root 用户 `node`，`WORKDIR /app`，`VOLUME /data`，`EXPOSE 7788`。
- 选 Debian slim 而不是 alpine：`node:sqlite` 是内置模块，alpine 变体历史上出过编译差异。
- 服务端产物：**esbuild 打成单文件** `dist/server.js`（新增 `build:server` 脚本，`--platform=node --format=esm --external:node:*`），镜像里没有 tsx、没有源码。
- 健康检查：`GET /api/health`。
- 镜像标签：`ghcr.io/<owner>/pinfolio:vX.Y.Z` + `latest`；多架构 `linux/amd64` + `linux/arm64`（自托管用户里有 ARM 小主机）。

### 8.3 容器内布局

```
/data/                  ← 唯一卷
  pinboard.db
  secret.key            ← 没给 PINBOARD_SECRET 时自动生成（0600）
  backups/
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `7788` | 已有 |
| `HOST` | `127.0.0.1` | **新增**；容器里设 `0.0.0.0` |
| `PINBOARD_DATA` | `./data` | 已有；容器里 `/data` |
| `PINBOARD_PASSWORD` | — | 首启即设密码，跳过 `/setup` |
| `PINBOARD_SECRET` | 自动生成 | 静态加密主密钥（32B base64） |
| `PUBLIC_URL` | 请求来源 | 生成安装命令与绝对链接 |
| `TRUST_PROXY` | 关 | 前置反代时开 |
| `KUMA_URL` / `KUMA_USER` / `KUMA_PASS` | 本机默认 | 观测页数据源 |
| `METRICS_INSTALL_URL` | 按 `PUBLIC_URL` 推 | 主机指标安装命令 |
| `MONITOR_ACTIONS` / `MONITOR_LINKS` / `MONITOR_QUICK` / `HOST_SERVICES` / `KUMA_DIR` / `KUMA_CLI` / `KUMA_SLUG` / `PINBOARD_METRICS_BASE` / `PINBOARD_MAIL_PROXY` | 见代码 | 已有，保持兼容 |

### 8.4 反代与 TLS

```caddyfile
pin.example.com {
    reverse_proxy pinfolio:7788
}
```

只暴露 443；7788 只在 compose 内网可见，不映射到宿主机。HSTS 由 Caddy 出。

### 8.5 升级流程

```
docker compose pull && docker compose up -d
```

启动顺序固定：读密钥 → 开库 → **迁移（每个版本一个事务）** → 起服务。

- 迁移前自动 `backup()` 一份到 `data/backups/pre-migrate-<旧版本>-<时间戳>.db`，保留最近 5 份；
- 迁移失败 → 进程**退出并打印恢复命令**，不自动回滚（半迁移的库比旧库更危险）。

### 8.6 迁移机制收敛（技术债）

把 `server/db.ts:67-77` 的「手写探测 + ALTER」改成有序迁移：

```ts
const MIGRATIONS = [
  { version: 1, up(db) { /* 现有表结构基线 */ } },
  { version: 2, up(db) { /* 例如 settings / sessions / api_tokens */ } },
]
```

- `PRAGMA user_version` 记录已应用到的版本，每步一个事务，只追加、不改旧步；
- 老库兼容：老库 `user_version` 可能是 0 但表已经齐全 → 先跑「列存在性探测」归一到 v1 基线，再往下走；
- 与 `user_version` 现有语义（`db.ts:80-86` 的「预设标签已写」标记）冲突，需要把标签写入挪进 v1 迁移里。

### 8.7 备份

- 用 `node:sqlite` 的 `backup()`（WAL 下安全，不停服）；
- 每天 03:00 进程内定时器 → `data/backups/`，保留 14 份；**默认开启**，`BACKUP=0` 关闭，失败只打日志不影响服务；
- 备份内容：`pinboard.db` 的 `backup()` 快照 + `data/*.json|txt` + 根目录 `monitor-links.json` / `monitor-actions.json` / `host-services.json` / `quick-links.json`（存在的才打），打成 `pinfolio-YYYYMMDD.tar.gz`；
- 手动：`docker compose exec pinfolio node dist/server.js --backup`；
- 恢复：停服 → 覆盖 `pinboard.db` → 起服（写进 README 的「灾难恢复」）。

### 8.8 没配 Kuma 的观测页

六页常驻。`KUMA_URL` 未配置时，观测页显示一张引导卡（怎么起 Kuma、怎么填地址），不隐藏页面、不报错、不空转。

### 8.9 兼容边界

- Node ≥ 24（`node:sqlite` 硬要求），镜像固定 24 系列；
- 单用户单实例，不支持多进程共享一个库；
- 升级只保证 `N → N+1`。

## 9. 第 5 节：开源工程化（提案，待复核）

### 9.1 CI（`.github/workflows/ci.yml`）

- 触发：push 到 `main`、所有 PR；同一分支新 push 取消旧 run（`concurrency`）。
- 步骤：checkout → `pnpm/action-setup`（版本取 `package.json` 的 `packageManager`，**需先补这个字段**）→ `setup-node` 24 + pnpm 缓存 → `pnpm install --frozen-lockfile` → `pnpm typecheck` → 单测 + 片段 → `pnpm build`。
- e2e 分两档：
  - **CI 跑「无外部依赖」子集**（notes / assets / settings / 观测页空态），需要给 `tests/run.mjs` 加分组参数；
  - 依赖真实 Kuma / 邮箱 / 采集端的三套**只在本地跑**，README 写明。
- 超时 10 分钟；失败即红，不设 `continue-on-error`。

### 9.2 发布（`.github/workflows/release.yml`）

- 触发：push tag `v*.*.*`。
- 用 `docker/build-push-action` + buildx + QEMU 构建 `linux/amd64`、`linux/arm64`，推 `ghcr.io/<owner>/pinfolio`：版本 tag + `latest`；登录用 `GITHUB_TOKEN`（`packages: write`）。
- 同 workflow 从 `CHANGELOG.md` 抽出本版本段落 → 建 GitHub Release（不自动生成 notes，CHANGELOG 更可控）。
- 人工 checklist（写进 `docs/release.md`）：改版本号 → 写 CHANGELOG → 本地 `docker compose up` 冒烟 → 打 tag。

### 9.3 文档结构

README 只放「是什么 / 30 秒跑起来 / 截图 / 配置表 / 备份恢复 / 链接」，其余进 `docs/`：

| 文件 | 内容 |
|---|---|
| `docs/deploy.md` | Docker + Caddy、裸机、反代、环境变量全表 |
| `docs/backup-restore.md` | 自动备份机制、手动备份、灾难恢复 |
| `docs/upgrade.md` | 升级步骤、迁移失败怎么办 |
| `docs/faq.md` | 没配 Kuma 怎么办、邮件连不上、端口冲突、数据在哪 |
| `docs/architecture.md` / `docs/api.md` / `docs/adding-assets.md` | 已有，补英文摘要 |

README 顶部：一句话定位 + 三张截图（桌面 / 手机 / 观测页）+ badge（CI、License、镜像）。正文中文，顶部给一段英文摘要（开源引流需要）。

### 9.4 社区文件

| 文件 | 要点 |
|---|---|
| `LICENSE` | **AGPL-3.0** 全文（已定） |
| `CONTRIBUTING.md` | 本地开发（`pnpm dev`）、改后端必须补单测、改 UI 附截图、提交信息沿用现有「模块：做了什么」中文短句 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 官方文本 |
| `SECURITY.md` | 走私密渠道（GitHub Security Advisories），写清支持版本范围 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` / `feature_request.yml` | YAML 表单：版本、部署方式、日志、复现步骤 |
| `.github/pull_request_template.md` | 改了什么 / 为什么 / 怎么验的 |
| `.github/dependabot.yml` | npm 每周、actions 每月；dev / prod 分两组；`typescript`、`vite` 大版本忽略（要人工看） |

### 9.5 版本与分支

- SemVer；**1.0.0 的门槛**：鉴权 + 部署 + 备份三件齐全、文档齐、`docker compose up` 一把跑通；之前都是 0.x，破坏性改动升 minor。
- 分支：`main` 直推（单人维护），PR 走 CI；等有外部贡献者再开分支保护。
- CHANGELOG：Keep a Changelog 格式，中文条目，按「新增 / 修复 / 变更」分组。

### 9.6 仓库设置（一次性人工）

Description + 官网链接、Topics（`self-hosted` `notes` `dashboard` `sqlite` `hono` `react`）、About 挂截图、Discussions 先不开。

### 9.7 明确不做

- 覆盖率门槛（单人项目，噪音大于收益）；
- nightly 构建、自动合并 Dependabot；
- VitePress 文档站（`docs/` 够用）。

## 10. 已定事项与剩余动作

**已定**（2026-10-23 用户「按你推荐」）：镜像发 `ghcr.io`、服务端 esbuild 单文件、自动备份默认开、许可证 AGPL-3.0、GitHub 旧对象走「删库重建」。

**剩余动作**：

1. **删库重建**（需要用户在 GitHub 网页操作，仓库无 API token）：删掉旧仓库 → 新建同名空仓库（不勾 README / .gitignore / license）→ 本地 `git push --force origin main` 即可，远程当前 HEAD 为 `cb0b720`；
2. 第 5 节（本文件 §9）复核通过后，进入 `writing-plans` 拆实施计划；
3. 开工前把 `package.json` 补上 `packageManager` 与 `engines` 字段（CI 与镜像都依赖）。

## 11. 实施顺序（确认后按此排期）

1. 鉴权底座：`settings` / `sessions` / `api_tokens` 表 + `/setup` + 登录 + 中间件 + 设备管理 + 防爆破；
2. 静态加密 + 明文懒迁移（mail 口令、kuma 口令、metrics token）；
3. API token + 脚本改造（`tools/seed-assets.mjs`、e2e）；
4. 部署：`HOST` 变量、服务端打包、Dockerfile、compose + Caddy、健康检查；
5. 迁移机制收敛 + `busy_timeout=5000` + 备份定时器；
6. 观测页的 Kuma 风味探测与「未配置」引导；
7. 开源工程化（第 5 节定稿后）。

## 附录 A：仓库痕迹清理（已执行）

- 新增 `monitor-actions.example.json`、`host-services.example.json`；`.gitignore` 排除本机私有文件；
- `/api/health` 不再回显数据库路径；`METRICS_INSTALL_URL` / `PUBLIC_URL` 让安装命令可配置；
- 文档里的真实 IP、主机名、用户名、本机路径统一换成占位符；
- `git filter-repo` 重写全部历史（提交作者统一、`--replace-text` 覆盖 44 条字面量），强推覆盖远程 `main`；
- 重写后 `typecheck` / 327 单测 / 7 片段 / build / 15 套 e2e 全绿。
