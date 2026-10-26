// 服务页（服务器视角 / 服务视角、搜索、详情）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

export const services: Dict = {
  // 字段名 / 种类
  '名字': 'Name',
  '种类': 'Kind',
  '项目目录': 'Project directory',
  '路径': 'Path',
  '启动方式': 'Startup',
  '一句话说明': 'Summary',
  '管理页': 'Admin page',
  '服务器观测': 'Server monitors',
  '项目': 'Project',
  '站点': 'Site',
  '脚本': 'Script',
  '任务': 'Task',
  '启动 · 端口': 'Startup · port',

  // 服务器抽屉
  '编辑服务器：{name}': 'Edit server: {name}',
  '添加服务器': 'Add server',
  '小写字母 / 数字 / 点 / 下划线 / 短横线；改 id 会同步改部署里的引用':
    'Lowercase letters / digits / dots / underscores / dashes; changing the id also updates the references in deployments',
  '例如 wb-server2': 'e.g. wb-server2',
  '卡片标题，与观测台组名、主机页一致': 'Card title — same as the monitor group name and the hosts page',
  '厂商 · 区域': 'Vendor · region',
  '副标题，例如 阿里云 · 北京': 'Subtitle, e.g. Alibaba Cloud · Beijing',
  '阿里云 · 北京': 'Alibaba Cloud · Beijing',
  '卡头上显示的那个地址': 'The address shown on the card header',
  '登录用户': 'Login user',
  '档案路径': 'Doc path',
  '本机文档或仓库地址，显示在卡片底部': 'Local doc or repo path, shown at the bottom of the card',
  '例如 1C1G · 东京': 'e.g. 1C1G · Tokyo',
  '服务器级观测项': 'Server-level monitors',
  '入口 / 端口这类不挂在具体部署上的；只做跳转，不在这里建观测':
    'For entry / port checks that are not tied to a deployment; links only — no monitors are created here',

  // 服务抽屉
  '编辑服务：{name}': 'Edit service: {name}',
  '添加服务': 'Add service',
  '部署里靠它指认这个服务': 'Deployments use it to refer to this service',
  '例如 wbapi': 'e.g. wbapi',
  '卡片 / 列表里显示的名字': 'Shown on the card / in the list',
  '例如 网关 API': 'e.g. Gateway API',
  '仓库或部署目录，显示在卡片底部': 'Repo or deploy directory, shown at the bottom of the card',
  '鼠标悬停与搜索都会用到': 'Used for hover tips and search',
  '例如 WorkBuddy 网关（OpenAI 兼容）': 'e.g. WorkBuddy gateway (OpenAI-compatible)',

  // 部署抽屉
  '编辑部署：{name}': 'Edit deployment: {name}',
  '添加部署': 'Add deployment',
  '部署在哪台机上': 'Which machine it runs on',
  '部署的是什么': 'What is deployed',
  '选一个服务…': 'Pick a service…',
  '服务器上的绝对路径（本机就是本机路径）': 'Absolute path on the server (the local path for this machine)',
  'systemd unit / 计划任务 / 裸命令': 'systemd unit / scheduled task / plain command',
  '监听地址，可空': 'Listen address, optional',
  '能打开的页面（面板 / 后台）；没观测时点名字就跳它':
    'A page you can open (panel / console); without a monitor, clicking the name goes here',
  '例如 不参与观测': 'e.g. not monitored',
  '有观测就点名字去观测台；没有就靠管理页':
    'With a monitor, clicking the name opens the monitors page; otherwise it uses the admin page',
  '其它观测项 id': 'Other monitor id',
  '还没登记过观测项，可以直接填 id': 'No monitors registered yet — you can type an id',
  '加上': 'Add',
  '已选 {list}': 'Selected: {list}',

  // 删除确认
  '删除服务器：{name}': 'Delete server: {name}',
  '删除服务：{name}': 'Delete service: {name}',
  '删除部署：{name}': 'Delete deployment: {name}',
  '「{name}」会从 data/services.json 里删掉（写回前自动备份一份到 data/services-backups/）。':
    '“{name}” will be removed from data/services.json (a backup is written to data/services-backups/ before saving).',
  '把「{service}」从「{server}」上移除（{path}）。只删这条登记，不动服务器上的文件。':
    'Remove “{service}” from “{server}” ({path}). Only this entry is deleted; nothing on the server is touched.',
  '把「{service}」从「{server}」上移除。只删这条登记，不动服务器上的文件。':
    'Remove “{service}” from “{server}”. Only this entry is deleted; nothing on the server is touched.',
  '先把这些删掉，再回来删这一条。': 'Delete these first, then come back to this one.',
  '手输 {need} 确认': 'Type {need} to confirm',

  // 卡片 / 行内的按钮与悬停提示
  '改这条部署': 'Edit this deployment',
  '删这条部署': 'Delete this deployment',
  '改这台服务器': 'Edit this server',
  '删这台服务器': 'Delete this server',
  '改这个服务': 'Edit this service',
  '删这个服务': 'Delete this service',
  '在「{name}」上加一条部署': 'Add a deployment on “{name}”',
  '给「{name}」再加一条部署': 'Add another deployment to “{name}”',
  '观测项 {id}': 'Monitor {id}',
  '观测：{list}': 'Monitors: {list}',
  '管理页：{url}': 'Admin page: {url}',
  '去观测台看「{name}」': 'Open “{name}” in Monitors',
  '打开管理页：{url}': 'Open admin page: {url}',
  '服务器观测：去观测台看「{name}」': 'Server monitors: open “{name}” in Monitors',
  '点一下 → 观测台看「{name}」': 'Click to open “{name}” in Monitors',
  '点一下 → 打开管理页 {url}': 'Click to open the admin page {url}',
  '没挂观测也没有管理页，点了不跳': 'No monitor or admin page — not clickable',
  '{summary}（没挂观测也没有管理页，点了不跳）': '{summary} (no monitor or admin page — not clickable)',
  '{summary}（点一下去观测台看「{name}」）': '{summary} (click to open “{name}” in Monitors)',
  '{summary}（点一下打开管理页 {url}）': '{summary} (click to open the admin page {url})',
  '{summary}（还没部署到任何服务器）': '{summary} (not deployed to any server yet)',
  '换到服务视角：看「{name}」都部署在哪几台': 'Switch to the service view: see which machines run “{name}”',
  '换到服务器视角：看「{name}」上都部署了什么': 'Switch to the server view: see what runs on “{name}”',
  '{vendor} · {ip} · {user}（点一下换到服务器视角看这台机）':
    '{vendor} · {ip} · {user} (click to switch to the server view for this machine)',
  '点右边 + 挑一台服务器': 'Use + on the right to pick a server',
  '还没部署': 'Not deployed',
  '还没登记部署': 'No deployments yet',
  '这台机还没登记部署。': 'No deployments registered for this machine yet.',

  // 汇总条 / 视角切换
  '台服务器': (v) => (Number(v.n) === 1 ? 'server' : 'servers'),
  '个服务': (v) => (Number(v.n) === 1 ? 'service' : 'services'),
  '{n} 条部署': (v) => `${v.n} ${Number(v.n) === 1 ? 'deployment' : 'deployments'}`,
  '{n} 项部署': (v) => `${v.n} ${Number(v.n) === 1 ? 'deployment' : 'deployments'}`,
  '{n} 台': (v) => `${v.n} ${Number(v.n) === 1 ? 'server' : 'servers'}`,
  '{n} 台服务器': (v) => `${v.n} ${Number(v.n) === 1 ? 'server' : 'servers'}`,
  '{n} 条挂了观测（共 {m} 项）': (v) => `${v.n} linked to monitors (${v.m} in total)`,
  '{n} 条能打开管理页': (v) => `${v.n} with an admin page`,
  '加服务器': 'Add server',
  '加服务': 'Add service',
  '服务器视角': 'Server view',
  '服务视角': 'Service view',
  '紧凑': 'Compact',
  '紧凑：一屏看全所有部署': 'Compact: all deployments on one screen',
  '详细': 'Detailed',
  '详细：带路径与启动方式': 'Detailed: with path and startup',

  // 搜索、空态与说明段
  '搜服务器 / 服务 / 路径': 'Search servers / services / paths',
  '搜服务 / 服务器': 'Search services / servers',
  '清空搜索': 'Clear search',
  '没找到「{q}」，换个关键词试试。': 'Nothing matched “{q}” — try another keyword.',
  '没有匹配的部署': 'No matching deployments',
  '正在读服务清单…': 'Loading service inventory…',
  '读不到服务清单': 'Could not load the service inventory',
  '重新读取': 'Reload',
  '还没有登记任何部署': 'No deployments registered yet',
  '在 {file} 里按 services.example.json 的格式写：servers（哪几台机）、services（哪些服务）、deploys（谁部署在谁上面）。改完刷新页面即生效。':
    'Write it in {file} following the services.example.json format: servers (which machines), services (which services), deploys (what runs where). Refresh the page after saving.',
  '只登记部署关系，': 'Deployment records only, ',
  '这一栏只登记部署关系，': 'This section only records deployments, ',
  '不做任何探测': 'no probing at all',
  '。点任意一行：挂了观测的去观测台，没观测但有管理页的打开管理页，都没有的点不动；服务器级观测在卡片底部；路径 / 启动方式 / 端口看悬停提示。':
    '. Click any row: with a monitor it opens Monitors, with only an admin page it opens that page, with neither nothing happens; server-level monitors sit at the bottom of the card; hover for path / startup / port.',
  '。点服务名：有观测去观测台，没观测就打开它的管理页（都没有的点不动）；点右边的机名小标签换到服务器视角，看那台机上还部署了什么。':
    '. Click a service name: with a monitor it opens Monitors, otherwise its admin page (nothing happens if it has neither); click a machine chip on the right to switch to the server view and see what else runs there.',
  '。点名字：有观测去观测台，没观测就打开管理页（都没有的点了不跳）；行尾的':
    '. Click a name: with a monitor it opens Monitors, otherwise the admin page (not clickable if it has neither); the',
  '换到另一个视角。': 'at the end of the row switches to the other view.',
}
