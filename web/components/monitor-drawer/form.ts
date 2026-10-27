import type { MonitorDetail, ProxyProtocol } from '../../lib/api'
import { t } from '../../lib/i18n'
import { proxyLine } from '../../pages/settings/outbound'

/**
 * 单项出站（spec §10.3，D-a）的三个值：跟随全局 / 强制直连 / 强制经代理。
 * 与 kuma 侧 `outbound_mode` 列、pinboard 后端 patch.ts 的值域**逐字对齐**，别加别名。
 */
export type OutboundPin = 'follow' | 'direct' | 'proxy'

/** 三选一的固定顺序（界面按这个顺序画，测试也按它断言） */
export const OUTBOUND_PINS: OutboundPin[] = ['follow', 'direct', 'proxy']

/** 脏值 / 老 bean 缺字段一律回 follow（= 不改全局行为，最保守） */
export function pinOf(raw: unknown): OutboundPin {
  return raw === 'direct' || raw === 'proxy' || raw === 'follow' ? raw : 'follow'
}

/** 表单里可改的那几个字段。名字 / 介绍 / 频率直接写回 Kuma，Kuma 是唯一事实源。 */
export type MonitorForm = {
  name: string
  description: string
  interval: number
  timeout: number
  maxretries: number
  retryInterval: number
  showMsg: boolean
  /** 出站模式：这一项自己钉死，还是跟随设置页的全局开关 */
  outboundMode: OutboundPin
}

export const emptyForm = (): MonitorForm => ({
  name: '', description: '', interval: 60, timeout: 20, maxretries: 0, retryInterval: 60, showMsg: false,
  outboundMode: 'follow',
})

export const toForm = (d: MonitorDetail): MonitorForm => ({
  name: d.monitor.name,
  description: d.monitor.description,
  interval: d.monitor.interval,
  timeout: d.monitor.timeout,
  maxretries: d.monitor.maxretries,
  retryInterval: d.monitor.retryInterval,
  showMsg: d.monitor.showMsg,
  // 老服务的 toJSON 可能没有这个字段（升级前建的观测项）→ 一律当 follow
  outboundMode: pinOf(d.monitor.outboundMode),
})

export const sameForm = (a: MonitorForm, b: MonitorForm) =>
  a.name === b.name && a.description === b.description && a.interval === b.interval
  && a.timeout === b.timeout && a.maxretries === b.maxretries && a.retryInterval === b.retryInterval
  && a.showMsg === b.showMsg && a.outboundMode === b.outboundMode

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
  if (form.outboundMode !== base.outboundMode) patch.outboundMode = form.outboundMode
  return patch
}

/**
 * 「跟随全局（当前：…）」这行说明文字。
 *
 * 全局模式的 GET 拿不到时**降级**成「跟随全局」不带括号（spec §10.3）：抽屉照常能用，
 * 不能因为设置页那份配置读不到就卡住改名字这种小事。
 */
export function pinHintText(cfg: { mode: 'direct' | 'proxy'; proxy: { protocol: ProxyProtocol; host: string; port: number } | null } | null): string {
  if (!cfg) return t('跟随全局')
  if (cfg.mode !== 'proxy') return t('跟随全局（当前：直连）')
  if (!cfg.proxy) return t('跟随全局（当前：经代理，还没配代理）')
  // 摘要永远不含账号密码（proxyLine 只拼 protocol host:port）
  return t('跟随全局（当前：经代理 {proxy}）', { proxy: proxyLine(cfg.proxy) })
}

/** 和后端 PATCH 的校验保持一致：名字 1–120 字、频率 20–86400 秒、超时 1–120 且必须小于频率。 */
export function validateForm(form: MonitorForm) {
  const nameOk = form.name.trim().length > 0 && form.name.trim().length <= 120
  const intervalOk = Number.isFinite(form.interval) && form.interval >= 20 && form.interval <= 86400
  const timeoutOk = Number.isFinite(form.timeout) && form.timeout >= 1 && form.timeout <= 120 && form.timeout < form.interval
  return { nameOk, intervalOk, timeoutOk }
}

/** 「保存」按钮能不能点：有改动 + 三项校验都过 + 不在保存中。没有基准（详情还没读到）时一律不能点。 */
export function canSaveForm(form: MonitorForm, base: MonitorForm | null, saving: boolean): boolean {
  const dirty = base ? !sameForm(form, base) : false
  const { nameOk, intervalOk, timeoutOk } = validateForm(form)
  return dirty && nameOk && intervalOk && timeoutOk && !saving
}

/** 「立即观测」按钮能不能点：有配方、配方没被置灰、没在跑、观测项存在且没暂停。 */
export function runDisabledOf(
  action: MonitorDetail['action'] | undefined,
  m: MonitorDetail['monitor'] | undefined,
  running: boolean,
): boolean {
  return !action || !!action.disabledReason || running || !m || !m.active
}

/** 删除二次确认：手输的名字（去空白）必须和当前名字（去空白）完全一样。 */
export function confirmMatches(m: MonitorDetail['monitor'] | undefined, confirmName: string): boolean {
  return !!m && confirmName.trim() === m.name.trim()
}
