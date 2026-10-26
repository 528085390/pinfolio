import { useCallback, useEffect, useState } from 'react'
import { LogOut, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { api, type ApiToken, type SessionInfo } from '../../lib/api'
import { t } from '../../lib/i18n'

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
      const [s, tk] = await Promise.all([api.auth.sessions(), api.auth.tokens()])
      setSessions(s)
      setTokens(tk)
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
    if (next.length < 8) { setMsg(t('新密码至少 8 位')); return }
    await act('pw', () => api.auth.changePassword(cur, next), t('密码已更新，其他设备已下线'))
    setCur(''); setNext('')
  }

  async function newToken() {
    const tk = await api.auth.createToken(tokenName.trim() || 'token')
    setFresh(tk.token)
    setTokenName('')
    setMsg(t('token 只显示这一次，请立刻复制'))
    await load()
  }

  return (
    <div className="card sec-card">
      <div className="section-title" style={{ marginTop: 0 }}>
        <ShieldCheck size={14} /> {t('安全')}
      </div>
      {msg ? <div className="field-hint" style={{ marginBottom: 10 }}>{msg}</div> : null}

      <div className="sec-label">{t('登录的设备')}</div>
      <div className="sec-list">
        {sessions.map((s) => (
          <div className="sec-row" key={s.id}>
            <Smartphone size={14} />
            <div className="sec-main">
              <div className="sec-title">{deviceLabel(s.ua)}</div>
              <div className="sec-sub">{s.ip} · {t('最近 {time}', { time: ago(s.lastSeenAt) })}</div>
            </div>
            {s.current ? (
              <span className="sec-tag">{t('当前')}</span>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled={busy === s.id}
                onClick={() => act(s.id, () => api.auth.revoke(s.id), t('已踢下线'))}>
                {t('踢下线')}
              </button>
            )}
          </div>
        ))}
      </div>
      {sessions.length > 1 ? (
        <button className="btn btn-sm" style={{ marginTop: 8 }}
          onClick={() => act('others', () => api.auth.revokeOthers(), t('其他设备已全部下线'))}>
          <LogOut size={13} /> {t('其他设备全部下线')}
        </button>
      ) : null}

      <div className="divider" style={{ margin: '14px 0' }} />

      <div className="sec-label">{t('修改密码')}</div>
      <div className="sec-form">
        <input className="input" type="password" placeholder={t('当前密码')} autoComplete="current-password"
          value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="input" type="password" placeholder={t('新密码（至少 8 位）')} autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)} />
        <button className="btn btn-primary" disabled={busy === 'pw'} onClick={changePw}>{t('保存')}</button>
      </div>

      <div className="divider" style={{ margin: '14px 0' }} />

      <div className="sec-label">{t('API token（脚本 / 集成用）')}</div>
      {tokens.length ? (
        <div className="sec-list">
          {tokens.map((tk) => (
            <div className="sec-row" key={tk.id}>
              <div className="sec-main">
                <div className="sec-title">{tk.name}</div>
                <div className="sec-sub">{t('建于 {date}', { date: tk.createdAt.slice(0, 10) })} · {tk.lastUsedAt ? t('用过 {time}', { time: ago(tk.lastUsedAt) }) : t('从未使用')}</div>
              </div>
              <button className="btn btn-ghost btn-sm" title={t('删除')}
                onClick={() => act(tk.id, () => api.auth.deleteToken(tk.id), t('token 已删除'))}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="sec-form">
        <input className="input" placeholder={t('用途，例如 seed 脚本')} value={tokenName}
          onChange={(e) => setTokenName(e.target.value)} />
        <button className="btn" onClick={newToken}>{t('生成 token')}</button>
      </div>
      {fresh ? <div className="sec-token">{fresh}</div> : null}
    </div>
  )
}

function deviceLabel(ua: string): string {
  if (!ua) return t('未知设备')
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : ''
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

function ago(iso: string): string {
  const d = Date.now() - Date.parse(iso)
  if (!isFinite(d) || d < 0) return t('刚刚')
  const m = Math.floor(d / 60000)
  if (m < 1) return t('刚刚')
  if (m < 60) return t('{n} 分钟前', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('{n} 小时前', { n: h })
  return t('{n} 天前', { n: Math.floor(d / 24) })
}
