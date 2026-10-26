// 外壳层（侧栏、顶栏、命令面板、异常通知）与页面标题/副标题。
// 这些文案切语言时必须立刻变，所以都走 t()；页面内部的长文案按页拆到别的文件。
import type { Dict } from '../core'

export const shell: Dict = {
  // 页面名（侧栏导航、顶栏标题、命令面板共用一套说法）
  '便签': 'Notes',
  '邮件': 'Mail',
  '资产': 'Assets',
  '资产台账': 'Assets',
  '观测': 'Monitors',
  '观测台': 'Monitors',
  '主机': 'Hosts',
  '主机指标': 'Host metrics',
  '服务': 'Services',
  '备份': 'Backups',
  '设置': 'Settings',

  // 顶栏副标题
  '{n} 条便签': (v) => `${v.n} ${Number(v.n) === 1 ? 'note' : 'notes'}`,
  '{n} 条归档': (v) => `${v.n} archived`,
  '{n} 个邮箱': (v) => `${v.n} ${Number(v.n) === 1 ? 'mailbox' : 'mailboxes'}`,
  '{n} 封未读': (v) => `${v.n} unread`,
  '共 {n} 封': (v) => `${v.n} total`,
  '多邮箱合并收件箱 · 只读': 'Merged inbox · read-only',
  '{n} 件资产': (v) => `${v.n} ${Number(v.n) === 1 ? 'asset' : 'assets'}`,
  '{n} 件在用': (v) => `${v.n} active`,
  'Kuma 探测后端 · 每 30 秒刷新': 'Kuma probe backend · refreshes every 30s',
  '{up}/{total} 正常': '{up}/{total} up',
  '{n} 异常': (v) => `${v.n} down`,
  '服务器指标 · 每 5 分钟采集': 'Server metrics · collected every 5 min',
  '{up}/{total} 在线': '{up}/{total} online',
  '{n} 台暂停': (v) => `${v.n} paused`,
  '{n} 台陈旧': (v) => `${v.n} stale`,
  '服务器 ↔ 服务部署关系 · 不探测': 'Server ↔ service deployments · no probing',
  '本机文件 + 远程数据库 · 每天 03:00': 'Local files + remote databases · daily at 03:00',
  '字段、标签、账号与安全': 'Fields, tags, account and security',

  // 设置页外观卡（主题 + 语言）
  '外观': 'Appearance',
  '主题': 'Theme',
  '语言': 'Language',
  '浅色': 'Light',
  '深色': 'Dark',
  '跟随系统': 'System',
  '中文': 'Chinese',

  // 侧栏底部
  '数据只存在本机': 'Data stays on this machine',
  '切换深浅色': 'Toggle light / dark',
  '退出登录': 'Sign out',
  '服务器 ↔ 服务部署关系': 'Server ↔ service deployment map',

  // 顶栏搜索按钮
  '快速搜索 / 命令': 'Quick search / commands',

  // 接口错误横幅（服务端返回的文案自己已经是目标语言）
  '接口出错：{msg}': 'API error: {msg}',

  // 命令面板
  '搜索便签、资产，或执行命令…': 'Search notes, assets, or run a command…',
  '搜索中…': 'Searching…',
  '新建便签': 'New note',
  '回到便签页，直接写': 'Jump to the notes page and start writing',
  '多邮箱合并收件箱（只读）': 'Merged inbox from all mailboxes (read-only)',
  '登记资产': 'Register asset',
  '打开资产登记表单': 'Open the asset form',
  '看所有观测项的实时状态': 'Live status of every monitor',
  '6 台服务器的 CPU / 内存 / 磁盘 / 服务': 'CPU / memory / disk / services on 6 servers',
  '服务器 ↔ 服务的部署关系（不做探测）': 'Server ↔ service deployment map (no probing)',
  '自定义字段 / 标签 / 主题': 'Custom fields / tags / theme',
  '导出 JSON 备份': 'Export JSON backup',
  '结果': 'Results',
  '命令': 'Commands',
  '没有找到「{q}」': 'No results for “{q}”',

  // 观测异常通知
  '观测异常通知': 'Monitor alerts',
  '点击跳到观测台对应卡片': 'Click to jump to the card on the monitors page',
  '关闭通知': 'Dismiss alert',
  '打开观测台看全部': 'Open the monitors page to see them all',
  '还有 {n} 条异常 · 查看全部': (v) =>
    `${v.n} more ${Number(v.n) === 1 ? 'alert' : 'alerts'} · view all`,
}
