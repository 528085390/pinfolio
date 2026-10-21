import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, CircleAlert, FolderOpen, Inbox, Mail, RefreshCw, Search, Settings2,
} from 'lucide-react'
import { api, cx, type MailAccount, type MailFolder, type MailRow } from '../lib/api'
import { Button, Empty, Spinner } from '../components/ui'
import { MailReader } from '../components/MailReader'
import { MailAccountDrawer } from '../components/MailAccountDrawer'

const PAGE = 50

/**
 * 自动刷新间隔：默认 60 秒。
 * ?poll=毫秒 可覆盖（自动化测试与手工调参用），夹在 1 秒 ~ 1 小时之间。
 */
const POLL_MS = (() => {
  const q = Number(new URLSearchParams(window.location.search).get('poll'))
  if (Number.isFinite(q) && q >= 1000) return Math.min(q, 3_600_000)
  return 60_000
})()

type Sel = { accountId: number; folder: string; uid: number }

function pad(n: number) {
  return n < 10 ? '0' + n : String(n)
}

/** 列表里的时间：今天显示时刻，今年显示月/日，更早显示年/月/日 */
function rowTime(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '/' + pad(d.getDate())
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate())
}

function senderName(m: MailRow) {
  return m.from?.name || m.from?.address || '（无发件人）'
}

