import { useMemo, useRef, useState } from 'react'
import { Activity, Boxes, Search, Server } from 'lucide-react'
import { Button, Empty } from '../components/ui'
import { cx } from '../lib/cx'
import {
  KIND_LABEL,
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

function ServerDeployRow({ row, onOpen, onService }: {
  row: ServerRow
  onOpen?: (id: number) => void
  onService: (name: string, cardId: string) => void
}) {
  return (
    <li className="svc-row">
      <span className={cx('svc-kind', 'kind-' + row.svc.kind)}>{KIND_LABEL[row.svc.kind]}</span>
      <button
        type="button"
        className="svc-name"
        title={row.svc.summary + '（点一下换到服务视角）'}
        onClick={() => onService(row.svc.name, 'svc-card-svc-' + row.service)}
      >
        {row.svc.name}
      </button>
      <span className="svc-path" title={row.path}>{row.path}</span>
      <RunCell row={row} />
      <span className="svc-mons"><MonChips ids={row.monitor} onOpen={onOpen} /></span>
    </li>
  )
}

function ServiceDeployRow({ row, onOpen, onServer }: {
  row: ServiceRow
  onOpen?: (id: number) => void
  onServer: (name: string, cardId: string) => void
}) {
  return (
    <li className="svc-row is-srv">
      <button
        type="button"
        className="svc-name"
        title={row.srv.vendor + ' · ' + row.srv.ip + ' · ' + row.srv.user + '（点一下换到服务器视角）'}
        onClick={() => onServer(row.srv.name, 'svc-card-srv-' + row.server)}
      >
        {row.srv.name}
      </button>
      <span className="svc-path" title={row.path}>{row.path}</span>
      <RunCell row={row} />
      <span className="svc-mons"><MonChips ids={row.monitor} onOpen={onOpen} /></span>
    </li>
  )
}

export function ServicesPage({ onOpenMonitor }: {
  /** 点观测标签 → 观测台定位那一项（App 传 s.openMonitor 进来） */
  onOpenMonitor?: (id: number) => void
}) {
  const [view, setView] = useState<View>('server')
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
        这一栏只登记部署关系，<b>不做任何探测</b>。点行里的服务名换到服务视角、点服务器名换回服务器视角；
        点<b>观测</b>标签直接去观测台定位那一项，没挂观测的行显示「—」。
      </p>

      {total === 0 ? (
        <Empty
          icon={<Search size={20} />}
          title="没有匹配的部署"
          text={'没找到「' + q + '」，换个关键词试试。'}
          action={<Button onClick={() => setQ('')}>清空搜索</Button>}
        />
      ) : (
        <div className="svc-list">
          {view === 'server'
            ? servers.map((g: ServerGroup) => {
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
                            onService={(name, id) => jump('service', id)}
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
            : services.map((g: ServiceGroup) => {
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
                          onServer={(name, id) => jump('server', id)}
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
