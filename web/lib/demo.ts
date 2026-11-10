import { useSyncExternalStore } from 'react'

// 演示站信息（口令 / 重置时间 / 源码地址）：来自免鉴权的 /api/auth/state。
// 普通实例那里是 null，所以下面所有 UI 都靠「有没有值」决定显不显示。
export type DemoInfo = { password: string; reset: string; repo: string }

let info: DemoInfo | null = null
const listeners = new Set<() => void>()

export function setDemoInfo(next: DemoInfo | null): void {
  const same = JSON.stringify(next ?? null) === JSON.stringify(info)
  info = next ?? null
  if (!same) listeners.forEach((l) => l())
}

export function getDemoInfo(): DemoInfo | null {
  return info
}

/** AuthGate 在挂载 App 之前就写好了，这里只订阅，不重复请求。 */
export function useDemo(): DemoInfo | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    getDemoInfo,
    getDemoInfo,
  )
}
