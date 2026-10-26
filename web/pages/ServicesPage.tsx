import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Boxes, ExternalLink, LayoutGrid, List, Pencil, Plus, Search, Server, Trash2 } from 'lucide-react'
import { Button, Empty, Spinner } from '../components/ui'
import { cx } from '../lib/cx'
import { api, type DeployRec, type ServerRec, type ServiceRec, type ServicesPayload } from '../lib/api'
import {
  KIND_LABEL,
  deployTarget,
  deployTitle,
  filterServerGroups,
  filterServiceGroups,
  groupByServer,
  groupByService,
  monitorLabel,
  summaryOf,
  type DeployTarget,
  type ServerGroup,
  type ServerRow,
  type ServiceGroup,
  type ServiceRow,
} from './services/model'
import { DeleteDialog, DeployDrawer, ServerDrawer, ServiceDrawer } from './services/drawers'

type View = 'server' | 'service'

/** 增删改的入口：这一页就是 data/services.json 的编辑器，所有按钮都从这里走 */
export type OpsCtx = {
  addDeploy: (preset: { server?: string; service?: string }) => void
  editDeploy: (rec: DeployRec) => void
  delDeploy: (rec: DeployRec) => void
  editServer: (rec: ServerRec) => void
  delServer: (rec: ServerRec) => void
  editService: (rec: ServiceRec) => void
  delService: (rec: ServiceRec) => void
}

/** 删除确认框当前要删的那一条 */
type DelTarget =
  | { kind: 'server'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'deploy'; server: string; service: string }

/** 观测项显示名：页面从 data/services.json 的 monitors 表建一个查表函数，子组件用 context 取。 */
const MonNames = createContext<(id: number) => string>((id) => '观测项 ' + id)

/** 紧凑（默认，一屏看全）/ 详细（带路径与启动方式）。选过就记住，下次进来还是那个。 */
const DENSITY_KEY = 'pinboard-svc-density'

function readDense(): boolean {
  try {
    return localStorage.getItem(DENSITY_KEY) !== 'detail'
  } catch {
    return true
  }
}

function saveDense(dense: boolean) {
  try {
    localStorage.setItem(DENSITY_KEY, dense ? 'compact' : 'detail')
  } catch {
    /* 隐私模式写不进去，忽略 */
  }
}

/** 管理页新开一个标签页打开（noopener 避免被打开的页面拿到 window.opener） */
function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 一行里的观测入口：挂了观测项才是按钮，没挂就一个「—」（这一格还有管理页时不给「—」）。 */
function MonChips({ ids, onOpen, quiet }: { ids?: number[]; onOpen?: (id: number) => void; quiet?: boolean }) {
  const mon = useContext(MonNames)
  if (!ids || ids.length === 0) return quiet ? null : <span className="svc-nomon">—</span>
  return (
    <>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="svc-mon"
          title={'去观测台看「' + mon(id) + '」'}
          onClick={() => onOpen?.(id)}
        >
          <span>{mon(id)}</span>
        </button>
      ))}
    </>
  )
}

/** 管理页入口：和观测标签同一格。没挂观测时它就是这一格唯一的内容。 */
function ManageLink({ url }: { url: string }) {
  return (
    <a className="svc-manage" href={url} target="_blank" rel="noreferrer noopener" title={'打开管理页：' + url}>
      管理页
      <ExternalLink size={10} />
    </a>
  )
}

/** 详细视图里的名字格：能跳就是按钮，不能跳就是灰字（点了没反应）。 */
function NameCell({ name, summary, target, onOpen }: {
  name: string
  summary: string
  target: DeployTarget | null
  onOpen?: (id: number) => void
}) {
  const mon = useContext(MonNames)
  if (!target) {
    return <span className="svc-name is-static" title={summary + '（没挂观测也没有管理页，点了不跳）'}>{name}</span>
  }
  const tip = target.kind === 'monitor'
    ? summary + '（点一下去观测台看「' + mon(target.id) + '」）'
    : summary + '（点一下打开管理页 ' + target.url + '）'
  return (
    <button
      type="button"
      className="svc-name"
      title={tip}
      onClick={() => (target.kind === 'monitor' ? onOpen?.(target.id) : openUrl(target.url))}
    >
      {name}
    </button>
  )
}

