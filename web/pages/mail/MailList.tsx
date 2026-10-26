import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { cx, type MailRow } from '../../lib/api'
import { Button, Empty, Spinner } from '../../components/ui'
import type { MailSelection } from './useInbox'
import { t } from '../../lib/i18n'

function pad(n: number) {
  return n < 10 ? '0' + n : String(n)
}

/** 列表里的时间：今天显示时刻，今年显示月/日，更早显示年/月/日 */
export function rowTime(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '/' + pad(d.getDate())
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate())
}

export function senderName(m: MailRow) {
  return m.from?.name || m.from?.address || t('（无发件人）')
}

export function MailRowItem({ m, active, onOpen }: { m: MailRow; active: boolean; onOpen: (m: MailRow) => void }) {
  return (
    <article
      className={cx('mail-row', m.unread && 'unread', m.localRead && 'local-read', active && 'active')}
      onClick={() => onOpen(m)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(m)
        }
      }}
    >
      <div className="mail-row-top">
        <span className="mail-row-from">{senderName(m)}</span>
        <span className="mail-row-time">{rowTime(m.date)}</span>
      </div>
      <div className="mail-row-subject">{m.subject || t('（无主题）')}</div>
      <div className="mail-row-snippet">{m.snippet || t('（没有可预览的正文）')}</div>
      <div className="mail-row-foot">
        <span className="mail-row-acc">{m.accountLabel}</span>
        {m.unread && !m.localRead ? <span className="mail-dot" title={t('服务器上是未读')} /> : null}
      </div>
    </article>
  )
}

export type MailListProps = {
  listRef: React.RefObject<HTMLDivElement | null>
  visible: MailRow[]
  /** 当前页已取到的全部邮件（判断空态文案用，visible 是筛选后的） */
  loadedCount: number
  loading: boolean
  folderName: string
  sel: MailSelection | null
  onOpen: (m: MailRow) => void
  offset: number
  total: number
  pageSize: number
  hasMore: boolean
  filtered: boolean
  onPrev: () => void
  onNext: () => void
}

export function MailList({ listRef, visible, loadedCount, loading, folderName, sel, onOpen, offset, total, pageSize, hasMore, filtered, onPrev, onNext }: MailListProps) {
  return (
    <section className="mail-list-pane">
      <div className="mail-list" ref={listRef}>
        {loading && !loadedCount ? (
          <div className="mail-loading">
            <Spinner /> <span>{t('正在取信…')}</span>
          </div>
        ) : null}

        {!loading && !visible.length ? (
          <Empty
            icon={<Inbox size={20} />}
            title={loadedCount ? t('没有符合筛选条件的邮件') : t('{folder} 里没有邮件', { folder: folderName })}
            text={loadedCount ? t('清空筛选条件或取消「只看未读」试试。') : t('换个文件夹看看，或者点右上角刷新。')}
          />
        ) : null}

        {visible.map((m) => (
          <MailRowItem
            key={m.accountId + ':' + m.folder + ':' + m.uid}
            m={m}
            active={!!sel && sel.accountId === m.accountId && sel.folder === m.folder && sel.uid === m.uid}
            onOpen={onOpen}
          />
        ))}
      </div>

      <div className="mail-pager">
        <Button size="sm" variant="ghost" disabled={offset === 0 || loading} onClick={onPrev}>
          <ChevronLeft size={14} /> {t('上一页')}
        </Button>
        <span className="mail-pager-info">
          {total
            ? t('{from}–{to} / 共 {total} 封', { from: offset + 1, to: Math.min(offset + pageSize, total), total })
            : t('共 {n} 封', { n: 0 })}
          {filtered ? ' · ' + t('筛选出 {n} 封', { n: visible.length }) : ''}
        </span>
        <Button size="sm" variant="ghost" disabled={!hasMore || loading} onClick={onNext}>
          {t('下一页')} <ChevronRight size={14} />
        </Button>
      </div>
    </section>
  )
}
