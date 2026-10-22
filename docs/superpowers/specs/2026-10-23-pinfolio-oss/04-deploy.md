# 04 · 部署（Docker / 裸机 / 升级）

- 状态：待实施
- 依赖：01（迁移）、02（`PINBOARD_PASSWORD`）、03（`secret.key`）、05（升级前备份）

## 目标

同一套代码三种跑法；开源用户的主路径是 `docker compose up -d` + 前置 Caddy 自动 TLS。

## 三种跑法

| 方式 | 面向 | 入口 |
|---|---|---|
| Windows 裸机 | 作者本机 | `start.cmd` → `127.0.0.1:7788`（不变） |
| Linux/macOS 裸机 | 想自己装的人 | `pnpm i && pnpm build && HOST=127.0.0.1 pnpm start` |
| Docker Compose | 开源用户主路径 | `docker compose up -d` + Caddy |

## `HOST` 环境变量

`server/index.ts:49` 现在写死 `hostname: '127.0.0.1'` → 改成读 `process.env.HOST ?? '127.0.0.1'`。容器里设 `0.0.0.0`，裸机默认不变。

## 服务端打包

- 新增 `build:server`：`esbuild server/index.ts --bundle --platform=node --format=esm --external:node:* --outfile=dist/server.js`；
- `pnpm build` = 前端 vite build + `build:server`；
- 生产启动改成 `node dist/server.js`；`tsx server/index.ts` 保留为开发模式。

## 镜像

- 多阶段：
  - `builder`：`node:24-bookworm-slim` + corepack 启用的 pnpm → `pnpm install --frozen-lockfile` → `pnpm build`；
  - `runtime`：`node:24-bookworm-slim`，非 root 用户 `node`，`WORKDIR /app`，`VOLUME /data`，`EXPOSE 7788`。
- 选 Debian slim 而不是 alpine：`node:sqlite` 是内置模块，alpine 变体历史上出过编译差异。
- 健康检查：`GET /api/health`。
- 标签：`ghcr.io/<owner>/pinfolio:vX.Y.Z` + `latest`；多架构 `linux/amd64` + `linux/arm64`。

## 容器内布局

```
/data/                  ← 唯一卷
  pinboard.db
  secret.key           ← 没给 PINBOARD_SECRET 时自动生成（0600）
  backups/
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `7788` | 已有 |
| `HOST` | `127.0.0.1` | **新增**；容器里设 `0.0.0.0` |
| `PINBOARD_DATA` | `./data` | 已有；容器里 `/data` |
| `PINBOARD_PASSWORD` | — | 首启即设密码，跳过 `/setup` |
| `PINBOARD_SECRET` | 自动生成 | 静态加密主密钥（32B base64） |
| `PUBLIC_URL` | 请求来源 | 生成安装命令与绝对链接 |
| `TRUST_PROXY` | 关 | 前置反代时开 |
| `BACKUP` | 开 | `0` 关闭自动备份（见 05） |
| `KUMA_URL` / `KUMA_USER` / `KUMA_PASS` | 本机默认 | 观测页数据源 |
| `METRICS_INSTALL_URL` | 按 `PUBLIC_URL` 推 | 主机指标安装命令 |
| `MONITOR_ACTIONS` / `MONITOR_LINKS` / `MONITOR_QUICK` / `HOST_SERVICES` / `KUMA_DIR` / `KUMA_CLI` / `KUMA_SLUG` / `PINBOARD_METRICS_BASE` / `PINBOARD_MAIL_PROXY` | 见代码 | 已有，保持兼容 |

## 反代与 TLS

```caddyfile
pin.example.com {
    reverse_proxy pinfolio:7788
}
```

只暴露 443；7788 只在 compose 内网可见，不映射到宿主机。HSTS 由 Caddy 出。

## 升级流程

```
docker compose pull && docker compose up -d
```

启动顺序固定：读密钥 → 开库 → 迁移（迁移前自动备份，保留 5 份）→ 起服务。

- 迁移失败 → 进程退出并打印恢复命令，不自动回滚（半迁移的库比旧库更危险）；
- 只保证 `N → N+1` 升级；跨多个版本连续升级要按版本逐个走。

## 验收

- 本地 `docker compose up -d`：`/api/health` 200、数据落在 `/data`、`down && up` 后数据还在、`down -v` 后是空库（走 `/setup`）。
- 镜像体积记录（预期 < 250 MB）。
- 裸机路径回归：`HOST=127.0.0.1 pnpm start` 与 Windows `start.cmd` 都还能用。

## 不做

- K8s / Helm、多容器拆分、镜像内置 TLS、`docker-compose` v1 兼容。
