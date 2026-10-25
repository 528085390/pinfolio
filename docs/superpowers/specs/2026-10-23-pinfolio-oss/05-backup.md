# 05 · 自动备份与恢复

- 状态：**已实施**（2026-10-26，分支 `arch`；实施记录见文末）
- 依赖：01（`registerPreMigrate` 钩子）、03（远端库密码加密落盘）
- 被依赖：04（升级流程里的迁移前备份）、07（`docs/backup-restore.md`）

## 目标

装完就有人兜底，并且**观测历史能长期审计**：默认每天一次、两种目的地可各自开关、失败不影响服务、
在备份页能看见「有几份 / 上次什么时候 / 上次结果」并随时手动补一次。

## 两种目的地

| 目的地 | 存什么 | 配置 |
|---|---|---|
| 本机文件 | `data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz` | 无（默认开，`BACKUP=0` 关） |
| 远程数据库 | 同一份 tar.gz 的字节，写进 MySQL / PostgreSQL 的一行 | 类型 + 地址 + 库名 + 用户名 + 密码（加密存 settings）+ 表名 |

两个目的地互不影响：各自记 `last_ok_at` / `last_error`，一个失败另一个照跑，失败只记日志不抛给服务。

## 备份包内容

1. `pinboard.db` —— `node:sqlite` 模块级 `backup()` 做的一致性快照（WAL 下不停服；`DatabaseSync.prototype.backup` 是 undefined，必须用模块导出）。
2. `heartbeats-YYYYMMDD.csv.gz` —— **当天每个时间点的观测结果**（`time,monitor_id,monitor_name,status,msg,ping`），审计用，Excel / pandas 直接打开。数据来自 `KUMA_DB` 的 `heartbeat` 表。
3. `monitors.json` —— 观测项定义快照（id / 名字 / 分组 / 间隔 / URL），对着 CSV 看是谁。
4. `kuma.db` —— 全量快照，**只放在周日那份包里**（实测 11 MB → 3.26 MB gz；每天带会让 14 份涨到 55 MB）。
5. `data/*.json`、`data/*.txt` —— `metrics.json`、`kuma-pass.txt`、**`secret.key`**（丢了 03 的密文就解不开）。
6. 根目录 `monitor-links.json` / `monitor-actions.json` / `host-services.json` / `quick-links.json`（存在的才打）。
7. `manifest.json` —— 成员清单（名字 / 大小 / sha256 / 生成时间 / 实例 id），页面的「内容清单」直接读它。

实测：日常一份 ≈ 0.6 MB；带 Kuma 全量的那份 ≈ 3.9 MB。

## 长期审计归档

每天的 `heartbeats-YYYYMMDD.csv.gz` 同时在 `data/audit/` 留一份，**不受 14 份保留策略约束**。
理由：Kuma 的 `keepDataPeriodDays=365`，超过一年它自己删；要更久的审计只能靠这份。
体积约 270 KB/天 → 一年 ≈ 98 MB。

## 定时与手动

- 定时：进程内定时器，每天 03:00（启动时算出下一个 03:00）；`BACKUP=0` 关。
- 手动：页面「立即备份」、`node dist/server.js --backup`（裸机 `pnpm start -- --backup`）。
- 保留：本机 14 份、远端 14 行，多的按时间删最旧。
- 迁移前：`registerPreMigrate` 里先 `backup()` 一份到 `data/backups/pre-migrate-<旧版本>-<时间戳>.db`，保留 5 份。

## 远端库表

```sql
CREATE TABLE IF NOT EXISTS pinfolio_backups (
  id          VARCHAR(36) PRIMARY KEY,   -- randomUUID()（实例 id + 时间戳是 50 字符，装不进 36，见坑 42）
  instance_id VARCHAR(36) NOT NULL,
  filename    VARCHAR(128) NOT NULL,
  created_at  VARCHAR(32) NOT NULL,      -- ISO 串；MySQL 的 DATETIME 不吃 ISO，PG 又认，见坑 43
  size        BIGINT      NOT NULL,
  sha256      CHAR(64)    NOT NULL,
  payload     LONGBLOB / BYTEA NOT NULL
);
```