function RunCell({ row }: { row: ServerRow | ServiceRow }) {
  const text = row.runtime + (row.port ? ' · ' + row.port : '')
  return (
    <span className="svc-run" title={text}>
      {row.runtime}
      {row.port ? <em> · {row.port}</em> : null}
    </span>
  )
}

/** 详细视图的一行（服务器视角）：种类 / 服务名 / 路径 / 启动 · 端口 / 观测 + 换视角 */
function ServerDeployRow({ row, ops, onOpen, onService }: {
  row: ServerRow
  ops: OpsCtx
  onOpen?: (id: number) => void
  onService: (cardId: string) => void
}) {
  return (
    <li className="svc-row">
      <span className={cx('svc-kind', 'kind-' + row.svc.kind)}>{KIND_LABEL[row.svc.kind]}</span>
      <NameCell name={row.svc.name} summary={row.svc.summary} target={deployTarget(row)} onOpen={onOpen} />
      <span className="svc-path" title={row.path}>{row.path}</span>
      <RunCell row={row} />
      <span className="svc-mons">
        <MonChips ids={row.monitor} onOpen={onOpen} quiet={!!row.url} />
        {row.url ? <ManageLink url={row.url} /> : null}
      </span>
      <span className="svc-row-ops">
        <button type="button" className="svc-op" title="改这条部署" onClick={() => ops.editDeploy(row)}>
          <Pencil size={11} />
        </button>
        <button type="button" className="svc-op" title="删这条部署" onClick={() => ops.delDeploy(row)}>
          <Trash2 size={11} />
        </button>
        <button
          type="button"
          className="svc-swap"
          title={'换到服务视角：看「' + row.svc.name + '」都部署在哪几台'}
          onClick={() => onService('svc-card-svc-' + row.service)}
        >
          <ArrowLeftRight size={12} />
        </button>
      </span>
    </li>
  )
}

/** 详细视图的一行（服务视角）：服务器名 / 路径 / 启动 · 端口 / 观测 */
function ServiceDeployRow({ row, ops, onOpen, onServer }: {
  row: ServiceRow
  ops: OpsCtx
  onOpen?: (id: number) => void
  onServer: (cardId: string) => void
}) {
  return (
    <li className="svc-row is-srv">
      <NameCell
        name={row.srv.name}
        summary={row.srv.vendor + ' · ' + row.srv.ip + ' · ' + row.srv.user}
        target={deployTarget(row)}
        onOpen={onOpen}
      />
      <span className="svc-path" title={row.path}>{row.path}</span>
      <RunCell row={row} />
      <span className="svc-mons">
        <MonChips ids={row.monitor} onOpen={onOpen} quiet={!!row.url} />
        {row.url ? <ManageLink url={row.url} /> : null}
      </span>
      <span className="svc-row-ops">
        <button type="button" className="svc-op" title="改这条部署" onClick={() => ops.editDeploy(row)}>
          <Pencil size={11} />
        </button>
        <button type="button" className="svc-op" title="删这条部署" onClick={() => ops.delDeploy(row)}>
          <Trash2 size={11} />
        </button>
        <button
          type="button"
          className="svc-swap"
          title={'换到服务器视角：看「' + row.srv.name + '」上都部署了什么'}
          onClick={() => onServer('svc-card-srv-' + row.server)}
        >
          <ArrowLeftRight size={12} />
        </button>
      </span>
    </li>
  )
}

/** 紧凑视图的一行：种类点 + 名字 + 端口。
    整行就是入口——挂了观测去观测台，没观测但有管理页就打开管理页，都没有的点了不动。
    细节全在悬停提示里。 */
