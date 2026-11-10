import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType } from 'react'
import { Boxes, Clock, Cog, Globe, Package, Pencil, Plus, Search, Terminal, Trash2 } from 'lucide-react'
import { Button, Empty, Spinner } from '../components/ui'
import { cx } from '../lib/cx'
import { t } from '../lib/i18n'
import { api, type DeployRec, type ServerRec, type ServiceRec, type ServicesPayload } from '../lib/api'
import {
  KIND_LABEL,
  filterServiceGroups,
  groupByServer,
  groupByService,
  monitorLabel,
  summaryOf,
  type ServiceGroup,
  type ServiceRow,
} from './services/model'
import { DeleteDialog, DeployDrawer, ServerDrawer, ServiceDrawer } from './services/drawers'

/**
 * 服务页：一张卡一个服务，卡里按「端口 + 启动方式」把部署合并成几行，
 * 头顶一排服务器标签当筛选器。只登记部署关系，不做任何探测（心跳条那套在观测页）。
 */

/** 增删改的入口：这一页就是 data/services.json 的编辑器，所有按钮都从这里走 */
type OpsCtx = {
  addDeploy: (preset: { server?: string; service?: string }) => void
  editDeploy: (rec: DeployRec) => void
  editServer: (rec: ServerRec) => void
  editService: (rec: ServiceRec) => void
  delService: (rec: ServiceRec) => void
}

/** 删除确认框当前要删的那一条 */
type DelTarget =
  | { kind: 'server'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'deploy'; server: string; service: string }

/** 每种服务一个图标：项目 / 系统服务 / 站点 / 脚本 / 计划任务 */
const KIND_ICON: Record<string, ComponentType<{ size?: number }>> = {
  project: Package,
  service: Cog,
  site: Globe,
  script: Terminal,
  task: Clock,
}

/** 观测项显示名：页面从 data/services.json 的 monitors 表建一个查表函数，子组件用 context 取。 */
const MonNames = createContext<(id: number) => string>((id) => t('观测项 {id}', { id }))

/** 一格里的一组部署：同一台机上「端口 + 启动方式」完全一样的那几条并成一行 */
type DepGroup = { key: string; port: string; runtime: string; rows: ServiceRow[] }

function depGroups(rows: ServiceRow[]): DepGroup[] {
  const out: DepGroup[] = []
  for (const row of rows) {
    const port = row.port ?? ''
    const hit = out.find((g) => g.port === port && g.runtime === row.runtime)
    if (hit) hit.rows.push(row)
    else out.push({ key: port + '|' + row.runtime, port, runtime: row.runtime, rows: [row] })
  }
  return out
}

/** 观测入口：挂了观测项才是按钮，点了去观测台定位那一项 */
function MonChips({ ids, onOpen }: { ids: number[]; onOpen?: (id: number) => void }) {
  const mon = useContext(MonNames)
  if (!ids.length) return null
  return (
    <>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="monitor-chip is-btn"
          title={t('去观测台看「{name}」', { name: mon(id) })}
          onClick={() => onOpen?.(id)}
        >
          {mon(id)}
        </button>
      ))}
    </>
  )
}

