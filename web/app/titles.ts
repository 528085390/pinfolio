import type { HostSummary, MonitorSummary, Stats } from '../lib/api'
import type { Page } from '../lib/router'
import { dot, t } from '../lib/i18n'

export type MailSummary = { unseen: number; total: number; accounts: number }

/** 顶栏标题（e2e 不看标题文案，但侧栏/顶栏结构别动） */
export function pageTitle(page: Page): string {
  return page === 'notes' ? t('便签')
    : page === 'mail' ? t('邮件')
      : page === 'assets' ? t('资产台账')
        : page === 'monitors' ? t('观测台')
          : page === 'hosts' ? t('主机')
            : page === 'services' ? t('服务')
              : page === 'backup' ? t('备份') : t('设置')
}

/** 顶栏副标题：拿不到汇总数据时给一句静态说明（别显示 0） */
export function pageSubtitle(
  page: Page,
  s: { stats: Stats | null; mailSum: MailSummary | null; mon: MonitorSummary | null; host?: HostSummary | null },
): string {
  if (page === 'notes') {
    return s.stats
      ? dot(t('{n} 条便签', { n: s.stats.notes }), s.stats.archived ? t('{n} 条归档', { n: s.stats.archived }) : '')
      : ''
  }
  if (page === 'mail') {
    return s.mailSum
      ? dot(t('{n} 个邮箱', { n: s.mailSum.accounts }), t('{n} 封未读', { n: s.mailSum.unseen }), t('共 {n} 封', { n: s.mailSum.total }))
      : t('多邮箱合并收件箱 · 只读')
  }
  if (page === 'assets') {
    return s.stats ? dot(t('{n} 件资产', { n: s.stats.assets }), t('{n} 件在用', { n: s.stats.active })) : ''
  }
  if (page === 'monitors') {
    if (!s.mon) return t('Kuma 探测后端 · 每 30 秒刷新')
    return dot(
      t('{up}/{total} 正常', { up: s.mon.up, total: s.mon.total }),
      s.mon.down ? t('{n} 异常', { n: s.mon.down }) : '',
      s.mon.uptime24 !== null ? t('24h {p}%', { p: (s.mon.uptime24 * 100).toFixed(1) }) : '',
    )
  }
  if (page === 'hosts') {
    if (!s.host || !s.host.total) return t('服务器指标 · 每 5 分钟采集')
    return dot(
      t('{up}/{total} 在线', { up: s.host.online, total: s.host.total }),
      s.host.paused ? t('{n} 台暂停', { n: s.host.paused }) : '',
      s.host.stale ? t('{n} 台陈旧', { n: s.host.stale }) : '',
    )
  }
  if (page === 'services') return t('服务器 ↔ 服务部署关系 · 不探测')
  if (page === 'backup') return t('本机文件 + 远程数据库 · 每天 03:00')
  return t('字段、标签、账号与安全')
}