function MiniRow({
  dot,
  label,
  labelTitle,
  port,
  target,
  detail,
  ops,
  onOpen,
}: {
  dot?: string
  label: string
  labelTitle: string
  port?: string
  target: DeployTarget | null
  detail: string
  /** 行尾的改 / 删按钮（悬停才显形） */
  ops?: ReactNode
  onOpen?: (id: number) => void
}) {
  const mon = useContext(MonNames)
  const linked = target !== null
  const tip = !target
    ? detail + '\n没挂观测也没有管理页，点了不跳'
    : target.kind === 'monitor'
      ? detail + '\n点一下 → 观测台看「' + mon(target.id) + '」'
      : detail + '\n点一下 → 打开管理页 ' + target.url
  const go = () => {
    if (!target) return
    if (target.kind === 'monitor') onOpen?.(target.id)
    else openUrl(target.url)
  }
  return (
    <li
      className={cx('svc-mini-row', linked && 'is-link')}
      title={tip}
      role={linked ? 'button' : undefined}
      tabIndex={linked ? 0 : undefined}
      onClick={linked ? go : undefined}
      onKeyDown={linked ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      } : undefined}
    >
      {dot ? <span className={cx('svc-dot', dot)} /> : null}
      <span className={cx('svc-mini-name', linked ? 'is-link' : 'is-static')} title={labelTitle}>{label}</span>
      {port ? <span className="svc-mini-port">{port}</span> : null}
      {ops ? <span className="svc-mini-ops">{ops}</span> : null}
    </li>
  )
}

