import { Fragment, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeftRight, Boxes, LayoutGrid, List, Search, Server } from 'lucide-react'
import { Button, Empty } from '../components/ui'
import { cx } from '../lib/cx'
import {
  KIND_LABEL,
  deployTitle,
  filterServerGroups,
  filterServiceGroups,
  groupByServer,
  groupByService,
  summaryOf,
  type ServerGroup,
  type ServerRow,
  type ServiceGroup,
  type ServiceRow,
} from './services/model'
import { DEPLOYS, SERVERS, SERVICES, monitorName } from './services/sample'

type View = 'server' | 'service'

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

/** 一行里的观测入口：挂了观测项才是按钮，没挂就一个「—」。 */
function MonChips({ ids, onOpen }: { ids?: number[]; onOpen?: (id: number) => void }) {
  if (!ids || ids.length === 0) return <span className="svc-nomon">—</span>
  return (
    <>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="svc-mon"
          title={'去观测台看「' + monitorName(id) + '」'}
          onClick={() => onOpen?.(id)}
        >
          <Activity size={11} />
          <span>{monitorName(id)}</span>
        </button>
      ))}
    </>
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
function ServerDeployRow({ row, onOpen, onService }: {
  row: ServerRow
  onOpen?: (id: number) => void
  onService: (cardId: string) => void
}) {
  const first = row.monitor?.[0]
  return (
    <li className="svc-row">
      <span className={cx('svc-kind', 'kind-' + row.svc.kind)}>{KIND_LABEL[row.svc.kind]}</span>
      {typeof first === 'number' ? (
        <button
          type="button"
          className="svc-name"
          title={row.svc.summary + '（点一下去观测台看「' + monitorName(first) + '」）'}
          onClick={() => onOpen?.(first)}
        >
          {row.svc.name}
        </button>
      ) : (
        <span className="svc-name is-static" title={row.svc.summary + '（没挂观测，点了不跳）'}>
          {row.svc.name}
        </span>
      )}
      <span className="svc-path" title={row.path}>{row.path}</span>
      <RunCell row={row} />
      <span className="svc-mons">
        <MonChips ids={row.monitor} onOpen={onOpen} />
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
function ServiceDeployRow({ row, onOpen, onServer }: {
  row: ServiceRow
  onOpen?: (id: number) => void
  onServer: (cardId: string) => void
}) {
  const first = row.monitor?.[0]
  return (
    <li className="svc-row is-srv">
      {typeof first === 'number' ? (
        <button
          type="button"
          className="svc-name"
          title={row.srv.vendor + ' · ' + row.srv.ip + ' · ' + row.srv.user + '（点一下去观测台看「' + monitorName(first) + '」）'}
          onClick={() => onOpen?.(first)}
        >
          {row.srv.name}
        </button>
      ) : (
        <span className="svc-name is-static" title={row.srv.vendor + ' · ' + row.srv.ip + ' · ' + row.srv.user + '（没挂观测，点了不跳）'}>
          {row.srv.name}
        </span>
      )}
      <span className="svc-path" title={row.path}>{row.path}</span>
      <RunCell row={row} />
      <span className="svc-mons">
        <MonChips ids={row.monitor} onOpen={onOpen} />
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

/** 紧凑视图的一行：种类点 + 名字 + 端口 + 观测标记。
    整行就是入口——挂了观测点哪儿都跳观测台，没挂的点了不动。细节全在悬停提示里。 */
function MiniRow({
  dot,
  label,
  labelTitle,
  port,
  monitors,
  detail,
  onOpen,
}: {
  dot?: string
  label: string
  labelTitle: string
  port?: string
  monitors?: number[]
  detail: string
  onOpen?: (id: number) => void
}) {
  const mons = monitors ?? []
  const first = mons[0]
  const linked = typeof first === 'number'
  const tip = linked
    ? detail + '\n点一下 → 观测台看「' + monitorName(first) + '」'
    : detail + '\n没挂观测，点了不跳'
  return (
    <li
      className={cx('svc-mini-row', linked && 'is-link')}
      title={tip}
      role={linked ? 'button' : undefined}
      tabIndex={linked ? 0 : undefined}
      onClick={linked ? () => onOpen?.(first) : undefined}
      onKeyDown={linked ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(first)
        }
      } : undefined}
    >
      {dot ? <span className={cx('svc-dot', dot)} /> : null}
      <span className="svc-mini-name" title={labelTitle}>{label}</span>
      {port ? <span className="svc-mini-port">{port}</span> : null}
      {linked ? (
        <span className="svc-mini-mon is-mark" title={'观测：' + mons.map(monitorName).join('、')}>
          <Activity size={12} />
        </span>
      ) : null}
    </li>
  )
}

function MiniServerCard({ g, flash, onOpen }: {
  g: ServerGroup
  flash: string
  onOpen?: (id: number) => void
}) {
  const cardId = 'svc-card-srv-' + g.server.id
  return (
    <article id={cardId} className={cx('svc-mini', flash === cardId && 'is-flash')}>
      <header className="svc-mini-head">
        <h3 className="svc-mini-title">{g.server.name}</h3>
        <span className="svc-mini-ip">{g.server.ip}</span>
        <span className="svc-mini-count">{g.rows.length}</span>
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
            monitors={row.monitor}
            detail={deployTitle(row, (row.monitor ?? []).map(monitorName))}
            onOpen={onOpen}
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
              title={'服务器观测：去观测台看「' + monitorName(id) + '」'}
              onClick={() => onOpen?.(id)}
            >
              <Activity size={10} />
              <span>{monitorName(id)}</span>
            </button>
          ))}
        </footer>
      ) : null}
    </article>
  )
}

