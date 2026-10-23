import { useCallback, useEffect, useState } from 'react'
import { LogOut, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { api, type ApiToken, type SessionInfo } from '../../lib/api'

// 设备（会话）/ 改密码 / API token —— 02 鉴权里设置页的那张卡。
export function SecurityCard() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [tokenName, setTokenName] = useState('')
  const [fresh, setFresh] = useState('')

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.auth.sessions(), api.auth.tokens()])
      setSessions(s)
      setTokens(t)
    } catch (e: any) {
      setMsg(e.message)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(key: string, fn: () => Promise<any>, done: string) {
    setBusy(key)
    setMsg('')
    try {
      await fn()
      setMsg(done)
      await load()
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy('')
    }
  }

  async function changePw() {
    if (next.length < 8) { setMsg('新密码至少 8 位'); return }
    await act('pw', () => api.auth.changePassword(cur, next), '密码已更新，其他设备已下线')
    setCur(''); setNext('')
  }

  async function newToken() {
    const t = await api.auth.createToken(tokenName.trim() || 'token')
    setFresh(t.token)
    setTokenName('')
    setMsg('token 只显示这一次，请立刻复制')
    await load()
  }

  return (
    <div className="card sec-card">
      <div className="section-title" style={{ marginTop: 0 }}>
        <ShieldCheck size={14} /> 安全
      </div>
      {msg ? <div className="field-hint" style={{ marginBottom: 10 }}>{msg}</div> : null}

      <div className="sec-label">登录的设备</div>
      <div className="sec-list">
        {sessions.map((s) => (
          <div className="sec-row" key={s.id}>
            <Smartphone size={14} />
            <div className="sec-main">
              <div className="sec-title">{deviceLabel(s.ua)}</div>
              <div className="sec-sub">{s.ip} · 最近 {ago(s.lastSeenAt)}</div>
            </div>
            {s.current ? (
              <span className="sec-tag">当前</span>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled={busy === s.id}
                onClick={() => act(s.id, () => api.auth.revoke(s.id), '已踢下线')}>
                踢下线
              </button>
            )}
          </div>
        ))}
      </div>
      {sessions.length > 1 ? (
        <button className="btn btn-sm" style={{ marginTop: 8 }}
          onClick={() => act('others', () => api.auth.revokeOthers(), '其他设备已全部下线')}>
          <LogOut size={13} /> 其他设备全部下线
        </button>
      ) : null}

      <div className="divider" style={{ margin: '14px 0' }} />

      <div className="sec-label">修改密码</div>
      <div className="sec-form">
        <input className="input" type="password" placeholder="当前密码" autoComplete="current-password"
          value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="input" type="password" placeholder="新密码（至少 8 位）" autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)} />
        <button className="btn btn-primary" disabled={busy === 'pw'} onClick={changePw}>保存</button>
      </div>

      <div className="divider" style={{ margin: '14px 0' }} />

      <div className="sec-label">API token（脚本 / 集成用）</div>
      {tokens.length ? (
        <div className="sec-list">
          {tokens.map((t) => (
            <div className="sec-row" key={t.id}>
              <div className="sec-main">
                <div className="sec-title">{t.name}</div>
                <div className="sec-sub">建于 {t.createdAt.slice(0, 10)} · {t.lastUsedAt ? '用过 ' + ago(t.lastUsedAt) : '从未使用'}</div>
              </div>
              <button className="btn btn-ghost btn-sm" title="删除"
                onClick={() => act(t.id, () => api.auth.deleteToken(t.id), 'token 已删除')}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="sec-form">
        <input className="input" placeholder="用途，例如 seed 脚本" value={tokenName}
          onChange={(e) => setTokenName(e.target.value)} />
        <button className="btn" onClick={newToken}>生成 token</button>
      </div>
      {fresh ? <div className="sec-token">{fresh}</div> : null}
    </div>
  )
}

function deviceLabel(ua: string): string {
  if (!ua) return '未知设备'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : ''
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

function ago(iso: string): string {
  const d = Date.now() - Date.parse(iso)
  if (!isFinite(d) || d < 0) return '刚刚'
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}
