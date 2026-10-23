import { useState } from 'react'
import { Pin } from 'lucide-react'
import { API_BASE } from '../lib/api/http'

// 登录 / 首次设置密码。两条路径共用一张表单，差别只在标题与校验。
export function AuthPage({ mode, onDone }: { mode: 'login' | 'setup'; onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const setup = mode === 'setup'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (setup && pw.length < 8) { setErr('密码至少 8 位'); return }
    if (setup && pw !== pw2) { setErr('两次输入不一致'); return }
    if (!pw) { setErr('请输入密码'); return }
    setBusy(true)
    try {
      const res = await fetch(API_BASE + '/auth/' + (setup ? 'setup' : 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any))
        setErr(j.error || '请求失败（' + res.status + '）')
        return
      }
      onDone()
    } catch {
      setErr('连不上服务，请检查网络后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="auth-mark"><Pin size={17} /></span>
          <div>
            <div className="auth-name">pinfolio</div>
            <div className="auth-sub">{setup ? '第一次使用，先设个密码' : '需要密码才能进入'}</div>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">{setup ? '设置密码' : '密码'}</span>
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete={setup ? 'new-password' : 'current-password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={setup ? '至少 8 位' : ''}
            />
          </label>
          {setup ? (
            <label className="field">
              <span className="field-label">再输一次</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </label>
          ) : null}
          {err ? <div className="auth-err">{err}</div> : null}
          <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
            {busy ? '稍等…' : setup ? '设置并进入' : '进入'}
          </button>
        </form>

        <div className="auth-foot">
          {setup ? '密码只存在这台机器的数据库里，忘记可用 --reset-password 重置。' : '会话保留 30 天，设置页可以踢掉其他设备。'}
        </div>
      </div>
    </div>
  )
}