上传后回读 `sha256` 校验，不一致报错（不静默成功）。MySQL `max_allowed_packet` 默认 64 MB，
超了在页面直接说「超过远端限制」。

## 备份页（第 7 页）

侧栏第 7 项 + 手机底部栏第 7 个图标。两栏并排，每栏：份数、上次备份时间、上次结果（成功 / 报错原文）、
立即备份、删除单份、清空；每份可展开看 `manifest.json` 里的内容清单。

- 本机栏：下载、删除。
- 远端栏：类型 / 地址 / 库名 / 用户名 / 密码（保存后只显示「已设置」）、表名、测试连接、下载回本机。

## 恢复

- 本机：停服 → 解开 tar → `pinboard.db` 覆盖 `data/pinboard.db` → 删掉同目录 `-wal` / `-shm` → 起服。
- Kuma：`kuma.db` 覆盖 `kuma/data/kuma.db` 前先 `kuma.ps1 stop`。
- 远端：页面「下载回本机」落到 `data/backups/`，之后同上。
- 文档：`docs/backup-restore.md`（07 建结构，本块给内容）。

## 验收

- 单测：文件名、保留策略、tar 成员清单、CSV 转义（纯函数）。
- 手工：触发一次备份 → 解开 tar → sqlite 打开快照，便签数 = 线上；CSV 行数 = 当天心跳数。
- 远端：本机 MySQL 8.0（`127.0.0.1:3306` root）与 PostgreSQL 18（`127.0.0.1:5432` postgres）各建一个
  `pinfolio_backup` 库验收，不碰现有库；上传后回读 sha256 一致。
- 恢复演练：在隔离实例上覆盖一份备份，确认便签数、观测项、心跳 CSV 都对得上。

## 实施记录（2026-10-26）

与原设计的四处偏差，都是实测逼出来的：

1. **远端表 `id` 用 `randomUUID()`**：原设计「实例 id + 时间戳」= 36 + 1 + 13 = 50 字符，列是 `VARCHAR(36)`，MySQL 直接
   `Data too long for column 'id' at row 1`（坑 42）。实例归属放 `instance_id` 列。
2. **`created_at` 改 `VARCHAR(32)` 存 ISO 串**：MySQL `DATETIME` 报 `Incorrect datetime value`，而 PG 的 `TIMESTAMP` 认它（坑 43）。
   排序不受影响，页面直接 `new Date()`。
3. **心跳按 UTC 日边界查**：`heartbeat.time` 是 UTC 的 `YYYY-MM-DD HH:MM:SS.sss`，按本地日边界 `BETWEEN` 会查到 0 行（坑 41）。
4. **`pg` 的 `query()` 返回 `{ rows }`**，不是行数组——回读校验和「测试连接」都因此拿到空值（坑 44）。

另外补的：`BACKUP_HOUR`（默认 3）、`BACKUP_DIR`、`KUMA_DB` 三个环境变量；命令行 `--backup` 支持 `--local` / `--remote` 分开跑。

验收结果：本机包 455 KB / 11 个成员 / 快照 notes 4·assets 18·tags 27·settings 5；CSV 550 行 + 表头；
本机 MySQL 8.0.42 与 PostgreSQL 18.3 各传一份、回读 sha256 一致；远端「取回本机」与「删除」都通；下载文件与磁盘文件 sha256 一致。

## 不做

- S3 / WebDAV / rclone 之类的对象存储（用户明确选了「远程数据库」）。
- 增量备份、异地多副本。
- 备份包整体再加一层加密（字段级加密 03 已覆盖敏感值；远端库传输走 TLS 由用户配置决定）。
