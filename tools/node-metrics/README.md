# node-metrics —— 6 台服务器的采集端

> 2026-10-22 建。每 5 分钟采集一次本机 CPU / 内存 / 磁盘 / 服务状态，PUT 一份 JSON 到
> my-server 的 nginx（`dav_methods PUT` 直接落盘），本机 pinfolio 再从那里拉回来存 SQLite，
> 页面是 pinfolio 的「主机」页（`/hosts`）。

## 为什么是这套

- **服务器侧零常驻**：`node-metrics.timer` 每 5 分钟拉起一次 `node-metrics.sh`，跑 0.1–0.3 秒就退，
  峰值内存几 MB。对比 node_exporter + Prometheus：每台常驻 15–25 MB、本机再加 200 MB，
  oj 只有 945 MB，装不起。
- **零依赖**：只要 bash + coreutils + curl，不用 jq / python / 任何 agent。
- **只读**：除 `/tmp` 的临时文件外不写任何东西（`install.sh` 除外，它只跑一次）。

## 文件

| 文件 | 作用 |
|---|---|
| `node-metrics.sh` | 采集并上报。`--print` 只打印 JSON 不上报（排错用） |
| `install.sh` | 一次性安装：写 `/etc/node-metrics.conf`(600)、装脚本与 unit/timer、立刻跑一次 |
| `node-metrics.service` | oneshot，`MemoryMax=32M` / `CPUQuota=20%` / `TimeoutStartSec=60` 兜底 |
| `node-metrics.timer` | `OnBootSec=2min` + `OnUnitActiveSec=5min` + `AccuracySec=30s` + `RandomizedDelaySec=20s` |
| `nginx-metrics.conf` | my-server 上的两段 location：ingest（只允许 PUT）+ GET 读回 |
| `build-install.mjs` | 把 `install.sh` / `node-metrics.sh` / `.service` / `.timer` 内联成**单文件安装器** `node-metrics-install.sh`（`node build-install.mjs` 生成，`--check` 校验） |
| `node-metrics-install.sh` | 生成物：一个文件装完整套（托管在 my-server 的 `/nm/`，公网可下载，**不带 token**） |

## 装一台

**首选：主机页点「+ 添加主机」**——填 id / 服务清单 / 地址，保存后弹出「接入这台机器」，
复制里面那条命令到目标机 `sudo` 跑一遍即可（命令由 `GET /api/hosts/:id/onboard` 生成，
自动带上该机的 `HOST_ID` / `WATCH_UNITS` / `DISK_PATHS` 与上报 token；装完 timer 会立刻上报第一帧，
弹窗里点「立即检查」就能看到它变绿）。

手动装（没有 pinboard 界面时）：

```bash
curl -fsSL https://metrics.example.com/nm/node-metrics-install.sh -o /tmp/node-metrics-install.sh
sudo bash /tmp/node-metrics-install.sh \
  https://metrics.example.com/metrics-ingest/<TOKEN> \
  <HOST_ID> "<WATCH_UNITS>" "<DISK_PATHS>"
```

四个位置参数一个都不能省（省了磁盘路径会顶到服务清单位）。安装器是自解压脚本：
自己解出四件套到临时目录 → 跑 `install.sh` → 退出时清临时目录（所以别改成 `exec`，`trap` 就不跑了）。
改了那四件之后要 `node build-install.mjs` 重新生成、`--check` 通过、重传到 my-server 的 `/var/www/nm/`。

- `HOST_ID`：`my-server` / `az` / `oj` / `os` / `ox` / `aws`（决定文件名，也是 pinfolio 里 `data/metrics.json` 的 `id`）。
- `WATCH_UNITS`：空格分隔的单元名，例如 `"xray memwatch"`；为空就不报 `units`。
- `DISK_PATHS`：空格分隔的挂载点，例如 `"/ /mnt/data"`，默认 `/`；不存在的路径自动跳过。
- token 在 `D:\pinfolio\data\metrics.json`（与 my-server 的 nginx 配置一致，**两边一起换**）。

## 验证

```bash
systemctl status node-metrics.service --no-pager   # 期望 status=0/SUCCESS
systemctl list-timers node-metrics.timer --no-pager # 期望有 NEXT
/usr/local/bin/node-metrics.sh --print              # 期望一行完整 JSON
curl -s https://metrics.example.com/metrics/<TOKEN>/<HOST_ID>.json   # 期望拿到刚推上去那份
```

6 台的时间戳不同步是**正常的**：`RandomizedDelaySec=20s` + `AccuracySec=30s` 故意错峰，
免得 6 台同时 PUT。

## 采集字段

```json
{"host":"oj","ts":1792665851,"uptime_s":99191,"kernel":"6.12.0-…","os":"Oracle Linux Server 9.8",
 "cores":2,"load":[0.00,0.00,0.00],"cpu_pct":1.5,
 "mem":{"total_kb":968600,"avail_kb":582484,"used_pct":39.9,"swap_total_kb":2097148,"swap_used_pct":0.1},
 "disk":[{"path":"/","total":31608274944,"used":8553672704,"pct":28}],
 "failed_units":0,"units":{"xray":"active","memwatch":"active"},
 "top":[{"comm":"rsyslogd","rss_kb":100500}]}
```

- CPU 是 `/proc/stat` 两次采样（1 秒窗口）的 `Δtotal / Δidle`，不是 `top` 的瞬时值。
- `top` 的字段名是 **`rss_kb`**（不是 `rss`），只取 `comm`、不含参数（避免把命令行里的 token 带出去）。
- 整条 JSON 在 pinfolio 里**原样存进 `host_metrics.data` 列，不拆字段**——这里加字段不用改服务端。

## 回滚

```bash
sudo systemctl disable --now node-metrics.timer
sudo rm -f /etc/systemd/system/node-metrics.{service,timer} /usr/local/bin/node-metrics.sh /etc/node-metrics.conf
sudo systemctl daemon-reload
```

my-server 上删掉 `nginx-metrics.conf` 那两段 location、`rm -rf /var/www/metrics/`，再 `nginx -t && systemctl reload nginx`。
