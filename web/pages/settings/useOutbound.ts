import { useCallback, useEffect, useState } from 'react'
import { api, type OutboundCfg } from '../../lib/api'
import { buildOutboundPayload, formFromCfg, savedNotice, testNotice, type OutboundForm } from './outbound'

// 「出站模式」卡片的状态与动作。卡片只管画界面，读 / 写 / 重探都在这里（照 useSettings 的写法）。
//
// 两条硬边界：
//   1. GET 失败只写 err，**不抛给设置页** —— kuma 连不上时只有这张卡红字，别的卡片照常能用
//   2. 保存成功后用**响应**回填（mode / proxy / changedAt 全部来自服务端），不自己猜；
//      回填时密码框重新清空（响应用只用 hasPassword，本来就没有明文可回显）
export function useOutbound() {
  const [cfg, setCfg] = useState<OutboundCfg | null>(null)
  const [pending, setPending] = useState<OutboundForm>(() => formFromCfg(null))
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const c = await api.outbound.get()
      setCfg(c)
      setPending(formFromCfg(c))
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 表单局部更新（用户名 / 密码的「动过没有」标记也在这里一起给） */
  function patch(p: Partial<OutboundForm>) {
    setPending((cur) => ({ ...cur, ...p }))
  }

  async function save(next: OutboundForm) {
    setBusy('save'); setMsg(''); setErr('')
    try {
      const r = await api.outbound.save(buildOutboundPayload(next))
      const view: OutboundCfg = { mode: r.mode, proxy: r.proxy, changedAt: r.changedAt }
      setCfg(view)
      setPending(formFromCfg(view))
      setMsg(savedNotice(r.rechecking))
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy('') }
  }

  /** 「测试连通」：kuma 侧异步重探一轮，接口只回答排了几项（所以文案不说「正常」，见 spec §11） */
  async function test() {
    setBusy('test'); setMsg(''); setErr('')
    try {
      const r = await api.outbound.recheck()
      setMsg(testNotice(r.queued))
    } catch (e: any) {
      setErr(e.message)
    } finally { setBusy('') }
  }

  return { cfg, pending, msg, err, busy, load, save, test, patch }
}

export type OutboundState = ReturnType<typeof useOutbound>
