---
id: bqj.pinboard
parent: bqj
summary: pinfolio 八页应用（便签/资产/观测/邮件/主机/服务/备份/设置），7788 单进程
when: 加便签/资产、改观测项、动 7788 代码或库、查运行状态
updated: 2026-11-14
---

# pinfolio

## 先读哪份

| 要做的事 | 读这个 |
|---|---|
| 改任何模块前 | [docs/architecture.md](docs/architecture.md)：文件职责、关键常量、别改成 X |
| 加资产 / 加便签 | [docs/adding-assets.md](docs/adding-assets.md)：字段表、模板、标签抽取、批量脚本 |
| 查 HTTP API | [docs/api.zh.md](docs/api.zh.md)：全部路由与 curl 示例 |
| 改观测项 / 引擎 / 出站代理 | `server/monitor/engine.ts` + `server/monitor/probes/{http,port,ssh,push}.ts`；策略与存储见 `server/monitor/{policy,store}.ts`；说明 [docs/features.zh.md](docs/features.zh.md) |
| 改邮件页 | [docs/mail-page-requirements.md](docs/mail-page-requirements.md) |
| 改服务部署 / 主机指标 | 服务页 `web/pages/ServicesPage.tsx`（样式 `web/styles/services.css`，模型与抽屉 `web/pages/services/{model,drawers}.tsx`）+ `server/services/{routes,store,edit,parse}.ts`；指标见 `server/metrics/*` + [tools/node-metrics/README.md](tools/node-metrics/README.md) |
| 备份 / 部署 / 迁移 | [docs/backup-restore.zh.md](docs/backup-restore.zh.md)/[docs/deploy.zh.md](docs/deploy.zh.md) |
| 查坑 / 查历史 | [docs/pitfalls.md](docs/pitfalls.md) / [docs/status-history.md](docs/status-history.md) |

## 目录

| 路径 | 是什么 |
|---|---|
| `server/` | Hono + `node:sqlite` 后端；入口 `server/index.ts`（55 行），静态托管 `server/static.ts`；`server/storage/` 是附件落盘/对象存储的驱动层（`S3_*` 齐了走 s3，否则本地） |
| `web/` | React + Vite 前端；页面 `web/pages/*Page.tsx`，样式 `web/styles/`（21 个 CSS，含 `index.css`） |
| `tests/` | `unit/` 84 个 `*.test.mts`（830 处 `test(`/`it(`）、18 套 `e2e-*.mjs`；见 [tests/README.md](tests/README.md) |
| `tools/` `desktop/` `deploy/` | 启停脚本与采集端 / Electron 套壳 / `Caddyfile`、`Dockerfile`、`docker-compose.yml` |
| `data/` | **个人数据**：`pinboard.db`、`secret.key`、`backups/`、`audit/`、`uploads/`（**本地**附件原件；走对象存储时这里没有文件）；不进版本库 |
| `dist/` `node_modules/` `logs/` `tmp/` | 构建产物/依赖/日志/临时 |

## 红线

1. **只监听 127.0.0.1 且必须登录**；远程访问另建反代 + HTTPS；`TRUST_PROXY=1` 才读 `X-Forwarded-*`，勿裸奔公网。
2. **邮件页只读**：不许出现一行 `STORE`；只读靠 `getMailboxLock(readOnly:true)` + `BODY.PEEK`，「本页已读」只写本地 `mail_local_read`。
3. **`tools/pinboard.ps1` 必须 UTF-8 带 BOM**（首 3 字节 `239,187,191`）；`run-pinboard.vbs` 必须 CRLF，否则 PowerShell 5.1 静默失败。
4. **观测引擎原生内化，勿再引回 Kuma**：探针直读 `pinboard.db`；`server/monitor/migrate.ts` 的 Kuma 导入器与 `server/backup` 的 `includeKuma`/`kuma-pass.txt` 仅历史兼容，**勿再启用**。
5. **测试数据绝不进真实库**：测试/手工验证都不许写 `data/pinboard.db`；`pnpm test:e2e` 自带隔离实例。
6. **卡片刻度与页面宽度都只有一份**：紧凑卡片尺寸写在 `web/styles/assets.css` 的 `.asset-grid.is-compact` / `.asset-card.is-compact`，观测台、资产页、服务页共用；内容宽度上限写在 `web/styles/tokens.css` 的 `--page-max`（1700px），`.page-wide` / `.page-notes` / `page-monitors` / `page-svc` / `mail-page` 都取它，备份页也挂 `.page-wide`，只有纯表单页（`.page` 980 / 设置页 860）故意窄。**别往各页自己的 css 里再复制一套数字**（曾因此三页三种尺寸、切页就变宽窄，2026-11-10 统一）。

