import type { MonitorDetail } from '../../lib/api'

/** 表单里可改的那几个字段。名字 / 介绍 / 频率直接写回 Kuma，Kuma 是唯一事实源。 */
export type MonitorForm = {
  name: string
  description: string
  interval: number
  timeout: number
  maxretries: number
  retryInterval: number
  showMsg: boolean
}

export const emptyForm = (): MonitorForm => ({
  name: '', description: '', interval: 60, timeout: 20, maxretries: 0, retryInterval: 60, showMsg: false,
})

export const toForm = (d: MonitorDetail): MonitorForm => ({
  name: d.monitor.name,
  description: d.monitor.description,
  interval: d.monitor.interval,
  timeout: d.monitor.timeout,
  maxretries: d.monitor.maxretries,
  retryInterval: d.monitor.retryInterval,
  showMsg: d.monitor.showMsg,
})

export const sameForm = (a: MonitorForm, b: MonitorForm) =>
  a.name === b.name && a.description === b.description && a.interval === b.interval
  && a.timeout === b.timeout && a.maxretries === b.maxretries && a.retryInterval === b.retryInterval
  && a.showMsg === b.showMsg

/** 只把改过的字段发给后端：Kuma 的 editMonitor 是全量覆盖，传得越少越不容易踩到没带回的字段。 */
export function buildPatch(form: MonitorForm, base: MonitorForm): Partial<MonitorForm> {
  const patch: Partial<MonitorForm> = {}
  if (form.name.trim() !== base.name) patch.name = form.name.trim()
  if (form.description.trim() !== base.description) patch.description = form.description.trim()
  if (form.interval !== base.interval) patch.interval = form.interval
  if (form.timeout !== base.timeout) patch.timeout = form.timeout
  if (form.maxretries !== base.maxretries) patch.maxretries = form.maxretries
  if (form.retryInterval !== base.retryInterval) patch.retryInterval = form.retryInterval
  if (form.showMsg !== base.showMsg) patch.showMsg = form.showMsg
  return patch
}

/** 和后端 PATCH 的校验保持一致：名字 1–120 字、频率 20–86400 秒、超时 1–120 且必须小于频率。 */
export function validateForm(form: MonitorForm) {
  const nameOk = form.name.trim().length > 0 && form.name.trim().length <= 120
  const intervalOk = Number.isFinite(form.interval) && form.interval >= 20 && form.interval <= 86400
  const timeoutOk = Number.isFinite(form.timeout) && form.timeout >= 1 && form.timeout <= 120 && form.timeout < form.interval
  return { nameOk, intervalOk, timeoutOk }
}
