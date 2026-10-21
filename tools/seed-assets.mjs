const BASE = 'http://127.0.0.1:7788'
const BT = String.fromCharCode(96)
const code = (s) => BT + s + BT
const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const text = await res.text()
  if (!res.ok) throw new Error(path + ' -> ' + res.status + ' ' + text)
  return text ? JSON.parse(text) : null
}

const fields = await api('/api/fields')
const have = new Set(fields.map((f) => f.key))
for (const f of [
  { key: 'ip', label: 'IP / 地址', type: 'text', sort: 5 },
  { key: 'login', label: '登录方式', type: 'text', sort: 15 },
]) {
  if (!have.has(f.key)) { await api('/api/fields', { method: 'POST', body: JSON.stringify(f) }); console.log('field added:', f.key) }
}

const old = await api('/api/assets')
for (const a of old) await api('/api/assets/' + a.id, { method: 'DELETE' })
console.log('deleted assets:', old.length)

const A = (o) => api('/api/assets', { method: 'POST', body: JSON.stringify(o) })

const wb2 = await A({
  name: 'my-server', kind: 'server', status: 'active',
  location: '阿里云 · 北京（轻量应用服务器）', vendor: '阿里云',
  url: 'https://example.com',
  tags: ['服务器', '运维', 'MyApp'],
  custom: {
    ip: '203.0.113.2',
    login: 'admin（NOPASSWD sudo）',
    secret_at: 'SSH 别名 my-server；私钥 C:\\Users\\you\\.ssh\\id_ed25519_app',
  },
  notes: [
    '跑 MyApp 那套，**当前唯一可用的 LLM 网关**：',
    '',
    '- ' + code('app-api.service') + '（Go 上游，:7863）',
    '- ' + code('app-manager.service') + '（Python 管理端，v1.0.79，:7864）',
    '- nginx：对外 ' + code('https://example.com') + '（443，证书 ' + code('/etc/nginx/ssl/t.crt') + '，acme.sh 续期）',
    '',
    '14 个账号（2026-10-16 与 azfree 互换过来的那批），直连北京出口、无代理。',
    '管理端登录 ' + code('admin') + ' / ' + code('WB_ADMIN_PASSWORD') + '。',
  ].join('\n'),
})

const az = await A({
  name: 'azfree', kind: 'server', status: 'active',
  location: 'Azure VM · 美国（Ubuntu 24.04.4）', vendor: 'Microsoft Azure',
  url: 'https://203.0.113.10',
  tags: ['服务器', '运维', 'MyApp'],
  custom: {
    ip: '203.0.113.10',
    login: 'azureuser（免密 sudo）',
    secret_at: 'C:\\Users\\you\\.ssh\\cloud_key.pem（RSA 3072，ACL 已收紧）',
  },
  notes: [
    '2 vCPU / 8 GB / 29 GB 盘。app-api + app-manager + nginx 三个 systemd 服务。',
    '',
    '- HTTPS 用 Let\'s Encrypt 的 **IP 证书**（' + code('YE1') + '，只有 ~6.7 天），acme.sh 在 root cron ' + code('40 5,11,17,23') + ' 续期',
    '- 2026-10-18 起**服务器直连、不代理**，sing-box 已 inactive + disabled',
    '- 11 个号已被上游全部封禁（403 ' + code('11140 request illegal') + '），网关当前不可用，要恢复只能重新 OAuth 加号',
  ].join('\n'),
})

const oracle = await A({
  name: 'oracle-proxy', kind: 'server', status: 'active',
  location: 'Oracle Cloud · 日本（NRT）', vendor: 'Oracle Cloud',
  tags: ['服务器', '代理', '运维'],
  custom: {
    ip: '203.0.113.24',
    login: 'opc（免密 sudo）',
    secret_at: 'C:\\Users\\you\\.ssh\\oracle_key；服务端私钥在 /usr/local/etc/xray/config.json',
  },
  notes: [
    'Oracle Linux 9.8，1 OCPU / 945 MB 内存 / 30 GB 盘。',
    '',
    '- Xray ' + code('v26.3.27') + '，VLESS + Vision + **Reality**，监听 ' + code('*:443'),
    '- 伪装目标 ' + code('addons.mozilla.org:443') + '（**别换成 microsoft/apple，会握手失败或被封**）',
    '- BBR 已开；客户端参数见 ' + code('E:\\z7z8\\proxy-node\\vless-share-link.txt'),
    '- 1C1G 内存小，装了 ' + code('memwatch.service') + '；卡死先看 ' + code('/var/log/memwatch.log'),
  ].join('\n'),
})