## 当前状态（2026-11-14 更新）

- **本机不跑实例**：真数据实例在 os 容器 `pinfolio`（`/mnt/data/pinfolio`，公网 <https://pinfolio.raylx.top/>）；本机 7788 已停，只留代码与冻结的回滚数据。
- **版本**：`package.json` 0.5.1；`engines.node >=24`（本机 v24.16.0）；`packageManager pnpm@12.3.4`。
- **观测**：os 线上库 `monitors` 表 **14 项 / 5 组 / 8 启用 / 6 停用**（2026-11-12 复查；停用 = WorkBuddy 7863 / 7864 两项按用户要求暂停 + aws 19/20/22/26 四项）。`SNAPSHOT-MONITORS.md` 是 2026-11-10 08:52 的本机旧快照、不再是真源；日常以 <https://pinfolio.raylx.top/> 观测页或线上库为准。
- **主机指标**：4 台（oj/os/ox/aws）每 5 分钟经 SSH 拉取 `host_metrics`。
- **服务页（2026-11-14 重做）**：一张卡一个服务，整张卡就是这张服务的代表图——能打开的真管理页截真图（`web/public/covers/<id>.webp`），没有 UI 的后台服务用真实终端输出当封面；`web/pages/services/cover.tsx` 管四件事：`IMG`（id→封面文件）、`ZOOM`（真 UI 截图的放大倍率 + 焦点，往 logo 那边偏）、`WIDE`（3:1 横幅用模糊铺底居中完整显示）、`COVER_V`（换图后破缓存，每次发版自增）。卡面只留居中名字 + 一行说明，右上角一个编辑铅笔（悬停出现、点开抽屉），其余标签一概不放；顶部服务器标签是**真筛选**（点 `os` 只剩跑在 os 上的服务，括号数字是该机上的服务数），不再压暗其他卡片。台账 `data/services.json` 现为 **30 服务 / 39 部署 / 5 台机**（本机 6、oj 8、os 15、ox 3、aws 7；2026-11-14 逐台核过监听端口 / systemd 单元 / docker 容器）；每次写盘前自动备份到 `data/services-backups/`（留 10 份）。
- **页面骨架（2026-11-10 统一）**：内容宽度上限收成一条 `--page-max: 1700px`（`tokens.css`），便签 / 资产 / 观测 / 主机 / 服务 / 邮件 / 备份全部同宽（备份页挂 `.page-wide`），只有纯表单页保持窄（`.page` 980、设置 860）。宽屏断点 ≥1700px 时紧凑网格 5 列（原 6 列，避免卡被压到 267px）。实测 1500 视口三页网格 x=252 / 宽 1224 / 4 列 299px，1920 视口 5 列 321px。
- **演示模式（2026-11-10）**：公开演示站 <https://pinfolio.raylx.xyz/>（os 上的 `pinfolio-demo` 容器）设了 `PINBOARD_DEMO=1`，登录页自动填口令、主界面 topbar 上方挂一条「这是演示站 · 数据每天重置」横幅（`web/components/DemoBanner.tsx` + `server/demo.ts`）。`/api/auth/state` 是免鉴权接口，所以**这个变量不给普通实例设**，不设时 `demo` 恒为 `null`、前端一个节点都不渲染。**同一份构建的缺省外观按实例分**：这个变量还会让 `server/static.ts` 往 index.html 注入 `window.__PINBOARD_DEMO_PREFS__`（玻璃 + 折射开 + `wallpapers/street.jpg`，见 `server/demo.ts` 的 `demoBootPrefs()`），所以演示站开箱就是「折射玻璃 + 那张壁纸」，自用实例仍是暖纸优先、折射默认关。壁纸不进仓库（`web/public/wallpapers/` 被 `.gitignore` 排除），线上靠 compose 只读 bind mount 挂到 `dist/web/wallpapers`。部署细节见 `E:\services\os\README.md` 的 pinfolio 节。
- **Kuma 已删**：`E:\bqj\kuma` 不存在、3001 无监听、计划任务 `KumaObs` 不存在。
- **便签附件（2026-11-10）**：便签能存**任意文件**（图片 / 视频 / 音频 / PDF / 压缩包…），单文件 100 MB、单实例总量 15 GB（`ATTACHMENTS_QUOTA_BYTES`）。`server/storage/` 是驱动层：`S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` 五条齐了就走任意 S3 兼容对象存储（自用实例走 OCI `pinfolio` 桶，键 `att/<id>.<ext>`），缺一条回落 `data/uploads/`。上传必须带 `x-pinfolio-upload: 1`（CSRF 凭据），取回按 `kind` inline 或强制下载，**SVG / HTML 永不 inline**；对象存储里的附件不进备份 tar，桶要单独搬（见 `docs/backup-restore.zh.md`）。
- **邮件页（2026-11-12 落库 + 增量同步）**：列表/正文不再每次进页面全量拉 IMAP —— `mail_messages`（列表元数据）/ `mail_bodies`（正文 + 附件清单，不含字节）/ `mail_sync_state`（每账号-文件夹游标）三张表（迁移 v6），进页面读库；同步按 UID 集合 diff，只 FETCH 新增（每批 100），后台定时器每 5 分钟把各账号收件箱增量同步一轮（`startMailSync()`，`MAIL_SYNC=0` 关，`MAIL_SYNC_MINUTES` 调周期）。**只读红线不变**：`getMailboxLock(readOnly:true)` + `BODY.PEEK`，永不发 `STORE`，本地已读只写 `mail_local_read`。需求与决策见 `docs/mail-page-requirements.md` FR-25..27 / FR-30..31 / D7。
- **公开仓库**：<https://github.com/528085390/pinfolio>。

