// 观测台（卡片、筛选、Kuma 引导、详情抽屉、心跳色条）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

export const monitors: Dict = {
  // 状态词（status.ts / display.ts，label 用 getter，避免在模块加载期把语言冻住）
  '故障': 'Down',
  '正常': 'Up',
  '待定': 'Pending',
  '维护': 'Maintenance',
  '成功': 'Success',
  '部分成功': 'Partial success',
  '失败': 'Failed',
  '未运行': 'Not running',
  '关键词': 'Keyword',
  '推送': 'Push',

  // 统计条 / 表格
  '观测项': 'Monitors',
  // 中文是「25个」，英文只要数字：整条用占位符，别留空译文（空译文会让巡检与测试同时报警）
  '{n}个': (v) => `${v.n}`,
  '异常': 'Down',
  '24h 可用率': '24h uptime',
  '机器': 'Machine',
  '类型': 'Type',
  '状态': 'Status',
  '响应': 'Response',
  '最近检查': 'Last check',
  '无数据': 'No data',
  '已暂停': 'Paused',

  // 筛选条
  '所有状态': 'All statuses',
  '搜索观测项': 'Search monitors',
  '每 30 秒自动刷新': 'Auto refresh every 30 seconds',
  '自动刷新': 'Auto refresh',
  '卡片视图': 'Card view',
  '表格视图': 'Table view',
  '立即刷新': 'Refresh now',

  // 快捷入口
  '快捷入口': 'Quick links',
  '不参与观测': 'Not monitored',

  // 卡片
  '点开看详情': 'Open details',
  '最近 {n} 次心跳': (v) => `Last ${v.n} beats`,
  '本次观测情况': 'Latest result',
  '检查': 'Checked',
  '{n} 次异常': (v) => `${v.n} ${Number(v.n) === 1 ? 'failure' : 'failures'}`,

  // 空态与报错
  '读不到观测项': 'Can’t read monitors',
  'Uptime Kuma 可能没在跑（默认 http://127.0.0.1:3001）。':
    'Uptime Kuma may not be running (default http://127.0.0.1:3001).',
  '没有匹配的观测项': 'No monitors match',
  '换个筛选条件试试。': 'Try a different filter.',
  '清空筛选': 'Clear filters',

  // 没接 Kuma 时的引导卡
  '观测页还没接上 Uptime Kuma': 'The monitors page is not connected to Uptime Kuma yet',
  '这一页只是 Kuma 的界面，探测是 Kuma 在跑。没接上时': 'This page is only Kuma’s UI — Kuma does the probing. Until it is connected',
  '其余七页照常可用': 'the other seven pages work as usual',
  '，不需要为了用便签去装 Kuma。': ', and you do not need Kuma just to use notes.',
  '起一个 Uptime Kuma': 'Start an Uptime Kuma',
  '或者用你已经在跑的 Kuma（': 'Or use the Kuma you already run (adding one more service to',
  ' 里再加一个服务也行），地址能通就好。': 'works too) — as long as the address is reachable.',
  '在 Kuma 里建一个公开状态页': 'Create a public status page in Kuma',
  '状态页 → 新建，slug 填': 'Status Pages → New, set the slug to',
  '（不是这个值就设': '(set',
  '），把要看的观测项勾进去。': 'instead if you use another value), then tick the monitors you want.',
  '告诉 pinfolio 它在哪': 'Tell pinfolio where it is',
  'Docker 部署就写进': 'With Docker, put it in',
  '的': 'under',
  '；改完重启进程/容器。当前探测地址：': '; restart the process/container afterwards. Current probe address:',
  // 配置样例里的中文注释（<pre> 里的占位提示）
  '你实际的地址': 'your actual address',
  '你的 Kuma 密码': 'your Kuma password',
  '。': '.',
  '连上之后这一页会自动变成观测台（卡片 / 色条 / 详情抽屉），不用改任何代码。':
    'Once connected this page turns into the monitor board (cards / beat strips / detail drawer) with no code changes.',

  // 详情抽屉：外壳与当前状态
  '观测项详情': 'Monitor details',
  '读取中…': 'Loading…',
  '打开项目管理页': 'Open the project management page',
  '还没跑过': 'Never run yet',

  // 基本信息
  '基本信息': 'Basics',
  'Kuma 里的观测项名字，改名会同步到 CLI 和 SNAPSHOT':
    'The monitor name inside Kuma; renaming it syncs to the CLI and SNAPSHOT',
  '介绍': 'Description',
  '给这个观测项写一句人话，卡片上悬停可见': 'One plain sentence about this monitor; shows on hover over the card',
  '检查频率（秒）': 'Check interval (seconds)',
  '受下面的策略影响，真实频率可能不同': 'The policy below can change the effective interval',
  '20–86400 秒': '20–86400 seconds',
  '{n} 秒': (v) => `${v.n}s`,
  '{n} 分': (v) => `${v.n}m`,
  '类型 / 目标': 'Type / target',
  '分组': 'Group',
  '观测策略 · {name}': 'Policy · {name}',

  // 高级设置
  '高级设置（超时 / 重试）': 'Advanced (timeout / retries)',
  '超时（秒）': 'Timeout (seconds)',
  '1–120，且必须小于检查频率': '1–120, and must be less than the check interval',
  '重试次数': 'Retries',
  '0–10 次': '0–10',
  '重试间隔（秒）': 'Retry interval (seconds)',
  '显示最近一次消息': 'Show the latest message',
  '在卡片上常显': 'Always show it on the card',

  // 危险操作
  '危险操作': 'Danger zone',
  '暂停观测': 'Pause monitor',
  '恢复观测': 'Resume monitor',
  '删除观测': 'Delete monitor',
  '删除「{name}」？': 'Delete “{name}”?',
  '会连同它的历史心跳一起从 Kuma 删掉，不能撤销。删除前会自动备份一份':
    'It is removed from Kuma together with its heartbeat history and that cannot be undone. An automatic backup is taken of',
  '把观测项名字原样输一遍：{name}': 'Type the monitor name to confirm: {name}',
  '在这里输入名字': 'Type the name here',
  '删除中…': 'Deleting…',
  '确认删除': 'Confirm delete',

  // 立即观测
  '立即观测': 'Run now',
  '观测中…': 'Running…',
  '这个观测项没有可立即执行的动作。': 'This monitor has no action that can be run right away.',
  '已暂停，先恢复观测再点立即观测。': 'Paused — resume the monitor before running it.',
  '配方来源：{src}': 'Recipe from: {src}',
  '默认（重启检查循环）': 'default (restart the check loop)',
  '无': 'none',
  '这次观测没跑完': 'This run did not finish',
  '这次观测跑完了': 'This run finished',

  // 保存 / 暂停 / 恢复的提示
  '已保存': 'Saved',
  '已恢复': 'Resumed',

  // 心跳色条的悬停提示
  '时间未知': 'Time unknown',
  '第 {i}/{n} 拍': (v) => `Beat ${v.i}/${v.n}`,

  // 共用组件（Lightbox 是便签图片与观测共用的大图浮层）
  '查看大图': 'View full size',
  '关闭（Esc）': 'Close (Esc)',
}