/** 一张卡 = 一个服务 */
function ServiceCard({ g, dim, ops, onOpen, onFilter }: {
  g: ServiceGroup
  /** 头顶选了某台服务器、而这个服务不在那台上：压暗但不下架 */
  dim: boolean
  ops: OpsCtx
  onOpen?: (id: number) => void
  onFilter: (serverId: string) => void
}) {
  const Icon = KIND_ICON[g.service.kind] ?? Package
  const groups = useMemo(() => depGroups(g.rows), [g.rows])
  const monIds = useMemo(
    () => [...new Set(g.rows.flatMap((r) => r.monitor ?? []))].sort((a, b) => a - b),
    [g.rows],
  )
  // 卡头的服务器标签：按出现顺序去重，最多两张，多的折成 +N
  const srvChips = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of g.rows) if (!seen.has(r.server)) seen.set(r.server, r.srv.name)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [g.rows])
  const openUrl = g.rows.map((r) => r.url).find((u) => !!u) ?? ''

  return (
    <article className={cx('asset-card', 'svc-card', 'is-compact', dim && 'is-dim')}>
      <div className="asset-card-head">
        <div className="asset-icon">
          <Icon size={15} />
        </div>
        <div className="grow">
          <button
            type="button"
            className="asset-name svc-card-name"
            title={t('改这个服务（改名 / 摘要 / 删除）')}
            onClick={() => ops.editService(g.service)}
          >
            {g.service.name}
          </button>
          <div className="asset-sub">
            {KIND_LABEL[g.service.kind]} · {g.rows.length ? t('{n} 处部署', { n: g.rows.length }) : t('还没部署')}
          </div>
        </div>
        <span className="svc-srv">
          {srvChips.slice(0, 2).map((s) => (
            <button
              key={s.id}
              type="button"
              className="monitor-chip is-btn"
              title={t('只看 {name} 上跑了什么', { name: s.name })}
              onClick={() => onFilter(s.id)}
            >
              {s.name}
            </button>
          ))}
          {srvChips.length > 2 ? <span className="monitor-chip">+{srvChips.length - 2}</span> : null}
        </span>
      </div>

      {g.service.summary ? (
        <div className="monitor-note" title={g.service.summary}>
          <span className="monitor-note-label">{t('说明')}</span>
          <span className="monitor-note-text svc-note-text">{g.service.summary}</span>
        </div>
      ) : null}

      <div className="asset-meta">
        {groups.length === 0 ? (
          <div className="asset-meta-row">
            <span className="svc-dep-empty">{t('还没登记部署，点右下角 + 加一条')}</span>
          </div>
        ) : (
          groups.slice(0, 3).map((dep) => {
            const val = [dep.port, dep.runtime].filter(Boolean).join(' · ')
            return (
              <div
                className="asset-meta-row"
                key={dep.key}
                title={dep.rows.map((r) => r.srv.name + ' · ' + r.path).join('\n')}
              >
                <span className="asset-meta-key svc-meta-srv">
                  {dep.rows.map((r) => (
                    <button
                      key={r.server}
                      type="button"
                      className="svc-dep-srv-btn"
                      title={t('{server} · {path}（点一下改这条部署）', { server: r.srv.name, path: r.path })}
                      onClick={() => ops.editDeploy(r)}
                    >
                      {r.srv.name}
                    </button>
                  ))}
                </span>
                {val ? <span className="asset-meta-val svc-meta-val" title={dep.runtime}>{val}</span> : null}
              </div>
            )
          })
        )}
      </div>

      <div className="asset-foot">
        {groups.length > 3 ? (
          <span className="monitor-chip">{t('还有 {n} 条部署', { n: groups.length - 3 })}</span>
        ) : null}
        <MonChips ids={monIds} onOpen={onOpen} />
        <span className="svc-ops">
          <button
            type="button"
            className="svc-op"
            title={t('给「{name}」再加一条部署', { name: g.service.name })}
            onClick={() => ops.addDeploy({ service: g.service.id })}
          >
            <Plus size={12} />
          </button>
          <button type="button" className="svc-op" title={t('改这个服务')} onClick={() => ops.editService(g.service)}>
            <Pencil size={11} />
          </button>
          <button type="button" className="svc-op" title={t('删这个服务')} onClick={() => ops.delService(g.service)}>
            <Trash2 size={11} />
          </button>
        </span>
        {openUrl ? (
          <a className="asset-link" href={openUrl} target="_blank" rel="noreferrer noopener" title={t('打开管理页：{url}', { url: openUrl })}>
            {t('打开')}
          </a>
        ) : null}
      </div>
    </article>
  )
}

