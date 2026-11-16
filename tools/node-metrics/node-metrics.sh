#!/bin/bash
# node-metrics.sh —— 采集本机指标，交给 pinfolio 的主机页。
#
# 两种落地方式（2026-11-09 加第二种，因为原收集端所在机器已退役）：
#   · METRICS_URL="file:///var/lib/node-metrics"  → 只写本机文件，pinfolio 走 SSH 拉（默认推荐）
#   · METRICS_URL="https://…/metrics-ingest/<token>" → 老方式：curl PUT 上报给收集端
#   · METRICS_URL 留空 → 同 file:// 默认目录（/var/lib/node-metrics）
#
# 设计约束（2026-10-22 定，别破坏）：
#   · 零常驻：由 node-metrics.timer 每 5 分钟拉起一次，跑完即退，内存峰值几 MB
#   · 零依赖：只要 bash + coreutils（落盘模式连 curl 都不需要）
#   · 配置在 /etc/node-metrics.conf（METRICS_URL / HOST_ID / WATCH_UNITS / DISK_PATHS）
#   · 落盘模式只写一处：<METRICS_URL 的目录>/<HOST_ID>.json（先写临时文件再原子 mv）
#
# 用法：
#   node-metrics.sh            # 采集并上报
#   node-metrics.sh --print    # 只打印 JSON（排错用，不上报）
set -uo pipefail

CONF="${NODE_METRICS_CONF:-/etc/node-metrics.conf}"
if [ -r "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

MODE="push"
[ "${1:-}" = "--print" ] && MODE="print"

HOST_ID="${HOST_ID:-$(hostname -s 2>/dev/null || echo unknown)}"
WATCH_UNITS="${WATCH_UNITS:-}"
DISK_PATHS="${DISK_PATHS:-/}"

# JSON 字符串转义（hostname / 单元名 / comm 都是安全字符，这里只兜底）
jesc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# 只接受非负整数，坏状态文件 / 空值按 0 处理
num() { case "${1:-}" in ''|*[!0-9]*) printf '0';; *) printf '%s' "$1";; esac; }

# ── CPU：两次采样 /proc/stat，取 Δtotal / Δidle ─────────────────────────────
cpu_snap() { awk '/^cpu /{t=0; for(i=2;i<=NF;i++) t+=$i; print t, $5+$6}' /proc/stat; }
read -r t1 i1 <<<"$(cpu_snap)"
# 1 秒窗口：我们自己的 fork/exec 大约贡献 10ms，窗口越长相对误差越小
sleep 1
read -r t2 i2 <<<"$(cpu_snap)"
cpu_pct=$(awk -v t1="${t1:-0}" -v i1="${i1:-0}" -v t2="${t2:-0}" -v i2="${i2:-0}" 'BEGIN{
  dt=t2-t1; di=i2-i1
  if (dt<=0) print "0.0"; else printf "%.1f", (dt-di)*100/dt
}')

# ── 内存 / swap（单位 KB，直接来自 /proc/meminfo）──────────────────────────
read -r mem_total mem_avail swap_total swap_free <<<"$(awk '
  /^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} /^SwapTotal:/{st=$2} /^SwapFree:/{sf=$2}
  END{ printf "%d %d %d %d", t, a, st, sf }' /proc/meminfo)"
mem_pct=$(awk -v t="${mem_total:-0}" -v a="${mem_avail:-0}" 'BEGIN{ if (t<=0) print "0.0"; else printf "%.1f", (t-a)*100/t }')
swap_pct=$(awk -v t="${swap_total:-0}" -v f="${swap_free:-0}" 'BEGIN{ if (t<=0) print "0.0"; else printf "%.1f", (t-f)*100/t }')

# ── load / uptime / 核数 ───────────────────────────────────────────────────
load_raw="$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo "0 0 0")"
load_json="${load_raw// /,}"
uptime_s=$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null || echo 0)
cores=$(nproc 2>/dev/null || echo 1)

