// 资产页（列表、表格、卡片、登记/编辑抽屉）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

const plural = (n: unknown, one: string, many: string) => (Number(n) === 1 ? one : many)

export const assets: Dict = {
  // 顶部四格
  '资产总数': 'Total assets',
  '件': 'items',
  '30 天内到期': 'Expiring in 30 days',
  '项': 'items',
  '已过期': 'Expired',

  // 筛选行 / 标签栏
  '所有状态': 'All statuses',
  '搜索名称/序列号/备注': 'Search name / serial / notes',
  '卡片视图': 'Card view',
  '表格视图': 'Table view',
  '全部标签': 'All tags',
  '{name}：{n} 条资产': (v) => `${v.name}: ${v.n} ${plural(v.n, 'asset', 'assets')}`,

  // 空态
  '没有匹配的资产': 'No assets match',
  '还没有登记资产': 'No assets yet',
  '换个筛选条件试试。': 'Try a different filter.',
  '设备、服务器、域名、订阅账号——都记在这里。字段可以自己加。':
    'Devices, servers, domains, subscriptions — all tracked here. You can add your own fields.',
  '登记第一件': 'Register the first one',

  // 卡片 / 表格
  '序列号': 'Serial',
  '位置': 'Location',
  '供应商': 'Vendor',
  '到期': 'Expires',

  // 登记 / 编辑抽屉
  '例如 my-server / ThinkPad X1': 'e.g. my-server / ThinkPad X1',
  '类型': 'Type',
  '状态': 'Status',
  '位置 / 归属': 'Location / owner',
  '阿里云 cn-beijing / 书房': 'aliyun cn-beijing / study',
  '阿里云 / 京东': 'Aliyun / JD',
  '序列号 / 编号': 'Serial / no.',
  'SN / 订单号 / 账号 ID': 'SN / order no. / account ID',
  '价格': 'Price',
  '购买日期': 'Purchased on',
  '到期 / 续费日': 'Expires / renews on',
  '链接': 'Link',
  '打开': 'Open',
  '空格或逗号分隔，会自动创建新标签': 'Separate with spaces or commas; new tags are created automatically',
  '服务器 阿里云': 'server aliyun',
  '支持 Markdown': 'Markdown supported',
  '配置、用途、注意事项…': 'Config, purpose, things to watch out for…',
  '备注预览': 'Notes preview',
  '是': 'Yes',

  // 关联便签
  '关联便签': 'Linked notes',
  '还没有关联便签。': 'No linked notes yet.',
  '解除关联': 'Unlink',
  '给这件资产记一条便签…': 'Jot a note about this asset…',
  'Ctrl/⌘ + Enter 添加': 'Ctrl/⌘ + Enter to add',
  '添加': 'Add',
  '创建于 {created} · 更新于 {updated}': 'Created {created} · updated {updated}',
  '参考价': 'List price',

  // 抽屉标题 / 校验与确认
  '登记新资产': 'Register new asset',
  '资产详情': 'Asset details',
  '名称不能为空': 'Name cannot be empty',
  '删除「{name}」？关联的便签会保留，但会解除关联。': 'Delete “{name}”? Linked notes are kept, but unlinked.',
}