const wb1 = await A({
  name: 'my-server（已废弃）', kind: 'server', status: 'retired',
  location: '阿里云 ECS · 广州（cn-guangzhou）', vendor: '阿里云',
  tags: ['服务器', '运维'],
  custom: { ip: '203.0.113.53' },
  notes: '2026-10-14 用户确认废弃，相关档案、SSH 别名与 known_hosts 记录已一并清除。**不要再连它。**',
})

const djjy = await A({
  name: 'djjy-us（已退役）', kind: 'server', status: 'retired',
  location: '面板容器 VPS · 美国 Washington DC（Cogent）', vendor: '面板 VPS',
  tags: ['服务器', '代理'],
  custom: { ip: '203.0.113.174', login: 'root', secret_at: 'C:\\Users\\you\\.ssh\\id_ed25519_proxy' },
  notes: [
    '2026-10-16 标记「不再使用」。Debian 13 容器，1 vCPU / **128 MiB** 内存。',
    'sing-box 1.14.3（VLESS + Vision + Reality）；面板端口 ' + code('52897→22') + '、' + code('52898→8443') + '。',
    '',
    '⚠️ 128 MiB 的 cgroup 落大文件会卡死（页缓存顶满），装二进制必须流式 + ' + code('oflag=direct') + '。',
    '参数与部署脚本：' + code('E:\\z7z8\\proxy-node-djjy-us\\'),
  ].join('\n'),
})

const us162 = await A({
  name: 'us-162（已失联）', kind: 'server', status: 'lost',
  location: '面板容器 VPS · 美国 Secaucus NJ（Interserver）', vendor: '面板 VPS',
  tags: ['服务器', '代理'],
  custom: { ip: '203.0.113.117', login: 'root', secret_at: 'C:\\Users\\you\\.ssh\\id_ed25519_old' },
  notes: [
    '2026-10-18 判死：' + code('ping') + ' 3 包 100% 丢包，' + code('53715') + '/' + code('53716') + ' 全部 CLOSED/timeout，整机不可达。',
    'azfree 因此改成服务器直连。',
    '',
    '参数与部署脚本：' + code('E:\\z7z8\\proxy-node-us-dallas\\'),
  ].join('\n'),
})

const domain = await A({
  name: 'example.com', kind: 'domain', status: 'active',
  location: '解析到 my-server（203.0.113.2）', vendor: 'DigitalPlat',
  url: 'https://example.com',
  tags: ['域名', '运维'],
  custom: { ip: '203.0.113.2' },
  notes: [
    '未备案的免费域名（DigitalPlat）。443 由 my-server 的 nginx 提供，证书 ' + code('/etc/nginx/ssl/t.crt') + '，acme.sh 自动续期。',
    '',
    '对外 LLM 网关入口：' + code('https://example.com/v1') + '（nginx → manager 做 key 鉴权 → 本地 app-api:7863）。',
  ].join('\n'),
})

const laptop = await A({
  name: '本机笔记本（DESKTOP-XXXXXXX）', kind: 'device', status: 'active',
  location: '本机 / 家里', serial: 'DESKTOP-XXXXXXX',
  tags: ['硬件', '本机'],
  notes: [
    'Windows，登录用户 ' + code('you') + '。Node v24.16.0 / pnpm 12.3.4 / git 2.49.0，无 Docker。',
    '',
    '在本机跑的东西：',
    '- DSH（DeepSeek Harness）',
    '- Kuma 观测台：' + code('http://127.0.0.1:3001') + '（计划任务 ' + code('KumaObs') + '，数据 ' + code('E:\\kuma') + '）',
    '- pinfolio：' + code('http://127.0.0.1:7788') + '（本应用）',
    '',
    '项目主要在 ' + code('E:\\z7z8') + '、' + code('E:\\kuma') + '、' + code('E:\\myapp-workspace') + '。',
  ].join('\n'),
})

const notes = await api('/api/notes')
const target = notes.find((n) => n.content.includes('my-server') && !n.assetId)
if (target) { await api('/api/notes/' + target.id, { method: 'PATCH', body: JSON.stringify({ assetId: wb2.id }) }); console.log('relinked note', target.id) }

const list = await api('/api/assets')
console.log('assets now:', list.length)
console.log(list.map((a) => a.id + ' ' + a.name + ' [' + a.kind + '/' + a.status + '] ' + a.tags.map((t) => '#' + t.name).join('')).join('\n'))
console.log('stats:', JSON.stringify(await api('/api/stats')))