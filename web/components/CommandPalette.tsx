import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, StickyNote, Package, Settings, Plus, Download, CornerDownLeft, Activity } from 'lucide-react'
import { api, cx, type Asset, type Note } from '../lib/api'
import { KIND_META } from '../lib/format'
import { KindIcon } from './KindIcon'

type Item = { key: string; label: string; sub?: string; icon: React.ReactNode; run: () => void }

export function CommandPalette({ open, onClose, onNavigate, onOpenAsset }: {
  open: boolean
  onClose: () => void
  onNavigate: (page: 'notes' | 'assets' | 'monitors' | 'settings') => void
  onOpenAsset: (id: number | 'new') => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [notes, setNotes] = useState<Note[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    setNotes([])
    setAssets([])
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) { setNotes([]); setAssets([]); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.search(term)
        if (!alive) return
        setNotes(r.notes.slice(0, 5))
        setAssets(r.assets.slice(0, 5))
        setSel(0)
      } finally {
        if (alive) setLoading(false)
      }
    }, 170)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    if (!q.trim()) {
      out.push({ key: 'a1', label: '新建便签', sub: '回到便签页，直接写', icon: <StickyNote size={15} />, run: () => onNavigate('notes') })
      out.push({ key: 'a2', label: '登记资产', sub: '打开资产登记表单', icon: <Plus size={15} />, run: () => { onNavigate('assets'); onOpenAsset('new') } })
      out.push({ key: 'a3', label: '观测台', sub: '看所有观测项的实时状态', icon: <Activity size={15} />, run: () => onNavigate('monitors') })
      out.push({ key: 'a4', label: '设置', sub: '自定义字段 / 标签 / 主题', icon: <Settings size={15} />, run: () => onNavigate('settings') })
      out.push({
        key: 'a5', label: '导出 JSON 备份', icon: <Download size={15} />, run: async () => {
          const data = await api.exportAll()
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'pinboard-' + new Date().toISOString().slice(0, 10) + '.json'
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        },
      })
      return out
    }
    for (const n of notes) {
      out.push({
        key: 'n' + n.id,
        label: n.content.replace(/\s+/g, ' ').slice(0, 70),
        sub: n.tags.length ? n.tags.map((t) => '#' + t.name).join(' ') : '便签',
        icon: <StickyNote size={15} />,
        run: () => onNavigate('notes'),
      })
    }
    for (const a of assets) {
      out.push({
        key: 's' + a.id,
        label: a.name,
        sub: KIND_META[a.kind]?.label + (a.location ? ' · ' + a.location : ''),
        icon: <KindIcon kind={a.kind} size={15} />,
        run: () => { onNavigate('assets'); onOpenAsset(a.id) },
      })
    }
    return out
  }, [q, notes, assets, onNavigate, onOpenAsset])

  useEffect(() => { setSel(0) }, [items.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        const it = items[sel]
        if (it) { it.run(); onClose() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, items, sel, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-sel="1"]') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="palette-wrap" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={15} style={{ color: 'var(--muted)' }} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="搜索便签、资产，或执行命令…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="palette-list" ref={listRef}>
          {loading ? <div className="palette-group">搜索中…</div> : null}
          {!loading && q.trim() && items.length === 0 ? (
            <div className="palette-group">没有找到「{q.trim()}」</div>
          ) : null}
          {items.length > 0 ? (
            <div className="palette-group">{q.trim() ? '结果' : '命令'}</div>
          ) : null}
          {items.map((it, i) => (
            <button
              key={it.key}
              data-sel={i === sel ? '1' : '0'}
              className={cx('palette-item', i === sel && 'active')}
              onMouseEnter={() => setSel(i)}
              onClick={() => { it.run(); onClose() }}
            >
              <span style={{ color: 'var(--muted)', display: 'flex' }}>{it.icon}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                {it.sub ? <span className="snippet">{it.sub}</span> : null}
              </span>
              {i === sel ? <CornerDownLeft size={13} style={{ color: 'var(--muted)' }} /> : null}
            </button>
          ))}
        </div>
      </div>
      </div>
    </>
  )
}
