import { Zap } from 'lucide-react'
import type { MonitorAction, MonitorActionStepResult } from '../../lib/api'
import { Button } from '../ui'
import type { MonitorFull } from './display'
import { t } from '../../lib/i18n'

/** 立即观测：按 monitor-actions.json 的配方跑一次，并把每一步的回显列出来。 */
export function RunSection({ action, m, running, runErr, runSteps, runOk, runDisabled, onRun }: {
  action?: MonitorAction
  m: MonitorFull
  running: boolean
  runErr: string
  runSteps: MonitorActionStepResult[] | null
  runOk: boolean | null
  runDisabled: boolean
  onRun: () => void
}) {
  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>{t('立即观测')}</div>
      <div className="monitor-drawer-action">
        <Button variant="primary" size="sm" className="monitor-drawer-run" disabled={runDisabled} onClick={onRun}>
          <Zap size={14} /> {running ? t('观测中…') : t('立即观测')}
        </Button>
        <div className="monitor-drawer-steps">
          {action && action.steps.length ? action.steps.map((s, i) => (
            <div key={i} className="monitor-drawer-step">
              <span className="monitor-drawer-step-no">{i + 1}</span>
              <span className="monitor-drawer-step-label">{s.label}</span>
              {s.hint ? <span className="field-hint">{s.hint}</span> : null}
            </div>
          )) : (
            <div className="field-hint">{action?.disabledReason || t('这个观测项没有可立即执行的动作。')}</div>
          )}
        </div>
        {action?.disabledReason && action.steps.length ? <div className="field-hint">{action.disabledReason}</div> : null}
        {m && !m.active && action?.steps.length ? <div className="field-hint">{t('已暂停，先恢复观测再点立即观测。')}</div> : null}
        {action ? (
          <div className="field-hint">
            {t('配方来源：{src}', {
              src: action.source === 'config' ? 'monitor-actions.json' : action.source === 'default' ? t('默认（重启检查循环）') : t('无'),
            })}
          </div>
        ) : null}

        {runErr ? <div className="alert" style={{ marginTop: 10 }}>{runErr}</div> : null}
        {runSteps ? (
          <div className="monitor-drawer-results">
            <div className={'monitor-drawer-result-head' + (runOk === false ? ' fail' : '')}>
              {runOk === false ? t('这次观测没跑完') : t('这次观测跑完了')}
            </div>
            {runSteps.map((s, i) => (
              <div key={i} className={'monitor-drawer-result' + (s.ok ? ' ok' : ' fail')}>
                <span className="monitor-drawer-result-no">{i + 1}</span>
                <span className="monitor-drawer-result-label">{s.label}</span>
                <span className="monitor-drawer-result-ms">{s.ms >= 1000 ? (s.ms / 1000).toFixed(1) + 's' : s.ms + 'ms'}</span>
                <div className="monitor-drawer-result-detail">{s.detail}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}
