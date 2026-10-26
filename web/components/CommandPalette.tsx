import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, StickyNote, Mail, Package, Settings, Plus, Download, CornerDownLeft, Activity, Boxes, Server } from 'lucide-react'
import { api, cx, type Asset, type Note } from '../lib/api'
import { KindIcon } from './KindIcon'
import { assetSub, moveSel, noteLabel, noteSub, paletteHint } from './command-palette/items'
import { t } from '../lib/i18n'

type Item = { key: string; label: string; sub?: string; icon: React.ReactNode; run: () => void }

export function CommandPalette({ open, onClose, onNavigate, onOpenAsset }: {
  open: boolean
  onClose: () => void
  onNavigate: (page: 'notes' | 'mail' | 'assets' | 'monitors' | 'hosts' | 'services' | 'settings') => void
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
    const timer = setTimeout(async () => {
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
    return () => { alive = false; clearTimeout(timer) }
  }, [q, open])

  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    if (!q.trim()) {
      out.push({ key: 'a1', label: t('新建便签'), sub: t('回到便签页，直接写'), icon: <StickyNote size={15} />, run: () => onNavigate('notes') })
      out.push({ key: 'a2m', label: t('邮件'), sub: t('多邮箱合并收件箱（只读）'), icon: <Mail size={15} />, run: () => onNavigate('mail') })
      out.push({ key: 'a2', label: t('登记资产'), sub: t('打开资产登记表单'), icon: <Plus size={15} />, run: () => { onNavigate('assets'); onOpenAsset('new') } })
      out.push({ key: 'a3', label: t('观测台'), sub: t('看所有观测项的实时状态'), icon: <Activity size={15} />, run: () => onNavigate('monitors') })
      out.push({ key: 'a3h', label: t('主机'), sub: t('6 台服务器的 CPU / 内存 / 磁盘 / 服务'), icon: <Server size={15} />, run: () => onNavigate('hosts') })
      out.push({ key: 'a3s', label: t('服务'), sub: t('服务器 ↔ 服务的部署关系（不做探测）'), icon: <Boxes size={15} />, run: () => onNavigate('services') })
      out.push({ key: 'a4', label: t('设置'), sub: t('自定义字段 / 标签 / 主题'), icon: <Settings size={15} />, run: () => onNavigate('settings') })
      out.push({
        key: 'a5', label: t('导出 JSON 备份'), icon: <Download size={15} />, run: async () => {
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
        label: noteLabel(n.content),
        sub: noteSub(n.tags),
        icon: <StickyNote size={15} />,
        run: () => onNavigate('notes'),
      })
    }
    for (const a of assets) {
      out.push({
        key: 's' + a.id,
        label: a.name,
        sub: assetSub(a),
        icon: <KindIcon kind={a.kind} size={15} />,
        run: () => { onNavigate('assets'); onOpenAsset(a.id) },
      })
    }
    return out
  }, [q, notes, assets, onNavigate, onOpenAsset])

  useEffect(() => { setSel(0) }, [items.length])

  const hint = paletteHint(q, loading, items.length)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => moveSel(s, 1, items.length)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => moveSel(s, -1, items.length)) }
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
            placeholder={t('搜索便签、资产，或执行命令…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="palette-list" ref={listRef}>
          {loading ? <div className="palette-group">{t('搜索中…')}</div> : null}
          {hint.empty ? <div className="palette-group">{hint.empty}</div> : null}
          {hint.group ? <div className="palette-group">{hint.group}</div> : null}
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
