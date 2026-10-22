# 01 · 迁移机制收敛与并发设置

- 状态：待实施
- 依赖：无
- 被依赖：02（新增三张表）、03（settings 存口令）、05（迁移前备份钩子）

## 问题

1. `server/db.ts:67-77` 用 `PRAGMA table_info` + `ALTER TABLE` 逐列探测，每加一列就要加一段；没有版本号，不知道库是哪一版。
2. `PRAGMA user_version` 被 `db.ts:80-86` 当作「预设标签已写」的 0/1 标记，与「schema 版本」语义冲突。
3. `busy_timeout = 0`：并发写立即 `SQLITE_BUSY`。

## 设计

### 版本载体

用 `PRAGMA user_version` 记录「已应用到的迁移版本」，配一个只追加的数组：

```ts
const MIGRATIONS: { version: number; up(db: DatabaseSync): void }[] = [
  { version: 1, up(db) { /* 现有表结构基线 + 预设标签 */ } },
  { version: 2, up(db) { /* settings / sessions / api_tokens，见 02 */ } },
]
```

- 每步一个事务：`BEGIN` → `up(db)` → `PRAGMA user_version = N` → `COMMIT`；抛错则 `ROLLBACK` 并向上抛。
- 只追加、不改旧步。

### v1 基线与老库归一

- v1 的内容 = 现有三个 schema 模块的全部 `CREATE TABLE IF NOT EXISTS`（tags / field_defs / assets / notes / note_tags / asset_tags / mail_accounts / mail_local_read / host_metrics）+ 预设标签初始化（把 `db.ts:80-86` 的逻辑挪进来，`user_version` 不再兼任标签标记）。
- 老库 `user_version = 0` 且 `notes` 表已存在 → 视为「未编号的 v1」：探测 `notes.done`、`mail_accounts.proxy` 是否存在，缺的补上，然后置 `user_version = 1`，不重复建表。
- 空库 → 直接跑 v1（建表 + 标签），再往下跑。

### 启动顺序

```
读密钥 → 开库 → busy_timeout → pre-migrate 钩子 → 迁移（每步一个事务）→ 起 HTTP
```

- 迁移失败：打印「已备份到 <路径>；恢复命令：<命令>」并 `exit(1)`，**不自动回滚**（半迁移的库比旧库更危险，且此时已有备份）。
- 01 只提供钩子注册表 `registerPreMigrate(fn)`，实现为空；05 把备份函数注册进来。

### 并发

开库后立刻 `PRAGMA busy_timeout = 5000`，`journal_mode = WAL` 保持现状。

## 验收

- 单测：空库迁移到最新版本后表齐全；老库（v0 + 已有列）归一到 v1 且不重复建表；重复启动幂等；`up()` 抛错时版本号不变、表结构回滚。
- 真实库副本：复制 `data/pinboard.db` → 跑一遍 → `PRAGMA user_version` = 最新版本，便签数、资产数与迁移前一致。
- `pnpm typecheck` + `pnpm test` 全绿。

## 不做

- 不引入 ORM / 迁移框架（drizzle-kit、knex、umzug），保持手写 SQL。
- 不做 downgrade（回退只能靠备份）。
