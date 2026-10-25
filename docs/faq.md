# 常见问题

## 这是个什么东西

**一句话**：自托管的「便签 + 资产台账 + 观测台 + 只读邮件 + 主机指标 + 备份」六合一，一个 Node 进程、
一个 SQLite 文件、单用户。

**它和 Memos / HomeBox 有什么区别？** 那两个各自只做一半（时间线便签 / 资产台账），pinfolio 是两者的缝合，
再加上观测与邮件。设计参考了它们，但没有拷贝代码。

## 部署

**必须用 Docker 吗？** 不必须。三种跑法等价：`docker compose up -d`、裸机 `pnpm build && node dist/server.js`、
Windows 双击 `start.cmd`。见 [`deploy.md`](deploy.md)。

**能装在群晖 / 树莓派 / ARM 小主机上吗？** 能。镜像有 `linux/amd64` 和 `linux/arm64` 两份，
内存 256 MB 左右够用（单进程 + SQLite）。

**要额外的数据库吗？** 不要。数据在 `data/pinboard.db`（SQLite，WAL）。MySQL / PostgreSQL 只是**备份的目的地**，
不是运行依赖。

**端口 / 数据目录能改吗？** 能：`PORT`、`HOST`、`PINBOARD_DATA`。改了 `PINBOARD_DATA` 记得把旧数据搬过去。

**支持多用户吗？** 不支持，也不打算支持。设计上就是「一个人的实例」：一个密码、一份数据。
多用户要加 `user_id` 到十来张表并做隔离，等于另一个产品。

**手机上能用吗？** 能。界面在 390px 宽度下是底部标签栏布局，可以「添加到主屏幕」当应用打开（PWA）。
前提是能从手机访问到：要么内网直连，要么挂 HTTPS 反代，要么用 frp 之类的隧道（设置页有「公网访问」卡片）。

## 功能

**没装 Uptime Kuma 会怎样？** 只有「观测」这一页显示一张三步引导卡，其余六页完全正常。
探测本身是 Kuma 在跑，pinfolio 只是它的界面。

**能连上游原版 Kuma 吗？** 能。程序按 `policyJson` 字段识别是不是改造版 fork；上游原版只是不显示
「立即观测」这类 fork 专属入口。要强制指定用 `KUMA_FLAVOR=fork|upstream`。

**邮件为什么是只读的？** 这是刻意的：取信一律 `BODY.PEEK`，永远不会把邮件标成已读、也不会删信、移动。
「本页已读」只记在本地数据库里。想看别的文件夹就在下拉里切。

**便签和资产能互相关联吗？** 有一条可选的「便签钉到资产」（`notes.asset_id`），但两个页面是独立的，
不打算做更多联动。

## 数据与安全

**数据存在哪？** 全在 `PINBOARD_DATA`（默认 `data/`）：`pinboard.db` 是主库，`secret.key` 是加密主密钥，
`backups/` 是备份包，`audit/` 是每天的观测心跳 CSV。

**密码是明文存吗？** 登录密码是 scrypt 哈希；邮箱密码 / Kuma 口令 / 指标 token 用 AES-256-GCM 加密
（`enc:v1:…`），主密钥在 `data/secret.key` 或 `PINBOARD_SECRET`。

**`secret.key` 丢了怎么办？** 那些加密字段就解不开了：邮件账号要重新填密码，Kuma 口令要重新配，
指标源地址要重新填。其余数据（便签、资产、观测历史）不受影响。所以**备份要连 `secret.key` 一起**，
并且别把它和备份放在同一台机器上（两边一起丢就白加密了）。

**忘了登录密码？** 停服务，跑 `node --import tsx server/index.ts --reset-password`（或容器里同样的命令），
再启动，访问 `/setup` 重新设。

**能暴露到公网吗？** 能，但必须挂 HTTPS 反代，并且只用密码登录。它默认只听 `127.0.0.1`，
容器里设 `HOST=0.0.0.0`，反代后设 `TRUST_PROXY=1` 才能拿到真实 IP（登录限流按 IP 算）。

**为什么是 AGPL-3.0？** 这是一个可以整站跑起来的网络应用：如果谁改了它再当服务卖，改动应该回到社区。
自己用、自己改、自己部署都不受限制。

## 备份与升级

**备份怎么开？** 默认就开着：每天 03:00 打包到 `data/backups/`，保留 14 份。`BACKUP=0` 关掉，
`BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` 可调。也可以配 MySQL / PostgreSQL 当远端目的地。

**怎么恢复？** 见 [`backup-restore.md`](backup-restore.md)：整机换、只回滚库、从远端取回、只恢复 Kuma 四种场景。

**升级会丢数据吗？** 不会。迁移前会自动拍快照（保留 5 份），迁移失败就中止启动。步骤见 [`upgrade.md`](upgrade.md)。

**为什么观测历史还要单独归档？** Kuma 自己只留 365 天（`keepDataPeriodDays`），删了就没了。
`data/audit/heartbeats-YYYYMMDD.csv.gz` 是每天一份的原始心跳，不受备份保留策略限制，用来做长期审计。
