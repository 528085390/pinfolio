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
}
