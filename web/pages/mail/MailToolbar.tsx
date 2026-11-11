import { CircleAlert, FolderOpen, RefreshCw, Search, Settings2 } from 'lucide-react'
import { cx, type MailAccount, type MailFolder } from '../../lib/api'
import { POLL_MS } from './useInbox'
import { localeTag, t } from '../../lib/i18n'

/** 顶部两行：账号 chips + 文件夹/刷新/邮箱管理，然后是在已加载邮件里筛选。 */
export function MailToolbar({ accounts, accountFilter, onAccountFilter, unseenTotal, folders, folder, onFolder, fetchedAt, syncing, progress, refreshing, onRefresh, onOpenAccounts, loadedCount, q, onQ, unreadOnly, onUnreadOnly }: {
  accounts: MailAccount[]
  accountFilter: 'all' | number
  onAccountFilter: (v: 'all' | number) => void
  unseenTotal: number
  folders: MailFolder[]
  folder: string
  onFolder: (v: string) => void
  fetchedAt: number
  /** 后台增量同步是否在跑 */
  syncing: boolean
  progress: { done: number; total: number } | null
  refreshing: boolean
  onRefresh: () => void
  onOpenAccounts: () => void
  loadedCount: number
  q: string
  onQ: (v: string) => void
  unreadOnly: boolean
  onUnreadOnly: (v: boolean) => void
}) {
  return (
    <>
      <div className="mail-toolbar">
        <div className="mail-chips">
          <button type="button" className={cx('chip', accountFilter === 'all' && 'active')} onClick={() => onAccountFilter('all')}>
            {t('全部')}
            {unseenTotal ? <span className="chip-count">{unseenTotal}</span> : null}
          </button>
          {accounts.map((a) => (
            <button
              type="button"
              key={a.id}
              className={cx('chip', accountFilter === a.id && 'active')}
              onClick={() => onAccountFilter(a.id)}
              title={a.error ? a.error : a.email || a.username}
            >
              {a.error ? <CircleAlert size={12} className="mail-chip-err" /> : null}
              {a.label || a.email || a.username}
              {a.unseen ? <span className="chip-count">{a.unseen}</span> : null}
            </button>
          ))}
        </div>

        <div className="mail-tools">
          <div className="mail-folder">
            <FolderOpen size={13} />
            <select
              className="select input-sm"
              value={folder}
              onChange={(e) => onFolder(e.target.value)}
              title={t('选择文件夹（只读）')}
            >
              {(folders.length ? folders : [{ path: 'INBOX', name: t('收件箱'), delimiter: '/', specialUse: null }]).map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {syncing ? (
            <span
              className="mail-updated mail-syncing"
              title={t('后台正在把这个账号的新邮件同步到本机库；同步完成后列表会自动更新。')}
            >
              <RefreshCw size={12} className="spin" />
              {progress && progress.total ? t('同步中 {done}/{total}', { done: progress.done, total: progress.total }) : t('同步中…')}
            </span>
          ) : fetchedAt ? (
            <span
              className="mail-updated"
              title={t('服务端后台每 {n} 秒同步一次邮箱；页面切到后台时暂停。这个时间是最近一次同步完成的时刻。', { n: Math.round(POLL_MS / 1000) })}
            >
              {t('数据截至 {time}', { time: new Date(fetchedAt).toLocaleTimeString(localeTag(), { hour12: false }) })}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={refreshing}
            title={t('立即刷新（绕过 60 秒缓存）')}
          >
            <RefreshCw size={14} className={cx(refreshing && 'spin')} />
            {refreshing ? t('刷新中') : t('刷新')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenAccounts} title={t('管理邮箱账号')}>
            <Settings2 size={14} /> {t('邮箱')}
          </button>
        </div>
      </div>

      <div className="mail-search">
        <Search size={14} className="mail-search-icon" />
        <input
          className="input input-sm"
          placeholder={t('在当前已加载的 {n} 封里筛选（发件人 / 主题 / 摘要）', { n: loadedCount })}
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
        <label className="mail-check">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => onUnreadOnly(e.target.checked)} /> {t('只看未读')}
        </label>
      </div>
    </>
  )
}
