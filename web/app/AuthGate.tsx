import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AuthPage } from '../pages/AuthPage'
import { Spinner } from '../components/ui'
import { API_BASE, UNAUTHORIZED_EVENT } from '../lib/api/http'

type Phase = 'loading' | 'setup' | 'login' | 'ready'

// 外壳守卫：先问后端要状态，未初始化给 /setup，未登录给登录页，登录后才挂载整个 App。
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')

  const check = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + '/auth/state', { headers: { Accept: 'application/json' } })
      const j = await res.json()
      setPhase(j.setupRequired ? 'setup' : j.authed ? 'ready' : 'login')
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
  return <AuthPage mode={phase} onDone={() => setPhase('ready')} />
}
