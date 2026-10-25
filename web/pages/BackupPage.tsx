import { useCallback, useEffect, useState } from 'react'
import { Archive, CloudUpload, Database, Download, RefreshCw, Trash2 } from 'lucide-react'
import { api, type BackupStatus, type Manifest, type RemoteRow } from '../lib/api'
import { API_BASE } from '../lib/api/http'

// 备份页（spec 05）：本机 tar.gz + 远程数据库两个目的地，各自显示份数 / 上次时间 / 结果。
// 包里除库快照外还带当天观测心跳（审计用），所以这里是「数据 + 观测历史」一起备份。

function fmt(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function size(n: number): string {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return Math.round(n / 1024) + ' KB'
}

export function BackupPage() {
  const [st, setSt] = useState<BackupStatus | null>(null)
  const [rows, setRows] = useState<RemoteRow[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [manifest, setManifest] = useState<Manifest | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await api.backup.status()
      setSt(s)
      if (s.remote.enabled) {
        const r = await api.backup.remoteRows()
        setRows(r.rows)
        if (r.error) setMsg(r.error)
      } else {
        setRows([])
      }
    } catch (e: any) {
      setMsg(e.message)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function run(only: 'local' | 'remote') {
    setBusy(only); setMsg('')
    try {
      const r = await api.backup.run(only)
      const st = r.report[only]
      setMsg(st ? (st.ok ? '已完成：' + (st.detail || '') : '失败：' + (st.error || '')) : '没有可用的目的地')
      await load()
    } catch (e: any) {
      setMsg(e.message)
    } finally { setBusy('') }
  }

  async function removeLocal(name: string) {
    if (!confirm('删掉这份备份？不可恢复。')) return
    setBusy(name); setMsg('')
    try { await api.backup.removeLocal(name); await load() } catch (e: any) { setMsg(e.message) } finally { setBusy('') }
  }

  async function showManifest(name: string) {
    try { setManifest(await api.backup.manifest(name)) } catch (e: any) { setMsg(e.message) }
  }

  const local = st?.local
  const remote = st?.remote

  return (
    <div className="page">
      <div className="card sec-card">
        <div className="section-title" style={{ marginTop: 0 }}><Archive size={14} /> 本机文件</div>
        <p className="sec-hint">
          每天 03:00 自动打一个包，落在 <code>data/backups/</code>，保留最近 14 份。
          包里是库快照 + 当天观测心跳（CSV）+ 配置 + 密钥文件，恢复时整包解开即可。
        </p>

        <div className="bk-stat">
          <span><b>{local?.count ?? 0}</b> 份</span>
          <span>上次 {fmt(local?.state?.at)}</span>
          <span className={local?.state?.ok === false ? 'bk-bad' : local?.state?.ok ? 'bk-ok' : ''}>
            {local?.state ? (local.state.ok ? '成功 · ' + (local.state.detail || '') : '失败 · ' + (local.state.error || '')) : '还没跑过'}
          </span>
        </div>

        <div className="bk-actions">
          <button className="btn btn-sm" onClick={() => run('local')} disabled={busy === 'local'}>
            <RefreshCw size={13} /> {busy === 'local' ? '备份中…' : '立即备份'}
          </button>
        </div>

        {local?.files?.length ? (
          <div className="table-wrap">
            <table className="data bk-table">
              <thead><tr><th>文件</th><th>大小</th><th>时间</th><th /></tr></thead>
              <tbody>
                {local.files.map((f) => (
                  <tr key={f.name}>
                    <td className="bk-name">{f.name}</td>
                    <td>{size(f.size)}</td>
                    <td className="bk-dim">{fmt(f.mtime)}</td>
                    <td className="bk-ops">
                      <a className="btn btn-sm" href={API_BASE + '/backup/local/' + encodeURIComponent(f.name) + '/download'}>
                        <Download size={12} /> 下载
                      </a>
                      <button className="btn btn-sm" onClick={() => showManifest(f.name)}>清单</button>
                      <button className="btn btn-sm" onClick={() => removeLocal(f.name)} disabled={busy === f.name}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="bk-empty">还没有备份文件</div>}

        {manifest ? (
          <div className="bk-manifest">
            <div className="bk-manifest-head">
              <span>包内容 · {fmt(manifest.createdAt)}</span>
              <button className="btn btn-sm" onClick={() => setManifest(null)}>收起</button>
            </div>
            {manifest.members.map((m) => (
              <div className="bk-member" key={m.name}>
                <span className="bk-name">{m.name}</span>
                <span className="bk-dim">{size(m.size)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <RemoteCard
        status={remote ?? null}
        rows={rows}
        msg={msg}
        busy={busy}
        onRun={() => run('remote')}
        onReload={load}
        setMsg={setMsg}
        setBusy={setBusy}
      />
    </div>
  )
}

function RemoteCard({ status, rows, msg, busy, onRun, onReload, setMsg, setBusy }: {
  status: BackupStatus['remote'] | null
  rows: RemoteRow[]
  msg: string
  busy: string
  onRun: () => void
  onReload: () => Promise<void>
  setMsg: (s: string) => void
  setBusy: (s: string) => void
}) {
  const cfg = status?.config ?? null
  const [type, setType] = useState<'mysql' | 'postgres'>(cfg?.type ?? 'mysql')
  const [host, setHost] = useState(cfg?.host ?? '127.0.0.1')
  const [port, setPort] = useState(String(cfg?.port ?? 3306))
  const [database, setDatabase] = useState(cfg?.database ?? '')
  const [user, setUser] = useState(cfg?.user ?? '')
  const [password, setPassword] = useState('')
  const [table, setTable] = useState(cfg?.table ?? 'pinfolio_backups')
  const [editing, setEditing] = useState(!cfg)

  useEffect(() => {
    if (!cfg) return
    setType(cfg.type); setHost(cfg.host); setPort(String(cfg.port))
    setDatabase(cfg.database); setUser(cfg.user); setTable(cfg.table)
    setEditing(false)
  }, [cfg?.type, cfg?.host, cfg?.port, cfg?.database, cfg?.user, cfg?.table])

  function payload() {
    return { type, host, port: Number(port) || (type === 'postgres' ? 5432 : 3306), database, user, password, table }
  }

  async function test() {
    setBusy('test'); setMsg('')
    try {
      const r = await api.backup.testRemote(payload())
      setMsg(r.ok ? '连接成功：' + (r.version || '') : '连接失败')
    } catch (e: any) { setMsg(e.message) } finally { setBusy('') }
  }

  async function save() {
    setBusy('save'); setMsg('')
    try {
      await api.backup.saveRemote(payload())
      setPassword('')
      setMsg('已保存')
      await onReload()
    } catch (e: any) { setMsg(e.message) } finally { setBusy('') }
  }

  async function clear() {
    if (!confirm('断开远程库？已上传的备份不会删。')) return
    setBusy('clear'); setMsg('')
    try { await api.backup.clearRemote(); await onReload() } catch (e: any) { setMsg(e.message) } finally { setBusy('') }
  }

  async function removeRow(id: string) {
    if (!confirm('删掉远端这份备份？')) return
    setBusy(id); setMsg('')
    try { await api.backup.removeRemote(id); await onReload() } catch (e: any) { setMsg(e.message) } finally { setBusy('') }
  }

  async function fetchRow(id: string) {
    setBusy(id); setMsg('')
    try {
      const r = await api.backup.fetchRemote(id)
      setMsg('已下载到本机：' + r.file + '（' + size(r.size) + '），在上面的列表里能看到')
      await onReload()
    } catch (e: any) { setMsg(e.message) } finally { setBusy('') }
  }

  return (
    <div className="card sec-card">
      <div className="section-title" style={{ marginTop: 0 }}><Database size={14} /> 远程数据库</div>
      <p className="sec-hint">
        把同一份备份再写一行到 MySQL / PostgreSQL，换机、换盘都不怕。密码加密后存在本机库里，页面上只显示「已设置」。
      </p>

      {cfg && !editing ? (
        <>
          <div className="bk-stat">
            <span><b>{rows.length}</b> 份</span>
            <span>{cfg.type === 'postgres' ? 'PostgreSQL' : 'MySQL'} · {cfg.host}:{cfg.port}/{cfg.database}</span>
            <span>表 {cfg.table} · 密码已设置</span>
          </div>
          <div className="bk-stat">
            <span>上次 {fmt(status?.state?.at)}</span>
            <span className={status?.state?.ok === false ? 'bk-bad' : status?.state?.ok ? 'bk-ok' : ''}>
              {status?.state ? (status.state.ok ? '成功 · ' + (status.state.detail || '') : '失败 · ' + (status.state.error || '')) : '还没跑过'}
            </span>
          </div>
          <div className="bk-actions">
            <button className="btn btn-sm" onClick={onRun} disabled={!!busy}><CloudUpload size={13} /> 立即上传</button>
            <button className="btn btn-sm" onClick={() => onReload()} disabled={!!busy}><RefreshCw size={13} /> 刷新</button>
            <button className="btn btn-sm" onClick={() => setEditing(true)} disabled={!!busy}>改配置</button>
            <button className="btn btn-sm" onClick={clear} disabled={!!busy}>断开</button>
          </div>

          {rows.length ? (
            <div className="table-wrap">
              <table className="data bk-table">
                <thead><tr><th>文件</th><th>大小</th><th>上传时间</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="bk-name">{r.filename}</td>
                      <td>{size(r.size)}</td>
                      <td className="bk-dim">{fmt(r.created_at)}</td>
                      <td className="bk-ops">
                        <button className="btn btn-sm" onClick={() => fetchRow(r.id)} disabled={busy === r.id}>
                          <Download size={12} /> 取回
                        </button>
                        <button className="btn btn-sm" onClick={() => removeRow(r.id)} disabled={busy === r.id}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="bk-empty">远端还没有备份</div>}
        </>
      ) : (
        <>
          <div className="bk-form">
            <label>
              <span>类型</span>
              <select className="select" value={type} onChange={(e) => setType(e.target.value as 'mysql' | 'postgres')}>
                <option value="mysql">MySQL</option>
                <option value="postgres">PostgreSQL</option>
              </select>
            </label>
            <label>
              <span>地址</span>
              <input className="input" value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} />
            </label>
            <label>
              <span>端口</span>
              <input className="input" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              <span>库名</span>
              <input className="input" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="pinfolio_backup" spellCheck={false} />
            </label>
            <label>
              <span>用户名</span>
              <input className="input" value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} />
            </label>
            <label>
              <span>密码</span>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={cfg ? '留空 = 沿用已存的密码' : ''} />
            </label>
            <label>
              <span>表名</span>
              <input className="input" value={table} onChange={(e) => setTable(e.target.value)} spellCheck={false} />
            </label>
          </div>
          <div className="bk-actions">
            <button className="btn btn-sm" onClick={test} disabled={!!busy}>测试连接</button>
            <button className="btn btn-sm" onClick={save} disabled={!!busy}>保存</button>
            {cfg ? <button className="btn btn-sm" onClick={() => setEditing(false)} disabled={!!busy}>取消</button> : null}
          </div>
        </>
      )}

      {msg ? <div className="bk-msg">{msg}</div> : null}
    </div>
  )
}