export function MailPage({ onSummary }: { onSummary?: (s: { unseen: number; total: number; accounts: number }) => void }) {
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountFilter, setAccountFilter] = useState<'all' | number>('all')
  const [folder, setFolder] = useState('INBOX')
  const [folders, setFolders] = useState<MailFolder[]>([])

  const [items, setItems] = useState<MailRow[]>([])
  const [total, setTotal] = useState(0)
  const [unseen, setUnseen] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [listError, setListError] = useState('')
  /** 这批列表数据真正从服务器取回的时刻（服务端 fetchedAt），用来显示「数据截至」 */
  const [fetchedAt, setFetchedAt] = useState(0)

  const [q, setQ] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [sel, setSel] = useState<Sel | null>(null)
  const [drawer, setDrawer] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  /** 轮询时要知道当前翻到第几页，但不希望分页动作重建定时器 */
  const offsetRef = useRef(0)

  const fetchAccounts = useCallback(async (fresh = false) => {
    try {
      const r = await api.mail.accounts({ counts: true, folder, fresh })
      setAccounts(r.accounts)
    } catch {
      // 账号列表取不到时列表接口的报错更有用，这里不覆盖
    } finally {
      setAccountsLoaded(true)
    }
  }, [folder])

  const fetchList = useCallback(async (off: number, fresh: boolean, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await api.mail.messages({ account: accountFilter, folder, limit: PAGE, offset: off, fresh })
      if (res.noAccounts) {
        setItems([])
        setTotal(0)
        setHasMore(false)
        setUnseen(0)
        setOffset(0)
        setListError('')
        return
      }
      setItems(res.items)
      setTotal(res.total)
      setHasMore(res.hasMore)
      setUnseen(res.unseen)
      setFetchedAt(res.fetchedAt || Date.now())
      setOffset(off)
      setListError(res.errors && res.errors.length ? res.errors.map((e) => (e.label || '账号') + '：' + e.error).join('；') : '')
    } catch (e: any) {
      // 保留旧列表，避免刷新失败时整页变空
      setListError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [accountFilter, folder])

  // 进页面 / 切账号 / 切文件夹：自动拉一次（走 60 秒服务端缓存，不重复打 IMAP）
  useEffect(() => {
    setSel(null)
    fetchList(0, false)
  }, [fetchList])

  useEffect(() => {
    fetchAccounts(false)
  }, [fetchAccounts])

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  // 自动刷新：页面可见时每 POLL_MS 静默拉一次（fresh=1 绕过 60 秒缓存，只刷新列表与未读数，
  // 不动正文、不动选中项）。切到后台就停，回到前台立刻补一次。
  useEffect(() => {
    if (!accountsLoaded || !accounts.length) return
    let busy = false
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        await Promise.all([fetchList(offsetRef.current, true, true), fetchAccounts(true)])
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(tick, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [accountsLoaded, accounts.length, fetchList, fetchAccounts])

  // 文件夹下拉：按当前账号取（"全部"时用第一个账号的文件夹当代表）
  const firstAccountId = accounts[0]?.id
  useEffect(() => {
    const id = accountFilter === 'all' ? firstAccountId : accountFilter
    if (!id) {
      setFolders([])
      return
    }
    let alive = true
    api.mail
      .folders(id)
      .then((r) => {
        if (!alive) return
        setFolders(r.folders)
        if (r.folders.length && !r.folders.some((f) => f.path === folder)) setFolder('INBOX')
      })
      .catch(() => {
        if (alive) setFolders([])
      })
    return () => {
      alive = false
    }
  }, [accountFilter, firstAccountId])

  useEffect(() => {
    onSummary?.({ unseen, total, accounts: accounts.length })
  }, [unseen, total, accounts.length, onSummary])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([fetchList(offset, true), fetchAccounts(true)])
    } finally {
      setRefreshing(false)
    }
  }, [fetchList, fetchAccounts, offset])

  const open = useCallback((m: MailRow) => {
    setSel({ accountId: m.accountId, folder: m.folder, uid: m.uid })
    // 本地已读：行变暗 + 写本地库，服务器上的 \Seen 一律不碰
    setItems((prev) => prev.map((x) => (x.accountId === m.accountId && x.folder === m.folder && x.uid === m.uid ? { ...x, localRead: true } : x)))
    api.mail.markRead({ account: m.accountId, folder: m.folder, uid: m.uid }).catch(() => {})
  }, [])

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter((m) => {
      if (unreadOnly && (!m.unread || m.localRead)) return false
      if (!kw) return true
      const hay = [m.subject, m.from?.name, m.from?.address, m.snippet, m.accountLabel].join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }, [items, q, unreadOnly])

  // J / K 上下切换（P2 键盘导航）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const key = e.key.toLowerCase()
      if (key !== 'j' && key !== 'k') return
      if (!visible.length) return
      e.preventDefault()
      const cur = sel ? visible.findIndex((m) => m.accountId === sel.accountId && m.folder === sel.folder && m.uid === sel.uid) : -1
      const next = key === 'j' ? Math.min(visible.length - 1, cur + 1) : Math.max(0, cur - 1)
      const target = visible[next]
      if (target) open(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, sel, open])

  const folderName = folders.find((f) => f.path === folder)?.name || (folder === 'INBOX' ? '收件箱' : folder)
  const unseenTotal = accounts.reduce((n, a) => n + (a.unseen || 0), 0)

  if (accountsLoaded && accounts.length === 0) {
    return (
      <div className="mail-page mail-page-empty">
        <Empty
          icon={<Mail size={22} />}
          title="还没有添加邮箱"
          text={
            <>
              支持 Gmail / QQ / 163 等任意 IMAP 邮箱，只收信、不改变服务器上的任何状态。
              <br />
              Gmail 用「应用专用密码」，QQ 和 163 用「授权码」。
            </>
          }
          action={
            <Button variant="primary" onClick={() => setDrawer(true)}>
              <Mail size={14} /> 添加邮箱
            </Button>
          }
        />
        <MailAccountDrawer open={drawer} accounts={accounts} onClose={() => setDrawer(false)} onChanged={() => { fetchAccounts(true); fetchList(0, true) }} />
      </div>
    )
  }

  return (
    <div className="mail-page">
      <div className="mail-toolbar">
        <div className="mail-chips">
          <button type="button" className={cx('chip', accountFilter === 'all' && 'active')} onClick={() => setAccountFilter('all')}>
            全部
            {unseenTotal ? <span className="chip-count">{unseenTotal}</span> : null}
          </button>
          {accounts.map((a) => (
            <button
              type="button"
              key={a.id}
              className={cx('chip', accountFilter === a.id && 'active')}
              onClick={() => setAccountFilter(a.id)}
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
              onChange={(e) => setFolder(e.target.value)}
              title="选择文件夹（只读）"
            >
              {(folders.length ? folders : [{ path: 'INBOX', name: '收件箱', delimiter: '/', specialUse: null }]).map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {fetchedAt ? (
            <span
              className="mail-updated"
              title={'每 ' + Math.round(POLL_MS / 1000) + ' 秒自动刷新；页面切到后台时暂停。这个时间是数据从邮箱服务器取回的时刻（可能命中 60 秒缓存）。'}
            >
              数据截至 {new Date(fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            disabled={refreshing}
            title="立即刷新（绕过 60 秒缓存）"
          >
            <RefreshCw size={14} className={cx(refreshing && 'spin')} />
            {refreshing ? '刷新中' : '刷新'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawer(true)} title="管理邮箱账号">
            <Settings2 size={14} /> 邮箱
          </button>
        </div>
      </div>

      <div className="mail-search">
        <Search size={14} className="mail-search-icon" />
        <input
          className="input input-sm"
          placeholder={'在当前已加载的 ' + items.length + ' 封里筛选（发件人 / 主题 / 摘要）'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="mail-check">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> 只看未读
        </label>
      </div>

      {listError ? <div className="alert mail-alert">{listError}</div> : null}

      <div className="mail-body">
        <section className="mail-list-pane">
          <div className="mail-list" ref={listRef}>
            {loading && !items.length ? (
              <div className="mail-loading">
                <Spinner /> <span>正在取信…</span>
              </div>
            ) : null}

            {!loading && !visible.length ? (
              <Empty
                icon={<Inbox size={20} />}
                title={items.length ? '没有符合筛选条件的邮件' : folderName + '里没有邮件'}
                text={items.length ? '清空筛选条件或取消「只看未读」试试。' : '换个文件夹看看，或者点右上角刷新。'}
              />
            ) : null}

            {visible.map((m) => {
              const active = sel && sel.accountId === m.accountId && sel.folder === m.folder && sel.uid === m.uid
              return (
                <article
                  key={m.accountId + ':' + m.folder + ':' + m.uid}
                  className={cx('mail-row', m.unread && 'unread', m.localRead && 'local-read', active && 'active')}
                  onClick={() => open(m)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      open(m)
                    }
                  }}
                >
                  <div className="mail-row-top">
                    <span className="mail-row-from">{senderName(m)}</span>
                    <span className="mail-row-time">{rowTime(m.date)}</span>
                  </div>
                  <div className="mail-row-subject">{m.subject || '（无主题）'}</div>
                  <div className="mail-row-snippet">{m.snippet || '（没有可预览的正文）'}</div>
                  <div className="mail-row-foot">
                    <span className="mail-row-acc">{m.accountLabel}</span>
                    {m.unread && !m.localRead ? <span className="mail-dot" title="服务器上是未读" /> : null}
                  </div>
                </article>
              )
            })}
          </div>

          <div className="mail-pager">
            <Button size="sm" variant="ghost" disabled={offset === 0 || loading} onClick={() => fetchList(Math.max(0, offset - PAGE), true)}>
              <ChevronLeft size={14} /> 上一页
            </Button>
            <span className="mail-pager-info">
              {total ? offset + 1 + '–' + Math.min(offset + PAGE, total) + ' / 共 ' + total + ' 封' : '共 0 封'}
              {q || unreadOnly ? ' · 筛选出 ' + visible.length + ' 封' : ''}
            </span>
            <Button size="sm" variant="ghost" disabled={!hasMore || loading} onClick={() => fetchList(offset + PAGE, true)}>
              下一页 <ChevronRight size={14} />
            </Button>
          </div>
        </section>

        <section className="mail-reader-pane">
          {sel ? (
            <MailReader key={sel.accountId + ':' + sel.folder + ':' + sel.uid} accountId={sel.accountId} folder={sel.folder} uid={sel.uid} folderLabel={folderName} />
          ) : (
            <div className="mail-reader-empty">
              <Empty icon={<Inbox size={20} />} title="选一封邮件" text="点左边的邮件，正文就显示在这里（不会把服务器上的邮件标成已读）。" />
            </div>
          )}
        </section>
      </div>

      <MailAccountDrawer
        open={drawer}
        accounts={accounts}
        onClose={() => setDrawer(false)}
        onChanged={() => {
          fetchAccounts(true)
          fetchList(offset, true)
        }}
      />
    </div>
  )
}