# ── 网络：累计字节 / 速率 / 本月流量 / TCP 已建立 ─────────────────────────
# /proc/net/dev 第 2 行起是接口；排除 lo，其余接口累加。第 3 列 rx bytes、第 11 列 tx bytes。
read -r net_rx net_tx <<<"$(awk -F'[: ]+' 'NR>2 && $2!="lo" {rx+=$3; tx+=$11} END{printf "%d %d", rx+0, tx+0}' /proc/net/dev 2>/dev/null)"
net_rx=$(num "${net_rx:-0}"); net_tx=$(num "${net_tx:-0}")
# TCP 已建立（state 01），IPv4 + IPv6
tcp_est=$(awk 'FNR>1 && $4=="01"{n++} END{printf "%d", n+0}' /proc/net/tcp /proc/net/tcp6 2>/dev/null)
tcp_est=$(num "${tcp_est:-0}")
now=$(date +%s)

# 上一帧状态：月份 / 时间戳 / 累计收发 / 本月收发。放在指标文件同目录，随 SSH 拉取留在本机。
state_dir="${METRICS_DIR:-/var/lib/node-metrics}"
case "${METRICS_URL:-}" in
  file://*) state_dir="${METRICS_URL#file://}" ;;
  http://*|https://*) state_dir="${TMPDIR:-/tmp}" ;;
esac
state_dir="${state_dir%/}"
state_file="$state_dir/.$HOST_ID.net"
prev_month=""; prev_ts=0; prev_rx=0; prev_tx=0; month_rx=0; month_tx=0
if [ -r "$state_file" ]; then
  read -r prev_month prev_ts prev_rx prev_tx month_rx month_tx < "$state_file" 2>/dev/null || true
fi
prev_ts=$(num "${prev_ts:-0}"); prev_rx=$(num "${prev_rx:-0}"); prev_tx=$(num "${prev_tx:-0}")
month_rx=$(num "${month_rx:-0}"); month_tx=$(num "${month_tx:-0}")
delta_rx=0; delta_tx=0
if [ "$prev_ts" -gt 0 ]; then
  # 计数器回绕 / 重启时 current < prev，这一轮不计增量，避免把「开机以来」重复算进本月
  if [ "$net_rx" -ge "$prev_rx" ]; then delta_rx=$((net_rx - prev_rx)); fi
  if [ "$net_tx" -ge "$prev_tx" ]; then delta_tx=$((net_tx - prev_tx)); fi
fi
elapsed=$((now - prev_ts)); [ "$elapsed" -lt 0 ] && elapsed=0
rate_rx=$(awk -v d="$delta_rx" -v s="$elapsed" 'BEGIN{ if (s<=0) print "0.0"; else printf "%.1f", d/s }')
rate_tx=$(awk -v d="$delta_tx" -v s="$elapsed" 'BEGIN{ if (s<=0) print "0.0"; else printf "%.1f", d/s }')
month=$(date +%Y-%m)
if [ "$prev_ts" -gt 0 ] && [ "$prev_month" = "$month" ]; then
  month_rx=$((month_rx + delta_rx)); month_tx=$((month_tx + delta_tx))
else
  # 第一次运行 / 跨月：本月从这一帧的增量开始，不把历史累计算进来
  month_rx=$delta_rx; month_tx=$delta_tx
fi

save_net_state() {
  mkdir -p "$state_dir" 2>/dev/null || return 0
  local tmpstate="$state_file.tmp.$$"
  printf '%s %s %s %s %s %s\n' "$month" "$now" "$net_rx" "$net_tx" "$month_rx" "$month_tx" > "$tmpstate" 2>/dev/null || { rm -f "$tmpstate"; return 0; }
  mv -f "$tmpstate" "$state_file" 2>/dev/null || rm -f "$tmpstate"
}

# ── 磁盘：DISK_PATHS 里每个存在的路径一条 ─────────────────────────────────
disk_json=""
for p in $DISK_PATHS; do
  [ -d "$p" ] || continue
  row=$(df -P -B1 "$p" 2>/dev/null | awk 'NR==2{print $2, $3, $5}')
  [ -z "$row" ] && continue
  set -- $row
  total=${1:-0}; used=${2:-0}; pct=${3:-0%}
  pct=${pct%\%}
  [ -z "$disk_json" ] || disk_json="$disk_json,"
  disk_json="$disk_json{\"path\":\"$(jesc "$p")\",\"total\":$total,\"used\":$used,\"pct\":${pct:-0}}"
done

