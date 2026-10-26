/**
 * 服务栏的样例数据（静态，接库之前先让页面有东西看）。
 *
 * 内容照 C:/Users/huang/.dsh/memory/services.md 的「服务器部署清单」与本机服务表填，
 * 观测项 id 对应 kuma/SNAPSHOT.md 里现有的那 24 项。接库之后这份只留给单测与空库演示。
 */
import type { DeployRec, ServerRec, ServiceRec } from './model'

export const SERVERS: ServerRec[] = [
  {
    id: 'local',
    name: '本机',
    vendor: '本机 · Windows',
    ip: '127.0.0.1',
    user: 'huang',
    note: '登录即起（启动目录 PinfolioStack.vbs）',
    doc: 'C:/Users/huang/.dsh/memory/services.md',
  },
  {
    id: 'wb-server2',
    name: 'wb-server2',
    vendor: '阿里云 · 北京',
    ip: '47.93.5.235',
    user: 'admin',
    note: '公网入口 https://47.93.5.235/（nginx + frp）',
    doc: 'E:/services/wb-server2/',
    monitors: [6],
  },
  {
    id: 'az',
    name: 'az',
    vendor: 'Azure · 美中',
    ip: '20.83.48.204',
    user: 'azureuser',
    note: 'WorkBuddy 账号待重新 OAuth',
    doc: 'E:/services/az/',
    monitors: [13],
  },
  {
    id: 'oj',
    name: 'oj',
    vendor: 'Oracle · 东京',
    ip: '132.145.123.238',
    user: 'opc',
    note: 'Xray Reality 出口，也是订阅汇总的源头',
    doc: 'E:/services/oj/',
    monitors: [8],
  },
  {
    id: 'os',
    name: 'os',
    vendor: 'Oracle · 东京',
    ip: '168.110.34.103',
    user: 'ubuntu',
    note: '节点 os-tokyo',
    doc: 'E:/services/os/',
    monitors: [126, 152],
  },
  {
    id: 'ox',
    name: 'ox',
    vendor: 'Oracle · 东京',
    ip: '168.110.27.26',
    user: 'ubuntu',
    note: '节点 ox-tokyo',
    doc: 'E:/services/ox/',
    monitors: [128],
  },
  {
    id: 'aws',
    name: 'aws',
    vendor: 'AWS · 俄勒冈',
    ip: '34.213.138.61',
    user: 'ec2-user',
    note: '国内主用出口',
    doc: 'E:/services/aws/',
    monitors: [22],
  },
]

export const SERVICES: ServiceRec[] = [
  { id: 'wbapi', name: 'WorkBuddy 网关 API', kind: 'project', summary: 'workbuddy2api：多账号 LLM 网关，本机与远端都跑 7863', doc: 'E:/workbuddy-workspace/projects/wbapi' },
  { id: 'manager', name: 'WorkBuddy 管理端', kind: 'project', summary: 'FastAPI + uvicorn，账号与队列管理界面，7864', doc: 'E:/workbuddy-workspace/projects/workbuddy-manager' },
  { id: 'nginx', name: 'Nginx', kind: 'site', summary: '站点反代，wb-server2 上还托管 /sub 订阅' },
  { id: 'singbox', name: 'sing-box', kind: 'service', summary: 'VLESS Reality + hysteria2 出口' },
  { id: 'xray', name: 'Xray', kind: 'service', summary: 'Reality 代理，监听 443' },
  { id: 'v2ray', name: 'V2Ray', kind: 'service', summary: '备用节点，只监听 127.0.0.1:29195' },
  { id: 'caddy', name: 'Caddy', kind: 'site', summary: '8443 站点，自动证书' },
  { id: 'hysteria', name: 'Hysteria2', kind: 'service', summary: 'hy2 服务端，443/udp' },
  { id: 'kuma', name: '观测后端（Kuma）', kind: 'project', summary: '改造版 Uptime Kuma，前端已删，只留 JSON API，3001', doc: 'E:/bqj/kuma' },
  { id: 'pinboard', name: 'pinfolio', kind: 'project', summary: '便签 / 资产 / 观测界面，7788', doc: 'E:/bqj/pinboard' },
  { id: 'yb', name: '易广金签到台', kind: 'project', summary: '签到面板，8787，用时才启', doc: 'D:/ai_project/yb' },
  { id: 'douyin', name: '抖音续火花面板', kind: 'project', summary: '本地面板 8765，用时才启', doc: 'D:/ai_project/douyin-auto-fire' },
  { id: 'streak', name: '抖音心跳推送', kind: 'task', summary: '计划任务 StreakBeat，每天推一次到 Kuma' },
  { id: 'glados', name: 'glados-sub', kind: 'project', summary: '订阅转换，18080' },
  { id: 'memwatch', name: 'memwatch', kind: 'script', summary: '内存看门狗，60 秒一跑，超阈值重启代理' },
  { id: 'costguard', name: 'costguard', kind: 'script', summary: '成本守卫，timer 30 分钟' },
  { id: 'subhub', name: 'subhub', kind: 'script', summary: '订阅汇总，timer 30 分钟，scp 到 wb-server2' },
  { id: 'banwatch', name: 'wb-banwatch', kind: 'script', summary: '封禁巡检，timer 10 分钟' },
  { id: 'edgeguard', name: 'wb-edge-guard', kind: 'script', summary: '边缘守护，timer 180 秒' },
  { id: 'armfw', name: 'arm-firewall', kind: 'script', summary: '把 nft 规则同步进 OCI 安全列表' },
  { id: 'nodemetrics', name: 'node-metrics', kind: 'script', summary: '主机指标采集，timer 5 分钟 push 一次', doc: 'E:/bqj/pinboard/tools/node-metrics' },
  { id: 'cert', name: '证书续期', kind: 'task', summary: 'acme.sh / certbot 的 cron 任务' },
  { id: 'hy2cert', name: 'hy2-cert-watch', kind: 'script', summary: 'hy2 证书巡检，每天 00:01 UTC' },
]

