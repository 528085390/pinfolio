# 备份与恢复

> 设计见 `docs/superpowers/specs/2026-10-23-pinfolio-oss/05-backup.md`，代码在 `server/backup/*`。
> 这篇只讲**怎么用、怎么恢复**，改逻辑时两边一起改。

## 一句话

每天 03:00 自动打一个包落到 `data/backups/`，保留 14 份；可以另外配一个 MySQL / PostgreSQL 当远端目的地。
包里有库快照、**当天每个时间点的观测心跳 CSV**、配置和密钥文件——换机时解开就能接着跑。

## 包里有什么

| 成员 | 内容 | 什么时候有 |
|---|---|---|
| `pinboard.db` | 库的一致性快照（`node:sqlite` 的 `backup()`，WAL 下不用停服） | 每次 |
| `heartbeats-YYYYMMDD.csv.gz` | 当天全部观测心跳：`time,monitor_id,monitor_name,status,msg,ping` | 每次（当天没有心跳就是只有表头） |
| `monitors.json` | 观测项定义（id / 名字 / 分组 / 间隔 / URL），对着 CSV 看是谁 | 每次（Kuma 连不上就没有） |
| `kuma.db` | Kuma 全量快照 | **只在周日的包里**（约 3.3 MB gz） |
| `data/metrics.json`、`data/kuma-pass.txt`、`data/secret.key` | 主机采集配置 / Kuma 口令 / **主密钥** | 存在才打 |
| `monitor-links.json`、`monitor-actions.json`、`host-services.json`、`quick-links.json` | 项目根目录的四个配置 | 存在才打 |
| `manifest.json` | 每个成员的名字 / 大小 / sha256 + 生成时间 + 实例 id | 每次 |

日常一份约 0.5–0.7 MB，周日那份约 3.9 MB。页面上的「清单」读的就是 `manifest.json`。

## 自动与手动

- 自动：进程内定时器，每天 **03:00**（`BACKUP_HOUR` 可改）。`BACKUP=0` 关掉本机备份。
- 手动：备份页「立即备份」；或命令行

```powershell
node dist/server.js --backup            # 两个目的地都跑（按已配置的）
node dist/server.js --backup --local    # 只打本机包
node dist/server.js --backup --remote   # 只传远端库
```

裸机开发模式（没有 `dist/server.js`）用 `pnpm start -- --backup` 或 `node --import tsx server/index.ts --backup`。

环境变量：

| 变量 | 默认 | 作用 |
|---|---|---|
| `BACKUP` | `1` | `0` = 关掉本机定时备份（远端也一起不跑） |
| `BACKUP_HOUR` | `3` | 每天几点跑（0–23） |
| `BACKUP_KEEP` | `14` | 本机保留份数，多的删最旧 |
| `BACKUP_DIR` | `<data>/backups` | 备份包目录 |
| `KUMA_DB` | `../kuma/data/kuma.db` | 心跳 CSV 与 `kuma.db` 的来源 |

## 远端数据库

在备份页右下角「连接远程数据库」里填：类型（MySQL / PostgreSQL）、地址、端口、库名、用户名、密码、表名
（默认 `pinfolio_backups`，只允许字母数字下划线）。点「测试连接」会返回服务端版本，保存后密码按 03 的方式加密落盘。

表由程序自己建（`CREATE TABLE IF NOT EXISTS`），列：

```sql
id VARCHAR(36) PRIMARY KEY,  -- randomUUID()
instance_id VARCHAR(36),     -- 这台实例的 id（/api/health 里的 id）
filename VARCHAR(128),
created_at VARCHAR(32),      -- ISO 字符串，不是 DATETIME（见坑 43）
size BIGINT,
sha256 CHAR(64),
payload LONGBLOB / BYTEA
```

上传后会把 `payload` 读回来算 sha256 比对，不一致直接报错，不会静默成功。
MySQL 的 `max_allowed_packet` 默认 64 MB，包超过限制时页面会直说——去 `my.ini` 调大或改用本机文件。