/** 服务视角的一行：一个服务一行，右边直接排出它部署在哪几台机上（带端口）。
    服务名 → 观测；机名小标签 → 换到服务器视角闪那台机。23 个服务一屏排得下，字还能放大。 */
function ServiceListRow({ g, flash, onOpen, onJump }: {
  g: ServiceGroup
  flash: string
  onOpen?: (id: number) => void
  onJump: (view: View, cardId: string) => void
}) {
  const cardId = 'svc-card-svc-' + g.service.id
  const first = g.rows[0]?.monitor?.[0]
  const linked = typeof first === 'number'
  return (
    <li id={cardId} className={cx('svc-srow', flash === cardId && 'is-flash')}>
      <span className={cx('svc-dot', 'kind-' + g.service.kind)} />
      {linked ? (
        <button
          type="button"
          className="svc-srow-name"
          title={g.service.summary + '（点一下去观测台看「' + monitorName(first) + '」）'}
          onClick={() => onOpen?.(first)}
        >
          {g.service.name}
        </button>
      ) : (
        <span className="svc-srow-name is-static" title={g.service.summary + '（没挂观测，点了不跳）'}>
          {g.service.name}
        </span>
      )}
      <span className="svc-srow-count">{g.rows.length} 台</span>
      <span className="svc-srow-srvs">
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
      {linked ? (
        <span className="svc-mini-mon is-mark" title={'观测：' + g.rows.flatMap((r) => r.monitor ?? []).map(monitorName).join('、')}>
          <Activity size={12} />
        </span>
      ) : null}
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
  const timer = useRef<number | undefined>(undefined)

  const sum = useMemo(() => summaryOf(SERVERS, SERVICES, DEPLOYS), [])
  const byServer = useMemo(() => groupByServer(SERVERS, SERVICES, DEPLOYS), [])
  const byService = useMemo(() => groupByService(SERVICES, SERVERS, DEPLOYS), [])
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

  const total = view === 'server' ? servers.length : services.length

  return (
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
        </div>
        <div className="svc-actions">
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
              只登记部署关系，<b>不做任何探测</b>。点任意一行直接去观测台定位那一项（<b>没挂观测的行点不动</b>）；
              服务器级观测在卡片底部；路径 / 启动方式 / 端口看悬停提示。
            </>
          ) : (
            <>
              只登记部署关系，<b>不做任何探测</b>。点服务名直接去观测台定位那一项（没挂观测的点不动）；
              点右边的机名小标签换到服务器视角，看那台机上还部署了什么。
            </>
          )
        ) : (
          <>
            这一栏只登记部署关系，<b>不做任何探测</b>。点名字直接去观测台定位那一项（没挂观测的点了不跳）；
            行尾的 <ArrowLeftRight size={11} className="svc-hint-ico" /> 换到另一个视角。
          </>
        )}
      </p>

      {total === 0 ? (
        <Empty
          icon={<Search size={20} />}
          title="没有匹配的部署"
          text={'没找到「' + q + '」，换个关键词试试。'}
          action={<Button onClick={() => setQ('')}>清空搜索</Button>}
        />
      ) : dense && view === 'server' ? (
        <div className="svc-board">
          {servers.map((g) => (
            <MiniServerCard key={g.server.id} g={g} flash={flash} onOpen={onOpenMonitor} />
          ))}
        </div>
      ) : dense ? (
        <ul className="svc-slist">
          {services.map((g) => (
            <ServiceListRow key={g.service.id} g={g} flash={flash} onOpen={onOpenMonitor} onJump={jump} />
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
                    </header>
                    {g.server.note ? <p className="svc-sub">{g.server.note}</p> : null}
                    {g.rows.length === 0 ? (
                      <p className="svc-sub">这台机还没登记部署。</p>
                    ) : (
                      <ul className="svc-rows">
                        {g.rows.map((row) => (
                          <ServerDeployRow
                            key={row.server + ':' + row.service}
                            row={row}
                            onOpen={onOpenMonitor}
                            onService={(id) => jump('service', id)}
                          />
                        ))}
                      </ul>
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
                  <article key={g.service.id} id={cardId} className={cx('svc-card', flash === cardId && 'is-flash')}>
                    <header className="svc-head">
                      <h3 className="svc-title is-static">{g.service.name}</h3>
                      <span className={cx('svc-kind', 'is-chip', 'kind-' + g.service.kind)}>
                        {KIND_LABEL[g.service.kind]}
                      </span>
                      <span className="svc-count">{g.rows.length} 台服务器</span>
                    </header>
                    <p className="svc-sub">{g.service.summary}</p>
                    <ul className="svc-rows">
                      {g.rows.map((row) => (
                        <ServiceDeployRow
                          key={row.server + ':' + row.service}
                          row={row}
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
  )
}