function MiniServerCard({ g, flash, ops, onOpen }: {
  g: ServerGroup
  flash: string
  ops: OpsCtx
  onOpen?: (id: number) => void
}) {
  const cardId = 'svc-card-srv-' + g.server.id
  const mon = useContext(MonNames)
  return (
    <article id={cardId} className={cx('svc-mini', flash === cardId && 'is-flash')}>
      <header className="svc-mini-head">
        <h3 className="svc-mini-title">{g.server.name}</h3>
        <span className="svc-mini-ip">{g.server.ip}</span>
        <span className="svc-mini-count">{g.rows.length}</span>
        <span className="svc-mini-ops">
          <button
            type="button"
            className="svc-op"
            title={'在「' + g.server.name + '」上加一条部署'}
            onClick={() => ops.addDeploy({ server: g.server.id })}
          >
            <Plus size={12} />
          </button>
          <button type="button" className="svc-op" title="改这台服务器" onClick={() => ops.editServer(g.server)}>
            <Pencil size={11} />
          </button>
          <button type="button" className="svc-op" title="删这台服务器" onClick={() => ops.delServer(g.server)}>
            <Trash2 size={11} />
          </button>
        </span>
      </header>
      {g.rows.length === 0 ? <p className="svc-mini-empty">还没登记部署</p> : null}
      <ul className="svc-mini-rows">
        {g.rows.map((row) => (
          <MiniRow
            key={row.server + ':' + row.service}
            dot={'kind-' + row.svc.kind}
            label={row.svc.name}
            labelTitle={KIND_LABEL[row.svc.kind] + ' · ' + row.svc.summary}
            port={row.port}
            target={deployTarget(row)}
            detail={deployTitle(row, (row.monitor ?? []).map(mon))}
            onOpen={onOpen}
            ops={
              <>
                <button
                  type="button"
                  className="svc-op"
                  title="改这条部署"
                  onClick={(e) => {
                    e.stopPropagation()
                    ops.editDeploy(row)
                  }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="svc-op"
                  title="删这条部署"
                  onClick={(e) => {
                    e.stopPropagation()
                    ops.delDeploy(row)
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </>
            }
          />
        ))}
      </ul>
      {g.monitors.length ? (
        <footer className="svc-mini-foot">
          {g.monitors.map((id) => (
            <button
              key={id}
              type="button"
              className="svc-mini-mon is-foot"
              title={'服务器观测：去观测台看「' + mon(id) + '」'}
              onClick={() => onOpen?.(id)}
            >
              <span>{mon(id)}</span>
            </button>
          ))}
        </footer>
      ) : null}
    </article>
  )
}

/** 服务视角的一行：一个服务一行，右边直接排出它部署在哪几台机上（带端口）。
    服务名 → 观测；机名小标签 → 换到服务器视角闪那台机。23 个服务一屏排得下，字还能放大。 */
function ServiceListRow({ g, flash, ops, onOpen, onJump }: {
  g: ServiceGroup
  flash: string
  ops: OpsCtx
  onOpen?: (id: number) => void
  onJump: (view: View, cardId: string) => void
}) {
  const cardId = 'svc-card-svc-' + g.service.id
  const mon = useContext(MonNames)
  // 服务视角的名字只有一个入口：优先取第一条挂了观测/有管理页的部署
  const target = g.rows.map(deployTarget).find((t) => t !== null) ?? null
  const tip = !target
    ? g.service.summary + (g.rows.length ? '（没挂观测也没有管理页，点了不跳）' : '（还没部署到任何服务器）')
    : target.kind === 'monitor'
      ? g.service.summary + '（点一下去观测台看「' + mon(target.id) + '」）'
      : g.service.summary + '（点一下打开管理页 ' + target.url + '）'
  return (
    <li id={cardId} className={cx('svc-srow', flash === cardId && 'is-flash')}>
      <span className={cx('svc-dot', 'kind-' + g.service.kind)} />
      {target ? (
        <button
          type="button"
          className="svc-srow-name"
          title={tip}
          onClick={() => (target.kind === 'monitor' ? onOpen?.(target.id) : openUrl(target.url))}
        >
          {g.service.name}
        </button>
      ) : (
        <span className="svc-srow-name is-static" title={tip}>
          {g.service.name}
        </span>
      )}
      <span className="svc-srow-count">{g.rows.length ? g.rows.length + ' 台' : '还没部署'}</span>
      <span className="svc-srow-srvs">
        {g.rows.length === 0 ? <span className="svc-srow-none">点右边 + 挑一台服务器</span> : null}
        {g.rows.map((row, i) => (
          <Fragment key={row.server}>
            {i > 0 ? <span className="svc-srow-sep">·</span> : null}
            <button
              type="button"
              className="svc-schip"
              title={row.srv.vendor + ' · ' + row.srv.ip + ' · ' + row.srv.user + '（点一下换到服务器视角看这台机）'}
              onClick={() => onJump('server', 'svc-card-srv-' + row.server)}
            >
              {row.srv.name}
              {row.port ? <em>{row.port}</em> : null}
            </button>
          </Fragment>
        ))}
      </span>
      <span className="svc-row-ops">
        <button type="button" className="svc-op" title={'给「' + g.service.name + '」再加一条部署'} onClick={() => ops.addDeploy({ service: g.service.id })}>
          <Plus size={12} />
        </button>
        <button type="button" className="svc-op" title="改这个服务" onClick={() => ops.editService(g.service)}>
          <Pencil size={11} />
        </button>
        <button type="button" className="svc-op" title="删这个服务" onClick={() => ops.delService(g.service)}>
          <Trash2 size={11} />
        </button>
      </span>
    </li>
  )
}

export function ServicesPage({ onOpenMonitor }: {
  /** 点观测标签 → 观测台定位那一项（App 传 s.openMonitor 进来） */
  onOpenMonitor?: (id: number) => void
}) {
  const [view, setView] = useState<View>('server')
  const [dense, setDense] = useState<boolean>(readDense)
  const [q, setQ] = useState('')
  const [flash, setFlash] = useState('')
  const [data, setData] = useState<ServicesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)
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
  // 观测项名字只来自这份文件的 monitors 表；这一页不连 Kuma
  const mon = useCallback((id: number) => monitorLabel(data?.monitors, id), [data])

  const sum = useMemo(() => summaryOf(srvRecs, svcRecs, deploys), [srvRecs, svcRecs, deploys])
  const byServer = useMemo(() => groupByServer(srvRecs, svcRecs, deploys), [srvRecs, svcRecs, deploys])
  const byService = useMemo(() => groupByService(svcRecs, srvRecs, deploys), [svcRecs, srvRecs, deploys])
  const servers = useMemo(() => filterServerGroups(byServer, q), [byServer, q])
  const services = useMemo(() => filterServiceGroups(byService, q), [byService, q])

  // 换视角：清搜索、滚到那张卡、闪一下（跟主机页跳观测台的手感一致）
  const jump = (next: View, cardId: string) => {
    setView(next)
    setQ('')
    setFlash(cardId)
    requestAnimationFrame(() => {
      document.getElementById(cardId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFlash(''), 1700)
  }

  const setDensity = (next: boolean) => {
    setDense(next)
    saveDense(next)
  }

  // 所有编辑入口：每个抽屉 / 确认框都只改自己的 state，保存时服务端回整份 payload 直接覆盖
  const ops = useMemo<OpsCtx>(
    () => ({
      addDeploy: (preset) => setDepEdit({ open: true, rec: null, preset }),
      editDeploy: (rec) => setDepEdit({ open: true, rec, preset: null }),
      delDeploy: (rec) => setDel({ kind: 'deploy', server: rec.server, service: rec.service }),
      editServer: (rec) => setSrvEdit({ open: true, rec }),
      delServer: (rec) => setDel({ kind: 'server', id: rec.id }),
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
        title: '删除服务器：' + s.name,
        need: s.id,
        warning: '「' + s.name + '」会从 data/services.json 里删掉（写回前自动备份一份到 data/services-backups/）。',
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
        title: '删除服务：' + v.name,
        need: v.id,
        warning: '「' + v.name + '」会从 data/services.json 里删掉（写回前自动备份一份到 data/services-backups/）。',
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
      title: '删除部署：' + vName,
      need: del.server + ':' + del.service,
      warning:
        '把「' + vName + '」从「' + sName + '」上移除' + (d ? '（' + d.path + '）' : '') +
        '。只删这条登记，不动服务器上的文件。',
      blockers: undefined,
      run: () => api.services.removeDeploy(del.server + ':' + del.service).then(setData),
    }
  }, [del, srvRecs, svcRecs, deploys])

  const total = view === 'server' ? servers.length : services.length

  return (
    <MonNames.Provider value={mon}>
      <div className="page page-wide page-svc">
        <div className="svc-toolbar">
          <div className="svc-sum">
            <span className="svc-sum-num">{sum.servers}</span>
            <span className="svc-sum-label">台服务器</span>
            <span className="svc-sum-sep">·</span>
            <span className="svc-sum-num">{sum.services}</span>
            <span className="svc-sum-label">个服务</span>
            <span className="svc-sum-sep">·</span>
            <span className="svc-sum-dim">{sum.deploys} 条部署</span>
            <span className="svc-sum-sep">·</span>
            <span className="svc-sum-dim">{sum.linked} 条挂了观测（共 {sum.monitors} 项）</span>
            <span className="svc-sum-sep">·</span>
            <span className="svc-sum-dim">{sum.manage} 条能打开管理页</span>
          </div>
          <div className="svc-actions">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                view === 'server'
                  ? setSrvEdit({ open: true, rec: null })
                  : setSvcEdit({ open: true, rec: null })
              }
            >
              <Plus size={13} />
              {view === 'server' ? '加服务器' : '加服务'}
            </Button>
            <div className="svc-tabs">
              <button
                type="button"
                className={cx('svc-tab', view === 'server' && 'is-on')}
                onClick={() => setView('server')}
              >
                <Server size={13} />服务器视角
              </button>
              <button
                type="button"
                className={cx('svc-tab', view === 'service' && 'is-on')}
                onClick={() => setView('service')}
              >
                <Boxes size={13} />服务视角
              </button>
            </div>
            <div className="svc-tabs is-density">
              <button
                type="button"
                className={cx('svc-tab', dense && 'is-on')}
                title="紧凑：一屏看全所有部署"
                onClick={() => setDensity(true)}
              >
                <LayoutGrid size={13} />紧凑
              </button>
              <button
                type="button"
                className={cx('svc-tab', !dense && 'is-on')}
                title="详细：带路径与启动方式"
                onClick={() => setDensity(false)}
              >
                <List size={13} />详细
              </button>
            </div>
            <label className="svc-search">
              <Search size={13} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={view === 'server' ? '搜服务器 / 服务 / 路径' : '搜服务 / 服务器'}
              />
            </label>
          </div>
        </div>

        <p className="svc-hint">
          {dense ? (
            view === 'server' ? (
              <>
                只登记部署关系，<b>不做任何探测</b>。点任意一行：挂了观测的去观测台，没观测但有管理页的打开管理页，
                都没有的点不动；服务器级观测在卡片底部；路径 / 启动方式 / 端口看悬停提示。
              </>
            ) : (
              <>
                只登记部署关系，<b>不做任何探测</b>。点服务名：有观测去观测台，没观测就打开它的管理页（都没有的点不动）；
                点右边的机名小标签换到服务器视角，看那台机上还部署了什么。
              </>
            )
          ) : (
            <>
              这一栏只登记部署关系，<b>不做任何探测</b>。点名字：有观测去观测台，没观测就打开管理页（都没有的点了不跳）；
              行尾的 <ArrowLeftRight size={11} className="svc-hint-ico" /> 换到另一个视角。
            </>
          )}
        </p>

        {loading && !data ? (
          <p className="svc-loading">
            <Spinner /> 正在读服务清单…
          </p>
        ) : error ? (
          <Empty
            icon={<Boxes size={20} />}
            title="读不到服务清单"
            text={error}
            action={<Button onClick={() => void load()}>重试</Button>}
          />
        ) : !srvRecs.length ? (
          <Empty
            icon={<Boxes size={20} />}
            title="还没有登记任何部署"
            text={'在 ' + (data?.file || 'data/services.json') + ' 里按 services.example.json 的格式写：servers（哪几台机）、services（哪些服务）、deploys（谁部署在谁上面）。改完刷新页面即生效。'}
            action={<Button onClick={() => void load()}>重新读取</Button>}
          />
        ) : total === 0 ? (
          <Empty
            icon={<Search size={20} />}
            title="没有匹配的部署"
            text={'没找到「' + q + '」，换个关键词试试。'}
            action={<Button onClick={() => setQ('')}>清空搜索</Button>}
          />
        ) : dense && view === 'server' ? (
          <div className="svc-board">
            {servers.map((g) => (
              <MiniServerCard key={g.server.id} g={g} flash={flash} ops={ops} onOpen={onOpenMonitor} />
            ))}
          </div>
        ) : dense ? (
          <ul className="svc-slist">
            {services.map((g) => (
              <ServiceListRow key={g.service.id} g={g} flash={flash} ops={ops} onOpen={onOpenMonitor} onJump={jump} />
            ))}
          </ul>
        ) : (
          <div className="svc-list">
            {view === 'server'
              ? servers.map((g) => {
                  const cardId = 'svc-card-srv-' + g.server.id
                  return (
                    <article key={g.server.id} id={cardId} className={cx('svc-card', flash === cardId && 'is-flash')}>
                      <header className="svc-head">
                        <h3 className="svc-title is-static">{g.server.name}</h3>
                        <span className="svc-meta">{g.server.vendor} · {g.server.ip} · {g.server.user}</span>
                        <span className="svc-count">{g.rows.length} 项部署</span>
                        <span className="svc-row-ops">
                          <button
                            type="button"
                            className="svc-op"
                            title={'在「' + g.server.name + '」上加一条部署'}
                            onClick={() => ops.addDeploy({ server: g.server.id })}
                          >
                            <Plus size={12} />
                          </button>
                          <button type="button" className="svc-op" title="改这台服务器" onClick={() => ops.editServer(g.server)}>
                            <Pencil size={11} />
                          </button>
                          <button type="button" className="svc-op" title="删这台服务器" onClick={() => ops.delServer(g.server)}>
                            <Trash2 size={11} />
                          </button>
                        </span>
                      </header>
                      {g.server.note ? <p className="svc-sub">{g.server.note}</p> : null}
                      {g.rows.length === 0 ? (
                        <p className="svc-sub">这台机还没登记部署。</p>
                      ) : (
                        <>
                          <div className="svc-rows-head">
                            <span>种类</span>
                            <span>服务</span>
                            <span>路径</span>
                            <span>启动 · 端口</span>
                            <span>观测</span>
                            <span />
                          </div>
                          <ul className="svc-rows">
                          {g.rows.map((row) => (
                            <ServerDeployRow
                              key={row.server + ':' + row.service}
                              row={row}
                              ops={ops}
                              onOpen={onOpenMonitor}
                              onService={(id) => jump('service', id)}
                            />
                          ))}
                          </ul>
                        </>
                      )}
                      <footer className="svc-foot">
                        <span className="svc-foot-label">服务器观测</span>
                        <MonChips ids={g.monitors} onOpen={onOpenMonitor} />
                        {g.server.doc ? <span className="svc-doc" title={g.server.doc}>{g.server.doc}</span> : null}
                      </footer>
                    </article>
                  )
                })
              : services.map((g) => {
                  const cardId = 'svc-card-svc-' + g.service.id
                  return (
                    <article key={g.service.id} id={cardId} className={cx('svc-card', 'is-svc', flash === cardId && 'is-flash')}>
                      <header className="svc-head">
                        <h3 className="svc-title is-static">{g.service.name}</h3>
                        <span className={cx('svc-kind', 'is-chip', 'kind-' + g.service.kind)}>
                          {KIND_LABEL[g.service.kind]}
                        </span>
                        <span className="svc-count">{g.rows.length} 台服务器</span>
                        <span className="svc-row-ops">
                          <button
                            type="button"
                            className="svc-op"
                            title={'给「' + g.service.name + '」再加一条部署'}
                            onClick={() => ops.addDeploy({ service: g.service.id })}
                          >
                            <Plus size={12} />
                          </button>
                          <button type="button" className="svc-op" title="改这个服务" onClick={() => ops.editService(g.service)}>
                            <Pencil size={11} />
                          </button>
                          <button type="button" className="svc-op" title="删这个服务" onClick={() => ops.delService(g.service)}>
                            <Trash2 size={11} />
                          </button>
                        </span>
                      </header>
                      <p className="svc-sub">{g.service.summary}</p>
                      <div className="svc-rows-head is-srv">
                        <span>服务器</span>
                        <span>路径</span>
                        <span>启动 · 端口</span>
                        <span>观测</span>
                        <span />
                      </div>
                      <ul className="svc-rows">
                        {g.rows.map((row) => (
                          <ServiceDeployRow
                            key={row.server + ':' + row.service}
                            row={row}
                            ops={ops}
                            onOpen={onOpenMonitor}
                            onServer={(id) => jump('server', id)}
                          />
                        ))}
                      </ul>
                      {g.service.doc ? (
                        <footer className="svc-foot">
                          <span className="svc-foot-label">项目目录</span>
                          <span className="svc-doc" title={g.service.doc}>{g.service.doc}</span>
                        </footer>
                      ) : null}
                    </article>
                  )
                })}
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
