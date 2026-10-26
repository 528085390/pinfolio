import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Monitor } from './api'

/** 通知轮询间隔：和观测页一致。后端 /api/monitors 有 5 秒缓存，Kuma 探测间隔通常 60 秒 */
export const ALERT_POLL_MS = 30000

export type MonitorAlert = {
  id: number
  /** 已去掉「组名 / 」前缀的短名 */
  name: string
  /** 去掉地区后缀的机器名 */
  group: string
  /** 心跳消息（已去掉四态前缀），空串表示没给消息 */
  msg: string
  /** 发现这次故障的时刻（毫秒） */
  since: number
}

/** 「出问题」的唯一判定：Kuma DOWN，或四态心跳消息带 [红]。和观测卡片 .down 用同一套规则 */
export function isDown(m: Monitor) {
  return m.status === 0 || (m.msg || '').startsWith('[\u7ea2]') // [红]
}

// 组名去掉地区后缀：「my-server (阿里云)」→「my-server」
export function shortGroup(name: string) {
  return name.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || name
}

// monitor 名普遍带「机器 / 」前缀（与所属组重复），卡片和通知上都省掉，机器靠副标题区分
export function shortName(m: Monitor) {
  const prefix = shortGroup(m.group) + ' / '
  return m.name.startsWith(prefix) ? m.name.slice(prefix.length) : m.name
}

/** 心跳消息去掉四态前缀，通知里只显示故障本身 */
export function plainMsg(msg: string) {
  return (msg || '').replace(/^\[([\u7eff\u9ec4\u7ea2\u7070])\]\s*/, '').trim() // 绿/黄/红/灰
}

/**
 * 观测异常通知：每 30 秒读一次观测台数据（走缓存，不直捅 Kuma），
 * 把「本次会话里新变成故障」的观测项挂到右上角，恢复正常自动摘掉。
 * 首轮只当基线：页面打开时已经红的不弹，免得每次开页面都被旧故障刷屏。
 */
export function useMonitorAlerts() {
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])
  const baselined = useRef(false)
  const dismissed = useRef<Set<number>>(new Set())

  const check = useCallback(async () => {
    let d
    try {
      d = await api.monitors.get()
    } catch {
      return // 这轮读不到就跳过：不清空也不新增
    }
    if (d.stale) return // Kuma 挂了沿用旧值，不可信：不据此弹，也不据此关
    const down = new Map<number, Monitor>()
    for (const g of d.groups || []) {
      for (const m of g.monitors) {
        if (m.active === false) continue // 手动暂停的不算故障
        if (isDown(m)) down.set(m.id, m)
      }
    }
    if (!baselined.current) {
      baselined.current = true
      return
    }
    setAlerts((prev) => {
      const next = prev.filter((a) => down.has(a.id)) // 观测恢复正常 → 自动关闭
      for (const [id, m] of down) {
        if (next.some((a) => a.id === id)) continue
        if (dismissed.current.has(id)) continue // 点过 × 的，恢复前不再弹
        next.push({ id, name: shortName(m), group: shortGroup(m.group), msg: plainMsg(m.msg), since: Date.now() })
      }
      return next.length === prev.length && next.every((a, i) => a === prev[i]) ? prev : next
    })
    // 已恢复的项清掉「不再打扰」标记，下次再坏还能弹
    for (const id of Array.from(dismissed.current)) if (!down.has(id)) dismissed.current.delete(id)
  }, [])

  useEffect(() => {
    void check()
    const timer = setInterval(() => { void check() }, ALERT_POLL_MS)
    return () => clearInterval(timer)
  }, [check])

  const dismiss = useCallback((id: number) => {
    dismissed.current.add(id)
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return { alerts, dismiss }
}
