// 设置页（字段、标签、数据、安全、隧道）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

export const settings: Dict = {
  // 自定义字段（FieldsCard + fields.ts）
  '自定义资产字段': 'Custom asset fields',
  '给资产加自己的字段，例如「密钥存放位置」「续费周期」「机房」。字段对所有资产通用。':
    'Add your own fields to assets, e.g. "key location", "renewal cycle", "datacenter". Fields apply to every asset.',
  '还没有自定义字段。': 'No custom fields yet.',
  '删除字段': 'Delete field',
  'key（英文，不可重复）': 'key (English, must be unique)',
  '选项': 'Options',
  '选项（逗号分隔）': 'Options (comma-separated)',
  '密钥存放位置': 'Key location',
  '月付, 季付, 年付': 'Monthly, quarterly, yearly',
  '添加字段': 'Add field',
  '文本': 'Text',
  '数字': 'Number',
  '日期': 'Date',
  '单选': 'Single choice',
  '开关': 'Toggle',
  '字段 key 和显示名都要填': 'Both the field key and the display name are required',
  '删除字段「{label}」？已填的值会留在数据里但不再显示。':
    'Delete field "{label}"? Values already entered stay in the data but are no longer shown.',
  '字段已添加': 'Field added',

  // 标签（TagsCard）
  '删除标签': 'Delete tag',
  '还没有标签。在便签里写 #标签 会自动创建。': 'No tags yet. Write #tag in a note to create one automatically.',
  '新标签名': 'New tag name',
  '删除标签「#{name}」？便签和资产本身不会被删除。':
    'Delete tag "#{name}"? The notes and assets themselves are not deleted.',

  // 数据（DataCard）
  '数据': 'Data',
  '数据保存在本机 data/pinboard.db（SQLite），不联网、无第三方账号。建议定期导出 JSON 备份。':
    'Data lives on this machine in data/pinboard.db (SQLite): no network, no third-party account. Exporting a JSON backup regularly is recommended.',
  '导出 JSON': 'Export JSON',
  '写入示例数据': 'Write sample data',
  '已导出 JSON 备份': 'JSON backup exported',
  '示例数据已写入': 'Sample data written',

  // 安全（SecurityCard）
  '安全': 'Security',
  '登录的设备': 'Signed-in devices',
  '当前': 'Current',
  '最近 {time}': 'Active {time}',
  '已踢下线': 'Signed out',
  '踢下线': 'Sign out',
  '其他设备已全部下线': 'All other devices signed out',
  '其他设备全部下线': 'Sign out all other devices',
  '修改密码': 'Change password',
  '当前密码': 'Current password',
  '新密码（至少 8 位）': 'New password (8+ characters)',
  '新密码至少 8 位': 'The new password must be at least 8 characters',
  '密码已更新，其他设备已下线': 'Password updated; other devices signed out',
  'API token（脚本 / 集成用）': 'API tokens (for scripts / integrations)',
  '建于 {date}': 'Created {date}',
  '用过 {time}': 'Used {time}',
  '从未使用': 'Never used',
  'token 已删除': 'Token deleted',
  'token 只显示这一次，请立刻复制': 'This token is shown only once, copy it now',
  '用途，例如 seed 脚本': 'Purpose, e.g. seed script',
  '生成 token': 'Generate token',
  '未知设备': 'Unknown device',

  // 公网访问（TunnelCard）
  '公网访问': 'Public access',
  '手机 / 平板要看这台机器的数据，就得有一条从公网到这里的路（frp 隧道或任意反代）。 填好公网地址后，本机会每 60 秒请求一次这个地址自检，状态显示「在线」就说明外面能打开。':
    'To view this machine from a phone or tablet, there must be a route from the internet to here (an frp tunnel or any reverse proxy). Once the public address is filled in, this machine requests it every 60 seconds; a status of "Online" means it opens from outside.',
  '保存并检测': 'Save and test',
  '已保存，公网可达': 'Saved, reachable from the internet',
  '已保存，但暂时没连上': 'Saved, but not reachable right now',
  '地址已复制': 'Address copied',
  '复制失败，请手动选中': 'Copy failed, select it manually',
  '连不上': 'Unreachable',
  '未检测': 'Not checked',
  '未配置': 'Not configured',
  '检测于 {time}': 'Checked {time}',
  '上次正常 {time}': 'Last OK {time}',
  '立即检测': 'Check now',
  '复制访问地址': 'Copy address',
  '怎么接 frp（点击展开）': 'How to set up frp (click to expand)',
  '服务器上装 frps 并把 443 的': 'Install frps on the server and reverse-proxy',
  '反代到 frps（复用现有证书，不用开新端口）， 家里这台按下面跑 frpc。改完回到这里点「立即检测」。':
    'to frps (reuse the existing certificate, no new port needed); run frpc on this machine as shown below. After changing anything, come back and click "Check now".',

  // ── 出站模式（OutboundCard / outbound.ts / useOutbound.ts）─────────────────────
  // spec §10.5 的 18 个逻辑键在这里落地（本词典是「中文原文 → 英译」，所以键就是中文原文）：
  //   outbound.title        → '出站模式'
  //   outbound.mode.direct  → '直连'          outbound.mode.proxy → '经代理'
  //   outbound.protocol.*   → '协议' + PROTOCOLS 的 4 个协议名（socks5h / socks5 / http / https
  //                           是标识符，下拉里原样显示、不翻译 —— spec §17-② 说先全放出来）
  //   outbound.host         → '代理主机'（别写成 '主机'：shell.ts 里那条是页面名 Hosts）
  //   outbound.port         → 复用 mail.ts 的 '端口'
  //   outbound.username     → 复用 mail.ts 的 '用户名'
  //   outbound.password     → 复用 auth.ts 的 '密码'
  //   outbound.saved        → '已切换，正在重新探测 {n} 个观测项…'
  //   outbound.testing      → 复用 mail.ts 的 '测试中…'
  //   outbound.testOk       → '已排队重探 {n} 个观测项，几秒后看观测台'
  //   outbound.testFail     → '没有可重探的观测项'
  //   outbound.hint.green   → 灰字①（逐字照 spec §10.1 第 4 点）  outbound.hint.notify → 灰字②
  //   outbound.pin.follow / .direct / .proxy → '跟随全局' / '钉：直连' / '钉：代理'
  //                           （按 status quo 放这里；Ruling R3 把徽标 / 抽屉的键归 monitors.ts，
  //                             Task 12/14 可以直接复用这三条，别在新文件里再写一遍）
  //   outbound.changedAt    → '上次切换：刚刚 / {n} 分钟前 / {time}'
  '出站模式': 'Outbound mode',
  '观测台的所有探测（HTTP / TCP / SSH）都从这条出口出去。切到「直连」时下面的代理配置会留着，切回「经代理」不用重填。':
    'Every probe on the monitors page (HTTP / TCP / SSH) leaves through this route. Switching to "Direct" keeps the proxy settings below, so switching back does not need them re-entered.',
  '直连': 'Direct',
  '经代理': 'Via proxy',
  '协议': 'Protocol',
  '代理主机': 'Proxy host',
  '可空': 'Optional',
  '已保存，留空表示不修改': 'Saved — leave it blank to keep it',
  '清除密码': 'Clear password',
  '撤销清除': 'Undo clear',
  '保存后清除已存密码': 'The stored password will be cleared when you save',
  '测试连通': 'Test connectivity',
  '正在读取出站设置…': 'Reading outbound settings…',
  '还没读取出站设置：保存与测试连通先禁用，免得把真实出站误切成直连':
    'Outbound settings have not loaded yet: Save and Test are disabled so the real outbound mode cannot be switched to direct by accident',
  '出站：直连': 'Outbound: direct',
  '出站：经代理 {proxy}': 'Outbound: via proxy {proxy}',
  '出站：经代理（还没配代理）': 'Outbound: via proxy (none configured yet)',
  '已切换，正在重新探测 {n} 个观测项…': 'Switched — re-checking {n} monitors…',
  '已切换（没有需要重探的观测项）': 'Switched (there are no monitors to re-check)',
  '已排队重探 {n} 个观测项，几秒后看观测台': 'Re-check queued for {n} monitors; look at the monitors page in a few seconds',
  '没有可重探的观测项': 'There are no monitors to re-check',
  '经代理的绿色只代表机器存活，不代表国内直连可用':
    'Green through a proxy only means the machine is alive, not that the target is reachable from China without a proxy',
  '通知推送（webhook / 邮件）不受此开关影响，仍走直连':
    'Notification delivery (webhook / mail) is unaffected by this switch and still goes direct',
  '跟随全局': 'Follow global',
  '钉：直连': 'Pinned: direct',
  '钉：代理': 'Pinned: proxy',
  '上次切换：刚刚': 'Last switched: just now',
  '上次切换：{n} 分钟前': 'Last switched: {n} min ago',
  '上次切换：{time}': 'Last switched: {time}',
}
