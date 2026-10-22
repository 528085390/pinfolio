# pinfolio 开源化改造 · 总览

- 日期：2026-10-23
- 状态：分块设计，一块一 spec，按依赖顺序逐块实施
- 分支：`feat/oss-architecture`
- 说明：原先的单文件设计 `2026-10-23-pinfolio-oss-design.md` 已删除，内容拆成 8 个独立 spec；本文件只放全局信息与索引。

## 目标

1. 做成**别人能自部署的开源项目**；
2. 用户自己**多设备访问**（手机、另一台电脑）；
3. **手机上能正常用**（已完成，见 08）。

形态：**单用户自托管**。一个实例一个用户，不做多用户（多用户要给 10 张表加 `user_id` 并做隔离，工作量 3–5 倍）。

## 非目标

- 多用户 / 注册 / 角色权限。
- 六个页面做成可选模块（用户 2026-10-23 明确驳回，六页常驻）。
- 引入 better-auth 等鉴权框架，或靠反代 `basic_auth`（没有登出、设备管理、API token）。
- 捆绑 Kuma fork 发布，也不内置重写探测（观测后端仍是可选外部依赖）。
- 改 Kuma 的探测逻辑与策略求值器。

## 决策记录

| 决策 | 选择 | 理由 | 被否掉的 |
|---|---|---|---|
| 产品形态 | 单用户自托管 | 多设备够用；多用户工作量 3–5 倍 | 多用户 |
| 观测后端 | 可选外部集成，六页常驻 | 不替别人的 fork 背书；不重写探测 | 捆绑发布、内置探测 |
| 鉴权实现 | 自研 Hono 中间件 | 依赖轻、贴合单用户 | better-auth、反代 basic_auth |
| 部署主路径 | Docker 单容器 + 前置 Caddy | 自托管用户最熟；TLS 交给 Caddy | 裸机为主、K8s、多容器 |
| Windows 启动 | 保留 `start.cmd` 作裸机/开发模式 | 作者本机继续用 | 只支持 Docker |
| 会话 | 30 天滑动 + 设备列表 | 手机不想天天登录，但能踢陌生设备 | 短会话、无设备管理 |
| 密钥来源 | `PINBOARD_SECRET` 与 `data/secret.key` 都支持 | 容器用户喜欢 env，裸机用户喜欢文件 | 只支持一种 |
| 开源许可证 | **AGPL-3.0** | 别人改完必须同样开源，防止拿去做闭源 SaaS | MIT、Apache-2.0 |
| 镜像发布 | `ghcr.io/<owner>/pinfolio` | 与仓库同源、免另注册、CI 用 `GITHUB_TOKEN` 即可推 | Docker Hub |
| 服务端打包 | esbuild 单文件 `dist/server.js` | 镜像里没有源码和 tsx，启动快、体积小 | 镜像带 tsx + 源码 |
| 自动备份 | **默认开启**，`BACKUP=0` 关闭 | 「装完就有人兜底」应是默认值 | 默认关、只写文档 |
| 历史清理 | 删库重建（已执行） | 旧对象只有删库能彻底清 | 提工单、不处理 |

## 全局约束（实测事实，影响所有块）

| 事实 | 影响 |
|---|---|
| `server/index.ts:49` 写死 `hostname: '127.0.0.1'` | 容器里要能改成 `0.0.0.0`，新增 `HOST` 变量（见 04） |
| `server/` 全目录没有 `Authorization` / cookie / session 代码 | 鉴权从零加（见 02） |
| 数据表只有 tags / field_defs / assets / notes / note_tags / asset_tags / mail_accounts / mail_local_read / host_metrics | 没有 `settings` 表，密钥与开关无处可存（见 02） |
| `mail_accounts.password` 明文；`data/kuma-pass.txt` 明文；`data/metrics.json` 的 base 带采集 token | 备份泄漏即全泄（见 03） |
| `server/db.ts:67-77` 手写 `PRAGMA table_info` + `ALTER TABLE`，`user_version` 被标签初始化占用 | 表结构演进要收敛成有序迁移（见 01） |
| SQLite `busy_timeout = 0` | 并发写立即 `SQLITE_BUSY`（见 01） |
| WAL 下 `pinboard.db` 348KB 而 `-wal` 4.1MB | 热拷丢数据，备份必须走 `backup()`（见 05） |
| Node 24.16 的 `node:sqlite` 导出里有 `backup()` 函数（`DatabaseSync.prototype.backup` 为 undefined） | 可以不停服做一致快照（见 05） |
| `package.json` 的 `start` 是 `tsx server/index.ts`，`tsx` 在 devDependencies | 镜像要么带 tsx，要么打成单文件（见 04） |
| web 产物在 `dist/web`（`vite.config.ts:7`），由 `server/static.ts` 托管 | 镜像只需 `dist/web` + 服务端产物（见 04） |
| 观测页依赖外部 Kuma（`KUMA_URL` 默认 `http://127.0.0.1:3001`） | 没配 Kuma 时页面不能空转或报错（见 06） |

## 分块清单

| 编号 | 文件 | 内容 | 状态 | 依赖 |
|---|---|---|---|---|
| 01 | [01-migrations.md](01-migrations.md) | 迁移机制收敛 + `busy_timeout` | 待实施 | — |
| 02 | [02-auth.md](02-auth.md) | 鉴权、会话、设备管理、防爆破、API token | 待实施 | 01 |
| 03 | [03-secrets.md](03-secrets.md) | 静态加密（密钥落库、明文懒迁移） | 待实施 | 01、02 |
| 04 | [04-deploy.md](04-deploy.md) | `HOST`、服务端打包、Docker、Caddy、升级 | 待实施 | 01、02、03、05 |
| 05 | [05-backup.md](05-backup.md) | 自动备份、恢复、迁移前快照 | 待实施 | 01 |
| 06 | [06-kuma-integration.md](06-kuma-integration.md) | Kuma 风味探测、未配置引导 | 待实施 | — |
| 07 | [07-oss-engineering.md](07-oss-engineering.md) | CI、发布、文档、社区文件 | 待实施 | 02–06 |
| 08 | [08-mobile.md](08-mobile.md) | 移动端适配 | **已实现** | — |

## 实施顺序

```
01 迁移  →  02 鉴权  →  03 密钥  →  05 备份  →  04 部署  →  06 观测  →  07 工程化
```

- 迁移是地基：后面三块都要加表；
- 备份排在部署前：部署的升级流程依赖「迁移前自动备份」；
- 06 与 02–05 无依赖，可穿插做；
- 07 最后：功能齐了文档与 CI 才有意义。

## 每块的完成定义

1. 新增纯逻辑有单测，`pnpm typecheck` + `pnpm test` 全绿；
2. 涉及 UI 的补 e2e 或 390px 截图；
3. 相关文档同步（`docs/*`、`AGENTS.md`）；
4. 一个块一个提交（可以多个小提交），提交信息沿用「模块：做了什么」。

## 已完成项

- **移动端适配**（08）：底部标签栏、溢出修复、iOS 输入框 16px、`100dvh`、safe-area；15/15 e2e 绿。
- **仓库痕迹清理**：真实 IP / 主机名 / 用户名 / 本机路径全部换成占位符；`git filter-repo` 重写 63 个提交；删库重建后强推，旧对象已 422/404。
- **仓库 About**：英文 description + 11 个 topics。
