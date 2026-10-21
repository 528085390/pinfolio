import { ExternalLink } from 'lucide-react'
import { FormDrawer } from './FormDrawer'
import { NowSection } from './monitor-drawer/NowSection'
import { BasicSection } from './monitor-drawer/BasicSection'
import { AdvancedSection } from './monitor-drawer/AdvancedSection'
import { RunSection } from './monitor-drawer/RunSection'
import { DangerSection } from './monitor-drawer/DangerSection'
import { useMonitorDetail } from './monitor-drawer/useMonitorDetail'

/** 观测项详情抽屉：改名字 / 介绍 / 频率，暂停恢复，删除，立即观测。外壳走 FormDrawer，内部分五段。 */
export function MonitorDrawer({ id, onClose, onChanged }: {
  id: number | null
  onClose: () => void
  onChanged?: () => void
}) {
  const d = useMonitorDetail({ id, onClose, onChanged })
  const { detail, m, action, loading, error, form, setForm, saveMsg, saveErr, canSave, saving } = d

  return (
    <FormDrawer
      open={id !== null}
      onClose={onClose}
      size="md"
      title={(
        <div className="monitor-drawer-title">
          <span className="monitor-drawer-kicker">观测项详情</span>
          <span className="monitor-drawer-name" title={m?.name}>{m ? m.name : (loading ? '读取中…' : '观测项')}</span>
        </div>
      )}
      loading={!detail && !error}
      error={error}
      onSave={d.save}
      saving={saving}
      saveDisabled={!canSave}
    >
      {detail && m ? (
        <>
          <NowSection detail={detail} m={m} />

          {saveErr ? <div className="alert" style={{ marginTop: 14 }}>{saveErr}</div> : null}
          {saveMsg && !saveErr ? <div className="monitor-drawer-ok">{saveMsg}</div> : null}

          <BasicSection form={form} setForm={setForm} m={m} />
          <AdvancedSection form={form} setForm={setForm} />
          <RunSection
            action={action}
            m={m}
            running={d.running}
            runErr={d.runErr}
            runSteps={d.runSteps}
            runOk={d.runOk}
            runDisabled={d.runDisabled}
            onRun={d.runNow}
          />

          {detail.link ? (
            <div style={{ marginTop: 14 }}>
              <a className="monitor-link" href={detail.link.url} target="_blank" rel="noreferrer noopener" title={detail.link.label}>
                打开项目管理页 <ExternalLink size={11} className="monitor-link-icon" />
              </a>
            </div>
          ) : null}

          <DangerSection
            m={m}
            busy={d.busy}
            onToggleActive={d.toggleActive}
            confirming={d.confirming}
            setConfirming={d.setConfirming}
            confirmName={d.confirmName}
            setConfirmName={d.setConfirmName}
            deleteErr={d.deleteErr}
            setDeleteErr={d.setDeleteErr}
            deleting={d.deleting}
            confirmOk={d.confirmOk}
            onRemove={d.remove}
          />
        </>
      ) : null}
    </FormDrawer>
  )
}