export function ServicesPage({ onOpenMonitor }: {
  /** 点观测标签 → 观测台定位那一项（App 传 s.openMonitor 进来） */
  onOpenMonitor?: (id: number) => void
}) {
  const [q, setQ] = useState('')
  /** 头顶筛选的服务器 id；'all' = 全部 */
  const [srv, setSrv] = useState('all')
  const [data, setData] = useState<ServicesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 三个抽屉 + 一个删除确认框：这一页就是 data/services.json 的编辑器
  const [srvEdit, setSrvEdit] = useState<{ open: boolean; rec: ServerRec | null }>({ open: false, rec: null })
  const [svcEdit, setSvcEdit] = useState<{ open: boolean; rec: ServiceRec | null }>({ open: false, rec: null })
  const [depEdit, setDepEdit] = useState<{
    open: boolean
    rec: DeployRec | null
    preset: { server?: string; service?: string } | null
  }>({ open: false, rec: null, preset: null })
  const [del, setDel] = useState<DelTarget | null>(null)

  // 数据只有一个来源：data/services.json（GET /api/services 每次热读）。进页面拉一次，改完刷新页面即生效。
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.services.get())
      setError('')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const srvRecs = useMemo(() => data?.servers ?? [], [data])
  const svcRecs = useMemo(() => data?.services ?? [], [data])
  const deploys = useMemo(() => data?.deploys ?? [], [data])
  // 观测项名字只来自这份文件的 monitors 表；这一页不探测任何东西
  const mon = useCallback((id: number) => monitorLabel(data?.monitors, id), [data])

  const sum = useMemo(() => summaryOf(srvRecs, svcRecs, deploys), [srvRecs, svcRecs, deploys])
  const byServer = useMemo(() => groupByServer(srvRecs, svcRecs, deploys), [srvRecs, svcRecs, deploys])
  const byService = useMemo(() => groupByService(svcRecs, srvRecs, deploys), [svcRecs, srvRecs, deploys])
  const services = useMemo(() => filterServiceGroups(byService, q), [byService, q])

  // 所有编辑入口：每个抽屉 / 确认框都只改自己的 state，保存时服务端回整份 payload 直接覆盖
  const ops = useMemo<OpsCtx>(
    () => ({
      addDeploy: (preset) => setDepEdit({ open: true, rec: null, preset }),
      editDeploy: (rec) => setDepEdit({ open: true, rec, preset: null }),
      editServer: (rec) => setSrvEdit({ open: true, rec }),
      editService: (rec) => setSvcEdit({ open: true, rec }),
      delService: (rec) => setDel({ kind: 'service', id: rec.id }),
    }),
    [],
  )

  // 删除确认框要显示什么、挡不挡（有部署挂在下面就不许删，先删部署）
  const delInfo = useMemo(() => {
    if (!del) return null
    if (del.kind === 'server') {
      const s = srvRecs.find((x) => x.id === del.id)
      if (!s) return null
      const on = deploys.filter((d) => d.server === del.id)
      return {
        title: t('删除服务器：{name}', { name: s.name }),
        need: s.id,
        warning: t('「{name}」会从 data/services.json 里删掉（写回前自动备份一份到 data/services-backups/）。', { name: s.name }),
        blockers: on.length
          ? on.map((d) => (svcRecs.find((x) => x.id === d.service)?.name ?? d.service) + ' · ' + d.path)
          : undefined,
        run: () => api.services.removeServer(s.id).then(setData),
      }
    }
    if (del.kind === 'service') {
      const v = svcRecs.find((x) => x.id === del.id)
      if (!v) return null
      const on = deploys.filter((d) => d.service === del.id)
      return {
        title: t('删除服务：{name}', { name: v.name }),
        need: v.id,
        warning: t('「{name}」会从 data/services.json 里删掉（写回前自动备份一份到 data/services-backups/）。', { name: v.name }),
        blockers: on.length
          ? on.map((d) => (srvRecs.find((x) => x.id === d.server)?.name ?? d.server) + ' · ' + d.path)
          : undefined,
        run: () => api.services.removeService(v.id).then(setData),
      }
    }
    const d = deploys.find((x) => x.server === del.server && x.service === del.service)
    const sName = srvRecs.find((x) => x.id === del.server)?.name ?? del.server
    const vName = svcRecs.find((x) => x.id === del.service)?.name ?? del.service
    return {
      title: t('删除部署：{name}', { name: vName }),
      need: del.server + ':' + del.service,
      warning: d
        ? t('把「{service}」从「{server}」上移除（{path}）。只删这条登记，不动服务器上的文件。', { service: vName, server: sName, path: d.path })
        : t('把「{service}」从「{server}」上移除。只删这条登记，不动服务器上的文件。', { service: vName, server: sName }),
      blockers: undefined,
      run: () => api.services.removeDeploy(del.server + ':' + del.service).then(setData),
    }
  }, [del, srvRecs, svcRecs, deploys])

  const matches = (g: ServiceGroup) => srv === 'all' || g.rows.some((r) => r.server === srv)
  const shown = services.length

  return (
    <MonNames.Provider value={mon}>
      <div className="page page-wide page-svc">
        <div className="filters" style={{ marginTop: 18 }}>
          <button
            type="button"
            className={cx('chip', srv === 'all' && 'active')}
            onClick={() => setSrv('all')}
          >
            {t('全部')}<span className="chip-count">{sum.services}</span>
          </button>
          {byServer.map((g) => (
            <button
              key={g.server.id}
              type="button"
              className={cx('chip', srv === g.server.id && 'active')}
              title={t('{vendor} · {ip} · {user}', { vendor: g.server.vendor, ip: g.server.ip, user: g.server.user })}
              onClick={() => setSrv(srv === g.server.id ? 'all' : g.server.id)}
            >
              {g.server.name}<span className="chip-count">{g.rows.length}</span>
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
          <span className="svc-filter-count">
            {t('{s} 个服务 · {d} 条部署 · {n} 台服务器', { s: sum.services, d: sum.deploys, n: sum.servers })}
          </span>
          <span className="grow" />
          <div style={{ position: 'relative', width: 180 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
            <input
              className="input input-sm"
              style={{ paddingLeft: 27 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('搜服务 / 端口 / 机器')}
            />
          </div>
          <Button size="sm" onClick={() => setSvcEdit({ open: true, rec: null })}>
            <Plus size={13} />
            {t('加服务')}
          </Button>
          <Button size="sm" onClick={() => setSrvEdit({ open: true, rec: null })}>
            <Plus size={13} />
            {t('加服务器')}
          </Button>
        </div>

        {loading && !data ? (
          <p className="svc-loading">
            <Spinner /> {t('正在读服务清单…')}
          </p>
        ) : error ? (
          <Empty
            icon={<Boxes size={20} />}
            title={t('读不到服务清单')}
            text={error}
            action={<Button onClick={() => void load()}>{t('重试')}</Button>}
          />
        ) : !svcRecs.length && !deploys.length ? (
          <Empty
            icon={<Boxes size={20} />}
            title={t('还没有登记任何部署')}
            text={t('在 {file} 里按 services.example.json 的格式写：servers（哪几台机）、services（哪些服务）、deploys（谁部署在谁上面）。改完刷新页面即生效。', { file: data?.file || 'data/services.json' })}
            action={<Button onClick={() => void load()}>{t('重新读取')}</Button>}
          />
        ) : shown === 0 ? (
          <Empty
            icon={<Search size={20} />}
            title={t('没有匹配的服务')}
            text={t('没找到「{q}」，换个关键词试试。', { q })}
            action={<Button onClick={() => setQ('')}>{t('清空搜索')}</Button>}
          />
        ) : (
          <div className="asset-grid svc-grid is-compact">
            {services.map((g) => (
              <ServiceCard
                key={g.service.id}
                g={g}
                dim={!matches(g)}
                ops={ops}
                onOpen={onOpenMonitor}
                onFilter={(id) => setSrv(srv === id ? 'all' : id)}
              />
            ))}
          </div>
        )}
      </div>

      <ServerDrawer
        open={srvEdit.open}
        editing={srvEdit.rec}
        monitors={data?.monitors}
        onClose={() => setSrvEdit({ open: false, rec: null })}
        onSaved={setData}
      />
      <ServiceDrawer
        open={svcEdit.open}
        editing={svcEdit.rec}
        onClose={() => setSvcEdit({ open: false, rec: null })}
        onSaved={setData}
      />
      <DeployDrawer
        open={depEdit.open}
        editing={depEdit.rec}
        preset={depEdit.preset}
        servers={srvRecs}
        services={svcRecs}
        monitors={data?.monitors}
        onClose={() => setDepEdit({ open: false, rec: null, preset: null })}
        onSaved={setData}
      />
      {delInfo ? (
        <DeleteDialog
          open
          title={delInfo.title}
          need={delInfo.need}
          warning={delInfo.warning}
          blockers={delInfo.blockers}
          onClose={() => setDel(null)}
          onConfirm={delInfo.run}
        />
      ) : null}
    </MonNames.Provider>
  )
}
