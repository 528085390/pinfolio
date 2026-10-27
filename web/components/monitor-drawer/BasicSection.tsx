import type { Dispatch, SetStateAction } from 'react'
import { Field } from '../ui'
import { TYPE_LABEL, type MonitorFull } from './display'
import { OUTBOUND_PINS, pinHintText, type MonitorForm, type OutboundPin } from './form'
import { useOutbound } from '../../pages/settings/useOutbound'
import { t } from '../../lib/i18n'

// 三选一的按钮文案（R3：这三条键在 shared/i18n/en/settings.ts 里早就有，别再写一份）
const PIN_LABEL: Record<OutboundPin, string> = {
  follow: '跟随全局',
  direct: '钉：直连',
  proxy: '钉：代理',
}

/** 基本信息：名字、介绍、检查频率（含常用档位）、出站模式，以及只读的类型 / 目标 / 分组 / 策略。 */
export function BasicSection({ form, setForm, m }: {
  form: MonitorForm
  setForm: Dispatch<SetStateAction<MonitorForm>>
  m: MonitorFull
}) {
  // 当前全局模式只用于那行说明文字（「跟随全局（当前：经代理 socks5h …）」）。
  // 复用设置页那个 hook 的 GET；读不到时 pinHintText(null) 降级成「跟随全局」不带括号，
  // **绝不因此阻塞抽屉** —— 改名、改频率跟出站设置没有依赖关系。
  const outbound = useOutbound()

  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>{t('基本信息')}</div>
      <div className="form-grid">
        <Field label={t('名称')} span hint={t('Kuma 里的观测项名字，改名会同步到 CLI 和 SNAPSHOT')}>
          <input
            className="input"
            name="name"
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label={t('介绍')} span hint={t('给这个观测项写一句人话，卡片上悬停可见')}>
          <textarea
            className="textarea"
            name="description"
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label={t('检查频率（秒）')} hint={m.policy ? t('受下面的策略影响，真实频率可能不同') : t('20–86400 秒')}>
          <div className="monitor-drawer-inline">
            <input
              className="input"
              name="interval"
              type="number"
              min={20}
              max={86400}
              step={10}
              value={form.interval}
              onChange={(e) => setForm({ ...form, interval: Number(e.target.value) })}
            />
            <div className="monitor-drawer-chips">
              {[30, 60, 300, 600, 1800].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={'monitor-chip-btn' + (form.interval === s ? ' on' : '')}
                  onClick={() => setForm({ ...form, interval: s })}
                >
                  {s < 60 ? t('{n} 秒', { n: s }) : t('{n} 分', { n: s / 60 })}
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field label={t('出站模式')} span hint={pinHintText(outbound.cfg)}>
          <div className="monitor-drawer-chips">
            {OUTBOUND_PINS.map((pin) => (
              <button
                key={pin}
                type="button"
                className={'monitor-chip-btn' + (form.outboundMode === pin ? ' on' : '')}
                onClick={() => setForm({ ...form, outboundMode: pin })}
              >
                {t(PIN_LABEL[pin])}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('类型 / 目标')}>
          <div className="monitor-drawer-readonly">
            <span className="monitor-chip">{TYPE_LABEL[m.type] || m.type}</span>
            <span className="monitor-drawer-target" title={m.target}>{m.target}</span>
          </div>
        </Field>
        {m.group ? (
          <Field label={t('分组')} span>
            <div className="monitor-drawer-readonly"><span className="monitor-drawer-target">{m.group}</span></div>
          </Field>
        ) : null}
        {m.policy ? (
          <Field label={t('观测策略 · {name}', { name: m.policy.name })} span>
            <div className="monitor-drawer-policy">{m.policy.summary}</div>
          </Field>
        ) : null}
      </div>
    </>
  )
}
