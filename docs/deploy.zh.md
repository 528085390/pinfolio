# 部署

三种跑法，同一套代码：

| 方式 | 面向 | 入口 |
|---|---|---|
| Docker Compose | **开源用户的主路径** | `docker compose up -d` + 可选 Caddy 自动 TLS |
| Linux / macOS 裸机 | 不想装 Docker | `pnpm install && pnpm build && pnpm start` |
| Windows 裸机 | 作者本机 | 双击 `start.cmd`（后台隐藏，日志在 `logs/pinboard.log`） |

三条路都只监听回环地址（容器里是容器网络内的 `0.0.0.0`），**对外一律靠前置反代 + HTTPS**。它内置单用户密码登录（首启 `/setup` 设密码），但这不等于可以直接映射到公网——请按下面「反代与 TLS」做。

---

## 一、Docker（推荐）

```bash
git clone https://github.com/<owner>/pinfolio.git
cd pinfolio
docker compose up -d
```

起来之后：

- 浏览器打开 <http://127.0.0.1:7788>，第一次会跳 `/setup` 让你设密码（8 位以上）。
- 数据全在命名卷 `pinfolio-data`（容器内 `/data`）：`pinboard.db`、`secret.key`、`backups/`、`audit/`。
- 日志：`docker compose logs -f pinfolio`。
- 停止：`docker compose down`（**不会**删数据卷）；`docker compose down -v` 才会连数据一起删。

### 不设密码，用环境变量初始化

想跳过网页设密码（自动化部署常用），在 `docker-compose.yml` 的 `environment` 里放开：

```yaml
PINBOARD_PASSWORD: change-me-please
```

只在库里还没有密码时生效；设过之后这个变量就不管用了（改密码走设置页，或 `--reset-password`）。

### 反代与 TLS

只把 7788 暴露在宿主机回环上（compose 里已经这么写），前面挂一层 Caddy 自动申请证书：

```bash
PINBOARD_DOMAIN=pin.example.com docker compose --profile tls up -d
```

- `deploy/Caddyfile` 的配置只有四行（域名块 + `encode` + `reverse_proxy` + 收尾的 `}`），另两行注释说明用法。
- 只开 80 / 443；HSTS、证书续期都由 Caddy 负责。
- 反代会把 `X-Forwarded-For` / `X-Forwarded-Proto` 传进来，compose 里已设 `TRUST_PROXY=1`（不设的话所有会话的设备 IP 都是容器网关地址）。
- 用自己的 nginx / Traefik 也行，记得：`proxy_set_header X-Forwarded-Proto $scheme;`、`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并设 `TRUST_PROXY=1`。

### 想让数据落在宿主机目录

命名卷默认就够用（备份页可以直接下载）。一定要 bind mount 的话：

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
```

然后把 compose 里的 `- pinfolio-data:/data` 换成 `- ./data:/data`。**权限不对会启动失败**（容器里是 uid 1000 的 `node` 用户，不是 root）。

### 升级

```bash
docker compose pull
docker compose up -d
```

启动顺序是固定的：读主密钥 → 开库 → 跑迁移 → 起服务。迁移前会自动拍一张 `data/backups/pre-migrate-v<旧版本>-<时间戳>.db`（保留 5 份），迁移失败会直接退出、不会留下半迁移的库：

```bash
docker compose logs pinfolio        # 看是哪一步失败
```

回滚：把镜像标签改回旧版本（`PINBOARD_TAG=v1.2.3`），再把 `pre-migrate-*.db` 拷回成 `pinboard.db`（**同时删掉 `pinboard.db-wal` / `-shm`**，否则 WAL 会把旧库覆盖回去）。细节见 [backup-restore.md](backup-restore.zh.md)。

只保证 `N → N+1` 的升级；跨多个大版本要按版本逐个升。

### 备份

- 自动：每天 03:00 打一个包到 `/data/backups/pinfolio-YYYYMMDD-HHMM.tar.gz`，保留 14 份；`BACKUP=0` 关。
- 远端：备份页可以填 MySQL / PostgreSQL，把包写进 `pinfolio_backups` 表（上传后回读 sha256 校验）。
- 手动：备份页「立即备份」，或 `docker compose exec pinfolio node dist/server.js --backup`。
- 取出来：备份页点「下载」，或 `docker compose cp pinfolio:/data/backups/<文件> .`。

包里含 `secret.key`。**主密钥丢了，邮箱密码 / Kuma 口令 / 指标源就都解不开**——请把整包当密码对待，别放公开网盘。

---

## 二、Linux / macOS 裸机

```bash
git clone https://github.com/<owner>/pinfolio.git && cd pinfolio
pnpm install
pnpm build                 # 前端到 dist/web，服务端打成 dist/server.js
PINBOARD_DATA=/var/lib/pinfolio node dist/server.js
```

- 需要 Node ≥ 24（用内置 `node:sqlite`）与 pnpm 12。
- 默认 `HOST=127.0.0.1`、`PORT=7788`；要监听别处就显式设 `HOST=0.0.0.0`（并确保前面有反代和鉴权）。
- 开发模式用 `pnpm dev`（API 7788 + Vite 5273，改代码热更新）；`tsx server/index.ts` 与 `node dist/server.js` 等价，后者快、前者不用编译。

systemd 示例：

