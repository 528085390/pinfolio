# 升级

一句话：**Docker 就 `pull` + `up -d`，裸机就 `pnpm install && pnpm build` 再重启**。数据库迁移由程序自己做，
迁移前会自动拍一张快照；迁移失败就中止启动，不会留一个半迁移的库。

## 升级前

1. 确认最近的备份是好的：备份页能看到「上次备份时间」和份数；不确定就点一次「立即备份」。
   备份包里有 `data/secret.key`，恢复时要用（见 [`backup-restore.md`](backup-restore.zh.md)）。
2. 看一眼 [`CHANGELOG.md`](../CHANGELOG.md) 里目标版本那段，尤其是带「破坏性」字样的条目。
3. 记下当前版本（`package.json` 的 `version`，或镜像 tag），回滚时要指定它。

## Docker Compose

```bash
cd <你的 compose 目录>
docker compose pull          # 拉新镜像（默认 latest）
docker compose up -d         # 重建容器，/data 卷原样保留
docker compose logs -f pinfolio   # 看启动日志：迁移前快照 / 凭据加密 / 端口
```

固定版本而不是跟 latest：

```bash
PINBOARD_TAG=v0.2.0 docker compose up -d
```

回滚（数据也一起回滚，见下面的「迁移与回滚」）：

```bash
PINBOARD_TAG=v0.1.0 docker compose up -d
```

## 裸机（Linux / macOS）

```bash
cd <pinfolio 目录>
git fetch --tags && git checkout v0.2.0    # 或者解压新版本的压缩包
pnpm install --frozen-lockfile
pnpm build                                  # 前端 dist/web + 服务端 dist/server.js
systemctl restart pinfolio                  # 或者你自己用的进程管理器
```

只想跑源码、不打包也行：`pnpm install` 之后用 `pnpm start`（tsx 直接跑 `server/index.ts`）。

## Windows（start.cmd）

```powershell
cd E:\bqj\pinboard
powershell -File tools\pinboard.ps1 stop
git pull; pnpm install; pnpm build
powershell -File tools\pinboard.ps1 start
```

`tools\pinboard.ps1` 必须保持 UTF-8 **带 BOM**，`run-pinboard.vbs` 必须 CRLF，否则双击静默不执行（坑 10）。

## 迁移与回滚

- 版本号存在 SQLite 的 `PRAGMA user_version` 里，每个迁移步骤一个事务，失败就回滚并抛错。
- 有 pending 迁移时，启动过程会先把当前库 `VACUUM INTO` 到 `data/backups/pre-migrate-v<旧版本>-<时间戳>.db`，
  **保留最近 5 份**。为什么用 `VACUUM INTO` 而不是拷文件：WAL 模式下直接拷 `.db` 会漏掉还在 `-wal` 里的事务（坑 46）。
- 快照失败 → 迁移不执行，进程退出并打印「迁移前备份失败，已中止升级」。宁可起不来，也不留没有退路的库。
- 迁移成功后旧快照仍留在 `data/backups/`，可以随时手动回退：停服务 → 用快照覆盖 `data/pinboard.db`
  （**同时删掉 `pinboard.db-wal` 和 `pinboard.db-shm`**）→ 换回旧版本代码 → 启动。

⚠️ 回滚代码而不回滚数据通常是不安全的：新版本可能已经写入老代码不认识的列或表。要回滚就连数据一起回滚。

## 升级后验收

```bash
curl -s http://127.0.0.1:7788/api/health      # {"ok":true,"id":"..."}
```

1. 打开首页能登录（升级不踢会话，除非改过密码）。
2. 八页都能打开：便签 / 邮件 / 资产 / 观测 / 主机 / 服务 / 备份 / 设置。
3. 备份页的「上次备份」时间正常，远端数据库（如果配了）能点「测试连接」。
4. 观测页有数据（说明 Kuma 口令仍能解密）——若变成引导卡，多半是 `data/secret.key` 丢了或被换了。
5. 日志里没有 `凭据已就地加密` 之外的报错。

## 常见问题

**升级后要求重新设置密码？** 只有库被换掉才会这样（`password_hash` 在 `settings` 表里）。真忘了密码：
停服务 → `node --import tsx server/index.ts --reset-password` → 启动 → 访问 `/setup` 重新设。

**`EADDRINUSE 127.0.0.1:7788`** 多半是旧进程没退干净。Windows 用 `stop.cmd`（它会连 tsx 子进程一起结束）；
Linux 用 `systemctl stop`，或 `ss -ltnp | grep 7788` 找 PID。

**迁移报错退出** 把日志里的 SQL 报错连同 `pre-migrate-*.db` 一起留好，那是最有价值的复现材料。

**Docker 里 `/data` 权限报错** 命名卷没问题；如果用 bind mount，先 `chown -R 1000:1000 <目录>`（容器里是 `node` 用户）。
