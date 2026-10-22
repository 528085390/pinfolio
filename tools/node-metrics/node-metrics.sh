#!/bin/bash
# node-metrics.sh —— 采集本机指标，PUT 一份 JSON 给 pinfolio 的收集端（my-server 的 nginx）。
#
# 设计约束（2026-10-22 定，别破坏）：
#   · 零常驻：由 node-metrics.timer 每 5 分钟拉起一次，跑完即退，内存峰值几 MB
#   · 零依赖：只要 bash + coreutils + curl，不用 jq / python / 任何守护进程
#   · 配置在 /etc/node-metrics.conf（METRICS_URL / HOST_ID / WATCH_UNITS / DISK_PATHS）
#   · 只读：除 /tmp 临时文件外不写任何东西
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

json=$(printf '{"host":"%s","ts":%s,"uptime_s":%s,"kernel":"%s","os":"%s","cores":%s,"load":[%s],"cpu_pct":%s,"mem":{"total_kb":%s,"avail_kb":%s,"used_pct":%s,"swap_total_kb":%s,"swap_used_pct":%s},"disk":[%s],"failed_units":%s,"units":{%s},"top":[%s]}' \
  "$(jesc "$HOST_ID")" "$(date +%s)" "${uptime_s:-0}" "$(jesc "$kernel")" "$(jesc "$osname")" \
  "${cores:-1}" "${load_json:-0,0,0}" "${cpu_pct:-0.0}" \
  "${mem_total:-0}" "${mem_avail:-0}" "${mem_pct:-0.0}" "${swap_total:-0}" "${swap_pct:-0.0}" \
  "$disk_json" "${failed:-0}" "$units_json" "$top_json")

if [ "$MODE" = "print" ]; then
  printf '%s\n' "$json"
  exit 0
fi

: "${METRICS_URL:?未配置 METRICS_URL（应写在 $CONF 里）}"
tmp=$(mktemp) || exit 1
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$json" > "$tmp"

code=$(curl -sS --max-time 20 --retry 2 --retry-delay 3 -o /dev/null -w '%{http_code}' \
  -X PUT --data-binary "@$tmp" "$METRICS_URL/$HOST_ID.json" 2>&1) || {
    echo "node-metrics: 上报失败（curl 退出码非 0）：$code" >&2
    exit 1
  }
case "$code" in
  2*) exit 0 ;;
  *) echo "node-metrics: 上报返回 HTTP $code" >&2; exit 1 ;;
esac
