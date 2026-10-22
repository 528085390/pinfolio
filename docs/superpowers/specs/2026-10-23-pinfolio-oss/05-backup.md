# 05 · 自动备份与恢复

- 状态：待实施
- 依赖：01（`registerPreMigrate` 钩子）
- 被依赖：04（升级流程里的迁移前备份）

## 目标

装完就有人兜底：默认开启、每天一次、可关、失败不影响服务。

## 备份方式

- 用 `node:sqlite` 模块导出的 `backup()` 函数做快照（WAL 下安全，**不停服**）。注意 `DatabaseSync.prototype.backup` 是 `undefined`，要用模块级导出。
- 定时：进程内定时器，每天 03:00；启动后算出下一个 03:00。
- 关闭：`BACKUP=0`；失败只打日志，不抛给服务。

## 产物

`data/backups/pinfolio-YYYYMMDD.tar.gz`，保留 14 份（多的按时间删最旧）。内容：

1. `pinboard.db` 的 `backup()` 快照；
2. `data/*.json`、`data/*.txt`（`metrics.json`、`kuma-pass.txt` 等，存在的才打）；
3. 根目录 `monitor-links.json` / `monitor-actions.json` / `host-services.json` / `quick-links.json`（存在的才打）。

## 迁移前快照

在 01 的 `registerPreMigrate` 钩子里注册：迁移前先 `backup()` 一份到 `data/backups/pre-migrate-<旧版本>-<时间戳>.db`，保留最近 5 份。

## 手动与恢复

- 手动：`node dist/server.js --backup`（裸机 `pnpm start -- --backup`）。
- 恢复：停服 → 用 tar 里的 `pinboard.db` 覆盖 `data/pinboard.db`，删掉同目录 `-wal` / `-shm` → 起服。
- 文档：写进 `docs/backup-restore.md`（07 负责建文档结构，本块提供内容）。

## 验收

- 单测：文件名生成与保留策略（纯函数）；tar 成员清单。
- 手工：触发一次备份 → 解开 tar → 用 sqlite 打开快照，便签数 = 线上；在库副本上做一次完整恢复演练。
- 迁移前快照：造一个需要迁移的库，启动后确认 `pre-migrate-*.db` 存在且可打开。

## 不做

- 远程备份（S3 / rclone）、增量备份、异地复制。
- 归档本身不再加密（字段级加密已在 03 覆盖敏感值）。
