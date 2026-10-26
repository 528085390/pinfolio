// 邮件页的数据与交互状态：账号列表、文件夹、当前页邮件、轮询刷新、筛选、选中与 J/K 导航。
// 页面组件只负责拼装，别把这些状态再搬回 MailPage.tsx。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type MailAccount, type MailFolder, type MailRow } from '../../lib/api'
import { t } from '../../lib/i18n'

export const PAGE = 50

/**
 * 自动刷新间隔：默认 60 秒。
 * ?poll=毫秒 可覆盖（自动化测试与手工调参用），夹在 1 秒 ~ 1 小时之间。
 */
export const POLL_MS = (() => {
  const q = Number(new URLSearchParams(window.location.search).get('poll'))
  if (Number.isFinite(q) && q >= 1000) return Math.min(q, 3_600_000)
  return 60_000
})()

export type MailSelection = { accountId: number; folder: string; uid: number }

export function useInbox() {
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
  const [sel, setSel] = useState<MailSelection | null>(null)
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
      setListError(
        res.errors && res.errors.length
          ? res.errors.map((e) => t('{label}：{error}', { label: e.label || t('账号'), error: e.error })).join(t('；'))
          : '',
      )
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

  /** 手机上从正文退回列表（宽屏下没有入口，保留状态无害） */
  const close = useCallback(() => setSel(null), [])

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
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
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

  const folderName = folders.find((f) => f.path === folder)?.name || (folder === 'INBOX' ? t('收件箱') : folder)
  const unseenTotal = accounts.reduce((n, a) => n + (a.unseen || 0), 0)

  return {
    accounts, accountsLoaded, accountFilter, setAccountFilter, folder, setFolder, folders,
    items, total, unseen, hasMore, offset, loading, refreshing, listError, fetchedAt,
    q, setQ, unreadOnly, setUnreadOnly, sel, open, close, visible,
    drawer, setDrawer, refresh, fetchList, fetchAccounts,
    listRef, folderName, unseenTotal,
  }
}
