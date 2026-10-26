// 主机页（卡片、在线引导、详情）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

export const hosts: Dict = {
  // 工具栏
  '在线': 'Online',
  '{n} 台已暂停': (v) => `${v.n} paused`,
  '每 5 分钟采集一次': 'Collected every 5 minutes',
  '上次拉取 {ago}': 'Last fetched {ago}',
  '{n} 个样本': (v) => `${v.n} ${Number(v.n) === 1 ? 'sample' : 'samples'}`,
  '每 60 秒自动刷新本页': 'Auto refresh this page every 60 seconds',
  '自动刷新': 'Auto refresh',
  '立即拉取': 'Fetch now',
  '添加主机': 'Add host',
  '有 {n} 台没拉到：{list}': (v) => `${v.n} host${Number(v.n) === 1 ? '' : 's'} failed: ${v.list}`,
  '{id}（{error}）': '{id} ({error})',
  '、': ', ',
  '读不到主机指标': 'Can’t read host metrics',
  '还没有主机': 'No hosts yet',
  '点右上角「添加主机」加一台，采集脚本见 tools/node-metrics/。':
    'Use “Add host” in the top-right corner; the collector script lives in tools/node-metrics/.',
  '主机加好了，但观测项没建成：{msg}': 'Host added, but the monitors could not be created: {msg}',
  '未知错误': 'Unknown error',
  '主机删了，但观测项没删掉：{list}（去观测台手动删）':
    'Host deleted, but its monitors were not: {list} (delete them by hand on the monitors page)',

  // 卡片
  '{d} 天 {h} 小时': (v) => `${v.d}d ${v.h}h`,
  '{h} 小时 {m} 分': (v) => `${v.h}h ${v.m}m`,
  '{m} 分钟': (v) => `${v.m}m`,
  '无数据': 'No data',
  '还没有曲线': 'No chart yet',
  '已暂停': 'Paused',
  '暂停采集': 'Pause collection',
  '恢复采集': 'Resume collection',
  '暂停采集（保留卡片与历史，只是不再拉取）': 'Pause collection (the card and its history stay; nothing is fetched)',
  '删除这台主机（{id}）': 'Delete this host ({id})',
  '已暂停采集，恢复后会补到最新一帧': 'Collection is paused; it catches up to the latest sample when resumed',
  '还没收到这台机的上报': 'No report from this machine yet',
  '接入指引': 'Setup guide',
  '{n} 核': (v) => `${v.n} ${Number(v.n) === 1 ? 'core' : 'cores'}`,
  '内存': 'Memory',
  '负载 1m': 'Load 1m',
  '已运行': 'Uptime',

  // 添加主机
  'systemd 探测要在「服务清单」里填 unit（探测的就是这些服务）':
    'systemd checks need units in “Services” — those are what get probed',
  '建观测项要填主机地址（IP 或域名）': 'Creating monitors needs the host address (IP or domain)',
  '主机 id': 'Host id',
  '采集端的 HOST_ID，上报文件名就是 <id>.json；只能用字母、数字、点、下划线、短横线':
    'HOST_ID of the collector; reports land as <id>.json — letters, digits, dots, underscores and dashes only',
  '例如 os2': 'e.g. os2',
  '显示名': 'Display name',
  '留空就用 id；建议写成「机器 (厂商 · 区域)」': 'Leave empty to use the id; “machine (vendor · region)” reads best',
  '例如 os2 (Oracle · 东京)': 'e.g. os2 (Oracle · Tokyo)',
  '显示在名字后面': 'Shown after the name',
  '例如 东京 · 1C1G': 'e.g. Tokyo · 1C1G',
  '采集端': 'Collector',
  '装到那台机上的参数，决定卡片显示什么': 'Settings installed on that machine; they decide what the card shows',
  '服务清单': 'Services',
  '空格分隔，卡片上的服务 chip 就是它们；例如 nginx app-api':
    'Space separated — they become the service chips on the card; e.g. nginx app-api',
  '留空就只报 CPU / 内存 / 磁盘': 'Leave empty to report only CPU / memory / disk',
  '磁盘路径': 'Disk paths',
  '空格分隔，默认 /': 'Space separated, defaults to /',
  '地址': 'Address',
  'IP 或域名，建观测项用；采集端不需要它': 'IP or domain, used to create monitors; the collector does not need it',
  '例如 203.0.113.11': 'e.g. 203.0.113.11',
  '观测项': 'Monitors',
  '顺带在观测台建，建不成不影响主机': 'Also created on the monitors page; a failure there does not affect the host',
  '端口探测（只做 TCP 握手，Reality / hy2 这类不回普通 TLS 的也能探）':
    'Port check (TCP handshake only — works for Reality / hy2 that never answer plain TLS)',
  '端口': 'Port',
  'HTTP 站点（返回 2xx 才算正常，可要求页面里含某个词）':
    'HTTP site (2xx counts as up; optionally require a keyword on the page)',
  '关键字（可空）': 'Keyword (optional)',
  'systemd 服务（给「服务清单」里每个 unit 建一项，走 SSH 跑 systemctl is-active）':
    'systemd services (one monitor per unit in “Services”, running systemctl is-active over SSH)',
  'SSH 用户名，例如 ubuntu': 'SSH user, e.g. ubuntu',
  '私钥路径，例如 ~/.ssh/id_ed25519': 'Private key path, e.g. ~/.ssh/id_ed25519',
  '私钥只在本机读，随观测项存进 Kuma（与现有 6 台一致）':
    'The key is only read locally and stored in Kuma with the monitor (same as the existing six)',
  '加完会弹出「接入这台机器」：一条命令装好采集端（下载安装器 + timer），装完立刻上报第一帧。':
    'After saving, “Connect this machine” pops up: one command installs the collector (installer + timer) and the first sample arrives right away.',

  // 删除主机
  '删除主机': 'Delete host',
  '删除中…': 'Deleting…',
  '确认删除': 'Confirm delete',
  '从主机页移除「{label}」（{id}）。这只改本地的': 'Remove “{label}” ({id}) from the hosts page. This only edits the local',
  '，服务器上的采集端不受影响 —— 要彻底停采集得去那台机 disable 掉 timer。':
    '; the collector on the server is unaffected — to stop collecting for good, disable the timer on that machine.',
  '把主机 id 原样输一遍：{id}': 'Type the host id to confirm: {id}',
  '在这里输入 id': 'Type the id here',
  '同时删掉历史样本（30 天曲线），以及加主机时顺带建的观测项':
    'Also delete the history samples (the 30-day chart) and the monitors created along with the host',

  // 接入这台机器
  '复制失败，手动选中上面的命令复制': 'Copy failed — select the command above and copy it by hand',
  '接入这台机器': 'Connect this machine',
  '在': 'Run this on',
  '上以 root 跑这一条：下载安装器 → 写 /etc/node-metrics.conf → 装 timer → 立刻上报第一帧。':
    'as root: download the installer → write /etc/node-metrics.conf → install the timer → report the first sample right away.',
  '复制命令': 'Copy command',
  '立即检查': 'Check now',
  '已收到首帧：{time}（{ago}）': 'First sample received: {time} ({ago})',
  '还在等第一帧——装完 timer 会立刻跑一次，之后每 5 分钟一次':
    'Still waiting for the first sample — the timer runs once right after install, then every 5 minutes',
  '命令里带着采集 token（只在这个弹窗出现，不进列表接口、不进 SNAPSHOT）。':
    'The command carries the collection token (it only shows up in this dialog — not in the list API, not in SNAPSHOT).',
  '服务清单 {units}；磁盘 {disks}。': 'Services {units}; disks {disks}.',
  '（空）': '(empty)',
  '<地址>': '<address>',
  '这台机没装 SSH 时，也可以在本地直接跑': 'If that machine has no SSH set up, you can also run this locally',
  '。': '.',
}
