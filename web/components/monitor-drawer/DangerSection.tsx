import { Pause, Play, Trash2 } from 'lucide-react'
import { Button, Field } from '../ui'
import type { MonitorFull } from './display'
import { t } from '../../lib/i18n'

/** 危险操作：暂停 / 恢复，删除（要手输观测项名字，服务端删前会备份 kuma.db）。 */
export function DangerSection({ m, busy, onToggleActive, confirming, setConfirming, confirmName, setConfirmName, deleteErr, setDeleteErr, deleting, confirmOk, onRemove }: {
  m: MonitorFull
  busy: boolean
  onToggleActive: () => void
  confirming: boolean
  setConfirming: (v: boolean) => void
  confirmName: string
  setConfirmName: (v: string) => void
  deleteErr: string
  setDeleteErr: (v: string) => void
  deleting: boolean
  confirmOk: boolean
  onRemove: () => void
}) {
  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>{t('危险操作')}</div>
      {!confirming ? (
        <div className="monitor-drawer-actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onToggleActive}>
            {m.active ? <><Pause size={14} /> {t('暂停观测')}</> : <><Play size={14} /> {t('恢复观测')}</>}
          </Button>
          <span className="grow" />
          <Button variant="danger" size="sm" onClick={() => { setConfirming(true); setConfirmName(''); setDeleteErr('') }}>
            <Trash2 size={14} /> {t('删除观测')}
          </Button>
        </div>
      ) : (
        <div className="monitor-drawer-confirm">
          <div className="monitor-drawer-confirm-title">{t('删除「{name}」？', { name: m.name })}</div>
          <div className="monitor-drawer-confirm-text">
            {t('会连同它的历史心跳一起从 Kuma 删掉，不能撤销。删除前会自动备份一份')} <code>kuma.db</code>{t('。')}
          </div>
          <Field label={t('把观测项名字原样输一遍：{name}', { name: m.name })}>
            <input
              className="input"
              name="confirmName"
              autoFocus
              value={confirmName}
              placeholder={t('在这里输入名字')}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </Field>
          {deleteErr ? <div className="alert" style={{ marginTop: 10 }}>{deleteErr}</div> : null}
          <div className="monitor-drawer-actions" style={{ marginTop: 12 }}>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>{t('取消')}</Button>
            <span className="grow" />
            <Button variant="danger" size="sm" disabled={!confirmOk || deleting} onClick={onRemove}>
              <Trash2 size={14} /> {deleting ? t('删除中…') : t('确认删除')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