```ini
[Unit]
Description=pinfolio
After=network.target

[Service]
User=pinfolio
WorkingDirectory=/opt/pinfolio
Environment=HOST=127.0.0.1
Environment=PORT=7788
Environment=PINBOARD_DATA=/var/lib/pinfolio
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node /opt/pinfolio/dist/server.js
Restart=always
MemoryMax=400M

[Install]
WantedBy=multi-user.target
```

---

## 三、Windows 裸机

双击 `start.cmd`（后台隐藏启动，已运行就只开浏览器），`stop.cmd` 停止。命令行等价物：`pnpm start`。

密码忘了：

```powershell
powershell -File tools\pinboard.ps1 stop
node --import tsx server/index.ts --reset-password
powershell -File tools\pinboard.ps1 start
```

---

## 环境变量

配置写进环境变量即可，也可以放在**项目根的 `.env`** —— `pnpm start` / `pnpm start:dist` 会用
`node --env-file-if-exists=.env` 自动读（容器里用 compose 的 `environment` / `env_file`）。
仓库带一份 `.env.example`，复制成 `.env` 改就行；`.env` 在 `.gitignore` 里，不会进版本库。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `7788` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址；容器里 `0.0.0.0` |
| `PINBOARD_DATA` | `<应用目录>/data` | 数据目录；容器里 `/data` |
| `PINBOARD_PASSWORD` | — | 首启即设密码，跳过 `/setup` |
| `PINBOARD_SECRET` | 自动生成到 `data/secret.key` | 静态加密主密钥（32 字节 base64） |
| `PUBLIC_URL` | 请求来源 | 生成「接入这台机器」的绝对链接 |
| `TRUST_PROXY` | 关 | 前置反代时设 `1`，才读 `X-Forwarded-*`（客户端 IP 取 `X-Forwarded-For` 最后一段） |
| `BACKUP` | 开 | `0` / `off` / `false` 关掉每天 03:00 的定时备份 |
| `BACKUP_HOUR` / `BACKUP_KEEP` / `BACKUP_DIR` | `3` / `14` / `<data>/backups` | 定时备份的时间与保留份数 |
| `KUMA_URL` / `KUMA_SLUG` / `KUMA_USER` / `KUMA_PASS` | `http://127.0.0.1:3001` / `obs` / `admin` / 读 `data/kuma-pass.txt` | 观测页的数据源（`KUMA_SLUG` = Kuma 状态页 slug） |
| `KUMA_DB` / `KUMA_DIR` | `<KUMA_DIR>/data/kuma.db` / `<上级目录>/kuma` | 备份时导出当天心跳的 Kuma 库与它的仓库目录 |
| `METRICS_INSTALL_URL` | 按 `PUBLIC_URL` 推 | 主机指标安装命令的托管地址 |
| `KUMA_FLAVOR` | 自动探测 | `fork` / `upstream` 强制指定 Kuma 是不是改造版（探测靠 `policyJson` 字段） |
| `PINBOARD_METRICS_BASE` / `PINBOARD_MAIL_PROXY` | 读 `data/metrics.json` / 空 | 指标拉取基址、邮箱代理的兜底值（正常在页面里配） |
| `MONITOR_ACTIONS` / `MONITOR_LINKS` / `MONITOR_QUICK` / `HOST_SERVICES` / `KUMA_CLI` | 见代码 | 观测项配方 / 跳转 / 快捷入口 / 服务映射 |
| `SERVICES_FILE` | `<数据目录>/services.json` | 服务页的部署关系（`servers` / `services` / `deploys` / `monitors`），每次请求热读；没有这个文件就是空页面 |

---

## 观测页要不要接 Uptime Kuma

要。观测页本身不探测，它读 Uptime Kuma 的 JSON API：

- 本机自用：`kuma/` 那个改造版跑在 3001，默认就通。
- 别的机器：设 `KUMA_URL`（含协议与端口，例如 `http://192.168.1.10:3001`）、`KUMA_USER`、`KUMA_PASS`。
- **完全没接时观测页不会空白**：给一张三步引导卡（起 Kuma → 建 slug 为 `obs` 的状态页 → 填 `KUMA_URL` / `KUMA_SLUG` / `KUMA_PASS`），
  并写明其余七页照常可用。判定走 `GET /api/monitors/meta`：显式配了环境变量，或者默认地址上读得到公开状态页，都算接上了。
- 接了但连不上时，观测页显示连接失败（不是引导卡）；其余七页（便签 / 邮件 / 资产 / 主机 / 服务 / 备份 / 设置）不受影响。
- 上游原版 Kuma 也能连：按观测项有没有 `policyJson` 自动识别，上游版下详情抽屉不显示「立即观测」；要强制指定就设 `KUMA_FLAVOR=auto|fork|upstream`。
- 备份包里的心跳 CSV 来自 `KUMA_DB` 指向的 `kuma.db`；路径不对只是少了「当天心跳」这一项，备份本身照做。

---

## 验收清单（部署完照着走一遍）

1. `curl -s http://127.0.0.1:7788/api/health` → `{"ok":true,"id":"…"}`
2. 浏览器打开首页 → 跳 `/setup` → 设密码 → 进得去八页
3. 写一条便签 → 刷新还在；重启容器/进程后还在
4. 设置页 → 设备列表里能看到当前设备；「退出登录」后要重新登录
5. 备份页 → 「立即备份」→ 出现一份 `pinfolio-*.tar.gz`，点「清单」能看到成员与 sha256
6. （可选）手机连同一网络 → 打开反代后的 https 地址 → 八页可用，底部是标签栏
