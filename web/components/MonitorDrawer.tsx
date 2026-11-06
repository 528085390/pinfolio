import { ExternalLink } from 'lucide-react'
import { FormDrawer } from './FormDrawer'
import { NowSection } from './monitor-drawer/NowSection'
import { BasicSection } from './monitor-drawer/BasicSection'
import { AdvancedSection } from './monitor-drawer/AdvancedSection'
import { RunSection } from './monitor-drawer/RunSection'
import { DangerSection } from './monitor-drawer/DangerSection'
import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { findAssetsForMonitor } from '../lib/telemetry-link'
import { useMonitorDetail } from './monitor-drawer/useMonitorDetail'
import { t } from '../lib/i18n'

/** 观测项详情抽屉：改名字 / 介绍 / 频率，暂停恢复，删除，立即观测。外壳走 FormDrawer，内部分五段。 */
export function MonitorDrawer({ id, flavor = 'fork', onClose, onChanged, assets, onOpenAsset }: {
  id: number | null
  /** 连的是哪个 Kuma：上游原版没有「立即观测」背后的那些扩展，就不渲染那一段 */
  flavor?: 'fork' | 'upstream'
  onClose: () => void
  onChanged?: () => void
  assets?: Array<{ id: number; name: string; custom?: any }>
  onOpenAsset?: (id: number) => void
}) {
  const d = useMonitorDetail({ id, onClose, onChanged })
  const { detail, m, action, loading, error, form, setForm, saveMsg, saveErr, canSave, saving } = d
  const [loadedAssets, setLoadedAssets] = useState<Array<{ id: number; name: string; custom?: any }>>([])

  useEffect(() => {
    if (id === null || assets) return
    let alive = true
    api.assets.list({}).then((list) => {
      if (alive && Array.isArray(list)) setLoadedAssets(list)
    }).catch(() => {})
    return () => { alive = false }
  }, [id, assets])

  const allAssets = assets ?? loadedAssets
  const linkedAssets = m ? findAssetsForMonitor(m.id, m.group || '', allAssets) : []

  return (
    <FormDrawer
      open={id !== null}
      onClose={onClose}
      size="md"
      title={(
        <div className="monitor-drawer-title">
          <span className="monitor-drawer-kicker">{t('观测项详情')}</span>
          <span className="monitor-drawer-name" title={m?.name}>{m ? m.name : (loading ? t('读取中…') : t('观测项'))}</span>
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

          <BasicSection form={form} setForm={setForm} m={m} linkedAssets={linkedAssets} onOpenAsset={onOpenAsset} />
          <AdvancedSection form={form} setForm={setForm} />
          {flavor === 'fork' ? (
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
          ) : null}

          {detail.link ? (
            <div style={{ marginTop: 14 }}>
              <a className="monitor-link" href={detail.link.url} target="_blank" rel="noreferrer noopener" title={detail.link.label}>
                {t('打开项目管理页')} <ExternalLink size={11} className="monitor-link-icon" />
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
