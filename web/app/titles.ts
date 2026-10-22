import type { HostSummary, MonitorSummary, Stats } from '../lib/api'
import type { Page } from '../lib/router'

export type MailSummary = { unseen: number; total: number; accounts: number }

/** 顶栏标题（e2e 不看标题文案，但侧栏/顶栏结构别动） */
export function pageTitle(page: Page): string {
  return page === 'notes' ? '便签'
    : page === 'mail' ? '邮件'
      : page === 'assets' ? '资产台账'
        : page === 'monitors' ? '观测台'
          : page === 'hosts' ? '主机' : '设置'
}

/** 顶栏副标题：拿不到汇总数据时给一句静态说明（别显示 0） */
export function pageSubtitle(
  page: Page,
  s: { stats: Stats | null; mailSum: MailSummary | null; mon: MonitorSummary | null; host?: HostSummary | null },
): string {
  if (page === 'notes') {
    return s.stats ? s.stats.notes + ' 条便签' + (s.stats.archived ? ' · ' + s.stats.archived + ' 条归档' : '') : ''
  }
  if (page === 'mail') {
    return s.mailSum
      ? s.mailSum.accounts + ' 个邮箱 · ' + s.mailSum.unseen + ' 封未读 · 共 ' + s.mailSum.total + ' 封'
      : '多邮箱合并收件箱 · 只读'
  }
  if (page === 'assets') {
    return s.stats ? s.stats.assets + ' 件资产 · ' + s.stats.active + ' 件在用' : ''
  }
  if (page === 'monitors') {
    if (!s.mon) return 'Kuma 探测后端 · 每 30 秒刷新'
    return s.mon.up + '/' + s.mon.total + ' 正常'
      + (s.mon.down ? ' · ' + s.mon.down + ' 异常' : '')
      + (s.mon.uptime24 !== null ? ' · 24h ' + (s.mon.uptime24 * 100).toFixed(1) + '%' : '')
  }
  if (page === 'hosts') {
    if (!s.host || !s.host.total) return '服务器指标 · 每 5 分钟采集'
    return s.host.online + '/' + s.host.total + ' 在线'
      + (s.host.paused ? ' · ' + s.host.paused + ' 台暂停' : '')
      + (s.host.stale ? ' · ' + s.host.stale + ' 台陈旧' : '')
  }
  return '字段、标签、备份'
}