## 恢复

### A. 整机换机（最常见）

1. 停服务：`stop.cmd`（或 `docker compose down`）。
2. 把备份包解开到新机器的项目目录：

   ```powershell
   tar -xzf pinfolio-20261026-0300.tar.gz -C <项目目录>
   ```

   它会覆盖 `data/pinboard.db`、`data/secret.key`、`data/metrics.json` 等，并把四个配置放回根目录。
3. **删掉旧的 WAL 残留**：`data/pinboard.db-wal` 与 `data/pinboard.db-shm`（如果存在）——不删的话 SQLite 会把旧 WAL 重放到新库上，直接坏库。
4. 起服务，用**备份那一刻的密码**登录（`sessions` 表也一起回来了，手机上原来的会话还有效）。

### B. 只回滚数据库（程序没换）

同上 1–4，但只解 `pinboard.db` 一个成员，别覆盖 `secret.key`——除非你是要连密钥一起回滚（那么邮箱密码也得跟着回滚，
否则解不开：密文是旧密钥加的）。

### C. 从远端库取回

备份页远端栏那一行的「取回」→ 落到 `data/backups/`，之后按 A 的第 1–4 步。

### D. 只恢复观测（Kuma）

周日的包里才有 `kuma.db`。恢复前先 `kuma\tools\kuma.ps1 stop`（**不能只停 pinfolio**），
覆盖 `kuma/data/kuma.db`，删掉 `kuma.db-wal` / `kuma.db-shm`，再 `kuma.ps1 start`。

## secret.key 丢了怎么办

`secret.key`（或 `PINBOARD_SECRET`）是邮箱密码 / Kuma 口令 / 指标 token 的加密密钥，**丢了这些字段就解不开**。

- 有备份包：解开包里那份 `data/secret.key` 放回去即可。
- 没有：删掉 `data/secret.key` 让程序重新生成（旧密文永远解不开），然后**在页面里重填**邮箱密码、
  Kuma 口令（或直接改 `data/kuma-pass.txt`）、主机采集地址。解密失败时账号列表会提示「请点编辑重填一次」，
  不会假装成「没设密码」。

## 观测历史（审计）

- 每个包里的 `heartbeats-YYYYMMDD.csv.gz` 覆盖**当天**的心跳；跨天要拼多份包。
- 同时每天在 `data/audit/heartbeats-YYYYMMDD.csv.gz` 留一份，**不受 14 份保留策略影响**——这是长期审计的来源。
  Kuma 自己的 `keepDataPeriodDays` 是 365 天，超过就删，所以别只依赖 Kuma。
- 用法：`zcat heartbeats-20261026.csv.gz | head`，或直接用 pandas / Excel 打开（UTF-8，字段里有逗号会加引号）。

## 验收一次备份

1. 备份页点「立即备份」，等状态变绿，记下文件名。
2. 点「清单」看成员数（应有 10–12 个）。
3. 解开到临时目录，用 node 打开快照对比条数：

   ```powershell
   node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('tmp/pinboard.db');console.log(d.prepare('select count(*) c from notes').get())"
   ```

   数字应与线上一致（线上查：`curl http://127.0.0.1:7788/api/notes` 的条数）。
4. CSV 行数 = 当天心跳数：`zcat heartbeats-*.csv.gz | wc -l`。

## 常见问题

- **备份跑失败但服务正常**：设计如此，失败只记日志与页面状态，不影响请求。看 `logs/pinboard.log` 里的 `[backup]` 行。
- **远端连接超时**：先确认数据库监听地址（MySQL 默认只监听 127.0.0.1；容器里要填宿主 IP 或 `host.docker.internal`）。
- **PostgreSQL 报 `relation "pinfolio_backups" does not exist`**：保存配置后先点一次「立即上传」，表是那时建的。
- **包越来越大**：周日那份带 `kuma.db`，正常；如果每天都是 4 MB，检查是不是 `kuma.db` 每天都在包里（只有周日该有）。
