# node-metrics —— 在役 4 台服务器的采集端

> 2026-10-22 建，**2026-11-09 改成本机文件 + SSH 拉取**。每 5 分钟采集一次本机 CPU / 内存 / 磁盘 / 服务状态，
> 写一份 JSON 到 `/var/lib/node-metrics/<HOST_ID>.json`；pinfolio（本机 7788）每 5 分钟 `ssh <别名> cat` 回来存 SQLite，
> 页面是 pinfolio 的「主机」页（`/hosts`）。
>
> 老方式（`METRICS_URL=https://…/metrics-ingest/<token>`，PUT 到别人家 nginx 的 `dav_methods PUT` 目录）在脚本里**仍然保留**：
> 当初的接收端在 az 上，2026-11-09 az 整机退役，链断了才改成落盘 + SSH。想换回 push 只改 `METRICS_URL` 即可，代码不用动。

## 为什么是这套

- **服务器侧零常驻**：`node-metrics.timer` 每 5 分钟拉起一次 `node-metrics.sh`，跑 0.1–0.3 秒就退，峰值内存几 MB。
  对比 node_exporter + Prometheus：每台常驻 15–25 MB、本机再加 200 MB，oj 只有 945 MB，装不起。
- **零依赖**：落盘模式只要 bash + coreutils（连 curl 都不需要），不用 jq / python / 任何 agent。
- **零公网面**：落盘模式不监听任何端口、不需要证书、不需要 nginx；拉取方向是 pinfolio 主动出站 SSH。
- **只读 + 单点写**：除了 `/var/lib/node-metrics/`（或 `/tmp`）不写别的地方；写文件是先写同目录临时文件再 `mv`，拉取端永远读不到半个 JSON。

## 文件

| 文件 | 作用 |
|---|---|
| `node-metrics.sh` | 采集并落盘 / 上报。`--print` 只打印 JSON（排错用）；`METRICS_URL` 以 `file://` 开头或留空 → 写本机文件，`http(s)://` → PUT 上报 |
| `install.sh` | 一次性安装：写 `/etc/node-metrics.conf`(600)、装脚本与 unit/timer、立刻跑一次 |
| `node-metrics.service` | oneshot，`MemoryMax=32M` / `CPUQuota=20%` / `TimeoutStartSec=60` 兜底 |
| `node-metrics.timer` | `OnBootSec=2min` + `OnUnitActiveSec=5min` + `AccuracySec=30s` + `RandomizedDelaySec=20s` |
| `nginx-metrics.conf` | **已不用**（az 退役后没有接收端了），留着给将来换回 push 模式参考 |
| `build-install.mjs` | 把 `install.sh` / `node-metrics.sh` / `.service` / `.timer` 内联成**单文件安装器** `node-metrics-install.sh`（`node build-install.mjs` 生成，`--check` 校验）；打包时把 CRLF 归一成 LF |
| `node-metrics-install.sh` | 生成物：一个文件装完整套（公网可下载也**不带 token**，落盘模式根本没有 token） |

## 装一台

**首选：主机页点「+ 添加主机」**——填 id / 服务清单 / 地址（`address` 填 ssh 别名，例如 `os`），保存后弹出「接入这台机器」，
复制里面那条命令到目标机 `sudo` 跑一遍即可（命令由 `GET /api/hosts/:id/onboard` 生成，`METRICS_URL` 自动是 `file:///var/lib/node-metrics`；
装完 timer 会立刻写第一帧，弹窗里点「立即检查」就能看到它变绿）。

手动装（没有 pinboard 界面时）：

```bash
curl -fsSL <安装器地址> -o /tmp/node-metrics-install.sh
sudo bash /tmp/node-metrics-install.sh \
  file:///var/lib/node-metrics \
  <HOST_ID> "<WATCH_UNITS>" "<DISK_PATHS>"
```

四个位置参数一个都不能省（省了磁盘路径会顶到服务清单位）。安装器是自解压脚本：
自己解出四件套到临时目录 → 跑 `install.sh` → 退出时清临时目录（所以别改成 `exec`，`trap` 就不跑了）。
改了那四件之后要 `node build-install.mjs` 重新生成、`--check` 通过、再把 `node-metrics-install.sh` 传到托管位置。

- `HOST_ID`：`oj` / `os` / `ox` / `aws`（决定文件名，也是 pinfolio 里 `data/metrics.json` 的 `id`；同时也是默认的 ssh 目标）。
- `WATCH_UNITS`：空格分隔的单元名，例如 `"xray memwatch"`；为空就不报 `units`。
- `DISK_PATHS`：空格分隔的挂载点，例如 `"/ /mnt/data"`，默认 `/`；不存在的路径自动跳过。
- 指标源在 pinfolio 的 `data/metrics.json`（`base = ssh:/var/lib/node-metrics`，密文）：**和这里 conf 里的目录必须一致**，不一致主机页就显示「拉取失败」。

## 验证

```bash
systemctl status node-metrics.service --no-pager      # 期望 status=0/SUCCESS
systemctl list-timers node-metrics.timer --no-pager   # 期望有 NEXT
/usr/local/bin/node-metrics.sh --print                # 期望一行完整 JSON
ls -l /var/lib/node-metrics/                          # 期望 <HOST_ID>.json，-rw-r--r-- root root
# 在 pinfolio 那台机上（普通用户即可，0644 可读）：
ssh -o BatchMode=yes <别名> cat /var/lib/node-metrics/<HOST_ID>.json
```

4 台的时间戳不同步是**正常的**：`RandomizedDelaySec=20s` + `AccuracySec=30s` 故意错峰。

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

## 常见坑

- **CRLF 会让脚本在服务器上直接语法错**（`line 62: syntax error near unexpected token 'do\r'`）。Windows 工作区检出的是 CRLF，
  所以 `build-install.mjs` 读源文件时会 `replace(/\r\n/g, '\n')`；手动 `scp`/上传 `node-metrics.sh` 时也要先 `sed 's/\r$//'`。
- **改了采集脚本忘了重新打包**：`build-install.mjs --check` 会报「生成物与源文件不一致」（见 `docs/pitfalls.md` 第 38 条）。

## 回滚

```bash
sudo systemctl disable --now node-metrics.timer
sudo rm -f /etc/systemd/system/node-metrics.{service,timer} /usr/local/bin/node-metrics.sh /etc/node-metrics.conf
sudo systemctl daemon-reload
sudo rm -rf /var/lib/node-metrics
```

（老 push 模式的回滚还要在接收端上删掉 `nginx-metrics.conf` 那两段 location、`rm -rf /var/www/metrics/`，再 `nginx -t && systemctl reload nginx`。）
