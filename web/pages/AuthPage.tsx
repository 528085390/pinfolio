import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { API_BASE } from '../lib/api/http'
import { localeTag, t } from '../lib/i18n'
import type { DemoInfo } from '../lib/demo'

// 登录 / 首次设置密码。两条路径共用一张表单，差别只在标题与校验。
// demo 非空 = 演示站（服务端开了 PINBOARD_DEMO）：口令预先填好，底下写明「数据每天重置」。
export function AuthPage({ mode, onDone, demo = null }: { mode: 'login' | 'setup'; onDone: () => void; demo?: DemoInfo | null }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const setup = mode === 'setup'

  // 演示站口令：服务端随 /api/auth/state 一起给（普通实例是 null）。
  // 到了就填进去；用户已经动过输入框就不覆盖。
  useEffect(() => {
    const preset = demo?.password
    if (setup || !preset) return
    setPw((cur) => (cur ? cur : preset))
  }, [demo?.password, setup])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (setup && pw.length < 8) { setErr(t('密码至少 8 位')); return }
    if (setup && pw !== pw2) { setErr(t('两次输入不一致')); return }
    if (!pw) { setErr(t('请输入密码')); return }
    setBusy(true)
    try {
      const res = await fetch(API_BASE + '/auth/' + (setup ? 'setup' : 'login'), {
        method: 'POST',
        // 服务端按这个头翻译错误文案
        headers: { 'Content-Type': 'application/json', 'Accept-Language': localeTag() },
        body: JSON.stringify({ password: pw }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any))
        setErr(j.error || t('请求失败（{status}）', { status: res.status }))
        return
      }
      onDone()
    } catch {
      setErr(t('连不上服务，请检查网络后重试'))
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
            <div className="auth-sub">{setup ? t('第一次使用，先设个密码') : t('需要密码才能进入')}</div>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">{setup ? t('设置密码') : t('密码')}</span>
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete={setup ? 'new-password' : 'current-password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={setup ? t('至少 8 位') : ''}
            />
          </label>
          {!setup && demo ? <div className="auth-demo">{t('这是演示站，口令已经填好，直接点「进入」就行。')}</div> : null}
          {setup ? (
            <label className="field">
              <span className="field-label">{t('再输一次')}</span>
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
            {busy ? t('稍等…') : setup ? t('设置并进入') : t('进入')}
          </button>
        </form>

        <div className="auth-foot">
          {setup
            ? t('密码只存在这台机器的数据库里，忘记可用 --reset-password 重置。')
            : demo
              ? t('示例数据每天{reset}自动重置，改动不会保留。', { reset: demo.reset })
              : t('会话保留 30 天，设置页可以踢掉其他设备。')}
        </div>
      </div>
    </div>
  )
}
