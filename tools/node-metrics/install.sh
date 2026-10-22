#!/bin/bash
# install.sh —— 在目标机上安装 node-metrics（一次性）。需要 root。
#
# 用法：sudo ./install.sh <METRICS_URL> <HOST_ID> [WATCH_UNITS] [DISK_PATHS]
#   METRICS_URL  = https://203.0.113.10/metrics-ingest/<TOKEN>   （不要带结尾斜杠）
#   HOST_ID      = os / ox / oj / az / aws / my-server    （决定文件名）
#   WATCH_UNITS  = "xray caddy"  空格分隔，可空
#   DISK_PATHS   = "/ /mnt/data" 空格分隔，默认 "/"
#
# 装完：脚本 /usr/local/bin/node-metrics.sh、配置 /etc/node-metrics.conf、
#       node-metrics.timer（每 5 分钟）→ 立刻跑一次并打印结果。
set -euo pipefail

URL="${1:-}"
HOST="${2:-}"
UNITS="${3:-}"
DISKS="${4:-/}"
SRC="$(cd "$(dirname "${0}")" && pwd)"

if [ -z "$URL" ] || [ -z "$HOST" ]; then
  echo "用法: sudo ${0} <METRICS_URL> <HOST_ID> [WATCH_UNITS] [DISK_PATHS]" >&2
  exit 2
fi
if [ "$(id -u)" != "0" ]; then
  echo "需要 root（sudo）" >&2
  exit 2
fi

install -m 0755 "$SRC/node-metrics.sh" /usr/local/bin/node-metrics.sh

umask 077
cat > /etc/node-metrics.conf <<EOF
# node-metrics 配置（2026-10-22 由 install.sh 生成）
METRICS_URL="$URL"
HOST_ID="$HOST"
WATCH_UNITS="$UNITS"
DISK_PATHS="$DISKS"
EOF
chmod 600 /etc/node-metrics.conf

install -m 0644 "$SRC/node-metrics.service" /etc/systemd/system/node-metrics.service
install -m 0644 "$SRC/node-metrics.timer"   /etc/systemd/system/node-metrics.timer
systemctl daemon-reload
systemctl enable --now node-metrics.timer >/dev/null 2>&1 || true

echo "--- 采集预览（不上报）---"
/usr/local/bin/node-metrics.sh --print || true
echo "--- 立刻上报一次 ---"
systemctl start node-metrics.service
systemctl status node-metrics.service --no-pager -n 5 || true
echo "--- 定时器 ---"
systemctl list-timers node-metrics.timer --no-pager || true