# ── failed units / 关注的单元状态 ─────────────────────────────────────────
failed=$(systemctl list-units --state=failed --no-legend --plain 2>/dev/null | wc -l)
failed=${failed:-0}
units_json=""
for u in $WATCH_UNITS; do
  st=$(systemctl is-active "$u" 2>/dev/null || true)
  [ -z "$units_json" ] || units_json="$units_json,"
  units_json="$units_json\"$(jesc "$u")\":\"$(jesc "${st:-unknown}")\""
done

# ── 内存占用前三的进程（只看 comm，不含参数）──────────────────────────────
top_json=$(ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -3 | awk '
  { gsub(/"/, "", $2); printf "%s{\"comm\":\"%s\",\"rss_kb\":%d}", (NR>1?",":""), $2, $1 }')

# ── 系统标识 ──────────────────────────────────────────────────────────────
osname=$(sed -n 's/^PRETTY_NAME="\(.*\)"/\1/p' /etc/os-release 2>/dev/null | head -1)
kernel=$(uname -r 2>/dev/null || echo "")

json=$(printf '{"host":"%s","ts":%s,"uptime_s":%s,"kernel":"%s","os":"%s","cores":%s,"load":[%s],"cpu_pct":%s,"mem":{"total_kb":%s,"avail_kb":%s,"used_pct":%s,"swap_total_kb":%s,"swap_used_pct":%s},"network":{"rx_bytes":%s,"tx_bytes":%s,"rx_rate":%s,"tx_rate":%s,"tcp":%s,"monthly_rx_bytes":%s,"monthly_tx_bytes":%s,"month":"%s"},"disk":[%s],"failed_units":%s,"units":{%s},"top":[%s]}' \
  "$(jesc "$HOST_ID")" "$now" "${uptime_s:-0}" "$(jesc "$kernel")" "$(jesc "$osname")" \
  "${cores:-1}" "${load_json:-0,0,0}" "${cpu_pct:-0.0}" \
  "${mem_total:-0}" "${mem_avail:-0}" "${mem_pct:-0.0}" "${swap_total:-0}" "${swap_pct:-0.0}" \
  "$net_rx" "$net_tx" "$rate_rx" "$rate_tx" "$tcp_est" "$month_rx" "$month_tx" "$month" \
  "$disk_json" "${failed:-0}" "$units_json" "$top_json")

if [ "$MODE" = "print" ]; then
  printf '%s\n' "$json"
  exit 0
fi

# ── 落地方式：file:// 前缀 = 只写本机文件（pinfolio 走 SSH 拉，不占公网端口）────
#    file://<dir> / 留空  → 落盘 <dir>/<HOST_ID>.json
#    http(s)://…          → 老方式：curl PUT 上报
case "${METRICS_URL:-}" in
  file://*) LOCAL_DIR="${METRICS_URL#file://}" ;;
  "")       LOCAL_DIR="${METRICS_DIR:-/var/lib/node-metrics}" ;;
  *)        LOCAL_DIR="" ;;
esac

if [ -n "$LOCAL_DIR" ]; then
  LOCAL_DIR="${LOCAL_DIR%/}"
  mkdir -p "$LOCAL_DIR" 2>/dev/null || { echo "node-metrics: 建不了目录 $LOCAL_DIR" >&2; exit 1; }
  # 先写同目录临时文件再 mv：拉取端（SSH cat）永远读不到半个 JSON
  tmp="$LOCAL_DIR/.$HOST_ID.json.tmp.$$"
  printf '%s\n' "$json" > "$tmp" || exit 1
  chmod 0644 "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$LOCAL_DIR/$HOST_ID.json" || { rm -f "$tmp"; echo "node-metrics: 写入失败 $LOCAL_DIR" >&2; exit 1; }
  save_net_state
  exit 0
fi

tmp=$(mktemp) || exit 1
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$json" > "$tmp"

code=$(curl -sS --max-time 20 --retry 2 --retry-delay 3 -o /dev/null -w '%{http_code}' \
  -X PUT --data-binary "@$tmp" "$METRICS_URL/$HOST_ID.json" 2>&1) || {
    echo "node-metrics: 上报失败（curl 退出码非 0）：$code" >&2
    exit 1
  }
case "$code" in
  2*) save_net_state; exit 0 ;;
  *) echo "node-metrics: 上报返回 HTTP $code" >&2; exit 1 ;;
esac