export const DEPLOYS: DeployRec[] = [
  // 本机
  { server: 'local', service: 'wbapi', path: 'E:\\workbuddy-workspace\\projects\\wbapi', runtime: '计划任务 WorkBuddyServices', port: '7863', monitor: [1] },
  { server: 'local', service: 'manager', path: 'E:\\workbuddy-workspace\\projects\\workbuddy-manager', runtime: 'uvicorn server.main:app', port: '7864', monitor: [2] },
  { server: 'local', service: 'kuma', path: 'E:\\bqj\\kuma', runtime: 'node server\\server.js（任务 KumaObs）', port: '3001' },
  { server: 'local', service: 'pinboard', path: 'E:\\bqj\\pinboard', runtime: 'tsx server/index.ts（自启 vbs）', port: '7788' },
  { server: 'local', service: 'yb', path: 'D:\\ai_project\\yb', runtime: 'node src\\sign-server.cjs', port: '8787', monitor: [23], note: '手动启动' },
  { server: 'local', service: 'douyin', path: 'D:\\ai_project\\douyin-auto-fire', runtime: 'python panel.py（启动项目.bat）', port: '8765', note: '手动启动' },
  { server: 'local', service: 'streak', path: 'D:\\ai_project\\douyin-auto-fire\\observability', runtime: '计划任务 StreakBeat', monitor: [24] },

  // wb-server2
  { server: 'wb-server2', service: 'wbapi', path: '/opt/workbuddy2api', runtime: 'systemd workbuddy2api', port: '127.0.0.1:7863', monitor: [3, 116] },
  { server: 'wb-server2', service: 'manager', path: '/opt/workbuddy-manager', runtime: 'systemd workbuddy-manager', port: '127.0.0.1:7864', monitor: [4] },
  { server: 'wb-server2', service: 'nginx', path: '/etc/nginx/sites-enabled/wb-proxy', runtime: 'systemd nginx', port: '80 / 443', monitor: [5], note: '兼做 /sub 订阅托管' },
  { server: 'wb-server2', service: 'banwatch', path: '/usr/local/bin/wb-banwatch.py', runtime: 'wb-banwatch.timer（10 分钟）' },
  { server: 'wb-server2', service: 'cert', path: '/root/.acme.sh', runtime: 'cron（4 / 10 / 16 / 22 点）' },
  { server: 'wb-server2', service: 'nodemetrics', path: '/opt/node-metrics', runtime: 'node-metrics.timer（5 分钟）' },

  // az
  { server: 'az', service: 'wbapi', path: '/opt/workbuddy2api', runtime: 'systemd workbuddy2api', port: '127.0.0.1:7863', monitor: [9] },
  { server: 'az', service: 'manager', path: '/opt/workbuddy-manager', runtime: 'systemd workbuddy-manager', port: '127.0.0.1:7864', monitor: [10] },
  { server: 'az', service: 'nginx', path: '/etc/nginx/sites-enabled/', runtime: 'systemd nginx', port: '80 / 443', monitor: [11] },
  { server: 'az', service: 'singbox', path: '/etc/sing-box/config.json', runtime: 'systemd sing-box', port: '8443', note: '节点 azus' },
  { server: 'az', service: 'glados', path: '/opt/glados-sub/server.py', runtime: 'systemd glados-sub', port: '18080' },
  { server: 'az', service: 'edgeguard', path: '/usr/local/sbin/wb-edge-guard.sh', runtime: 'wb-edge-guard.timer（180 秒）' },
  { server: 'az', service: 'cert', path: '/etc/letsencrypt', runtime: 'certbot 续期 cron（5 / 11 / 17 / 23 点）' },
  { server: 'az', service: 'nodemetrics', path: '/opt/node-metrics', runtime: 'node-metrics.timer（5 分钟）' },

  // oj
  { server: 'oj', service: 'xray', path: '/usr/local/etc/xray/config.json', runtime: 'systemd xray', port: '*:443', monitor: [7] },
  { server: 'oj', service: 'memwatch', path: '/usr/local/bin/memwatch.sh', runtime: 'systemd memwatch（60 秒）' },
  { server: 'oj', service: 'costguard', path: '/home/opc/costguard', runtime: 'costguard.timer（30 分钟）' },
  { server: 'oj', service: 'subhub', path: '/home/opc/subhub', runtime: 'subhub.timer（30 分钟）', note: 'scp 汇总到 wb-server2' },
  { server: 'oj', service: 'armfw', path: '/etc/arm-firewall.nft', runtime: 'systemd arm-firewall' },
  { server: 'oj', service: 'nodemetrics', path: '/opt/node-metrics', runtime: 'node-metrics.timer（5 分钟）' },

  // os / ox
  { server: 'os', service: 'singbox', path: '/etc/sing-box/config.json', runtime: 'systemd sing-box', port: '443/tcp + 443/udp', monitor: [125], note: '节点 os-tokyo' },
  { server: 'os', service: 'nodemetrics', path: '/opt/node-metrics', runtime: 'node-metrics.timer（5 分钟）' },
  { server: 'ox', service: 'singbox', path: '/etc/sing-box/config.json', runtime: 'systemd sing-box', port: '443/tcp + 443/udp', monitor: [127], note: '节点 ox-tokyo' },
  { server: 'ox', service: 'nodemetrics', path: '/opt/node-metrics', runtime: 'node-metrics.timer（5 分钟）' },

  // aws
  { server: 'aws', service: 'xray', path: '/usr/local/etc/xray/config.json', runtime: 'systemd xray', port: ':443', monitor: [26] },
  { server: 'aws', service: 'v2ray', path: '/etc/v2ray/conf', runtime: 'systemd v2ray', port: '127.0.0.1:29195', monitor: [19] },
  { server: 'aws', service: 'caddy', path: '/etc/caddy/Caddyfile', runtime: 'systemd caddy', port: '8443', monitor: [20] },
  { server: 'aws', service: 'hysteria', path: '/etc/hysteria/config.yaml', runtime: 'systemd hysteria-server', port: '443/udp' },
  { server: 'aws', service: 'hy2cert', path: '/usr/local/bin/hy2-cert-watch.sh', runtime: 'hy2-cert-watch.timer（00:01 UTC）' },
  { server: 'aws', service: 'nodemetrics', path: '/opt/node-metrics', runtime: 'node-metrics.timer（5 分钟）' },
]

/** 观测项短名：与观测台卡片上的名字对得上，只是去掉了组名前缀。 */
const MONITOR_NAMES: Record<number, string> = {
  1: '网关 API（7863）',
  2: '管理端（7864）',
  3: '网关 API',
  4: '管理端',
  5: 'Nginx 站点',
  6: '公网入口（443）',
  7: 'Xray 代理服务',
  8: '代理端口 443',
  9: '网关 API',
  10: '管理端',
  11: 'Nginx 站点',
  13: '公网入口（443）',
  19: 'V2Ray 服务（备用）',
  20: 'Caddy 站点',
  22: '代理端口 443',
  23: '易广金签到台（8787）',
  24: '抖音续火花（每日打卡）',
  26: 'Xray 代理服务（主用）',
  116: 'DeepSeek Flash 可用账号',
  125: 'sing-box 代理服务',
  126: '代理端口 443',
  127: 'sing-box 代理服务',
  128: '代理端口 443',
  152: '域名入口（8443）',
}

export function monitorName(id: number): string {
  return MONITOR_NAMES[id] ?? '观测项 ' + id
}
