import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AuthPage } from '../pages/AuthPage'
import { Spinner } from '../components/ui'
import { API_BASE, UNAUTHORIZED_EVENT } from '../lib/api/http'
import { setDemoInfo, type DemoInfo } from '../lib/demo'

type Phase = 'loading' | 'setup' | 'login' | 'ready'

// 外壳守卫：先问后端要状态，未初始化给 /setup，未登录给登录页，登录后才挂载整个 App。
// 已登录优先：桌面端免密会话存在但库里没有密码时要直接进主界面（authed && setupRequired 只有桌面端造得出来）。
// 演示站：/auth/state 会多带一个 demo 字段（普通实例是 null），一份数据两处用——
// 登录页拿去预填口令，主界面横幅（web/components/DemoBanner.tsx）拿去显示「这是演示站」。
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [demo, setDemo] = useState<DemoInfo | null>(null)

  const check = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + '/auth/state', { headers: { Accept: 'application/json' } })
      const j = await res.json()
      const info: DemoInfo | null = j.demo ?? null
      setDemoInfo(info)
      setDemo(info)
      setPhase(j.authed ? 'ready' : j.setupRequired ? 'setup' : 'login')
    } catch {
      setPhase('login')
    }
  }, [])

  useEffect(() => { void check() }, [check])

  useEffect(() => {
    const onUnauthorized = () => setPhase('login')
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  if (phase === 'loading') return <div className="auth-splash"><Spinner /></div>
  if (phase === 'ready') return <>{children}</>
  return <AuthPage mode={phase} demo={demo} onDone={() => setPhase('ready')} />
}