## 怎么用

```powershell
cd E:\bqj\pinboard
pnpm install          # 首次；pnpm 12 需 pnpm-workspace.yaml 的 allowBuilds 放行 esbuild
pnpm start            # 生产启动 → http://127.0.0.1:7788
pnpm dev              # API 7788 + Vite 5273（/api 代理到 7788）
pnpm build && pnpm start:dist  # 构建并跑 dist/server.js
pnpm test             # typecheck + 单测 + snippet；e2e 用 pnpm test:e2e
pnpm snapshot         # 重写 SNAPSHOT.md 与 SNAPSHOT-MONITORS.md
```

- 启停：双击 `start.cmd` / `stop.cmd`；或 `powershell -File tools\pinboard.ps1 start|stop|status|logs`。只杀包装进程会留 tsx 子进程占 7788。
- 配置：项目根 `.env`（`TRUST_PROXY=1`）；`PORT` / `HOST` / `PINBOARD_DATA` 可覆盖。数据默认 `data/`，主密钥 `data/secret.key` 丢了无法解密邮箱密码/指标源，须随备份走。
- 自动备份：每天 03:00 打包到 `data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz`，保留 14 份；`BACKUP=0` 关，`BACKUP_HOUR`/`BACKUP_KEEP`/`BACKUP_DIR` 可调。
- 改服务端重启；改前端 `pnpm build`；提交信息英文，注释/内部文档中文。

## 上级

[E:\bqj\AGENTS.md](../AGENTS.md) —— 工作区入口
