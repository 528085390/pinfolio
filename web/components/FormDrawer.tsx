import type { ReactNode } from 'react'
import { Save } from 'lucide-react'
import { Button, Drawer, Spinner } from './ui'
import { t } from '../lib/i18n'

/**
 * 「编辑表单」类抽屉的共用壳：Drawer + 错误条 + 加载态 + 标准底部（可选左侧危险按钮 + 关闭 + 保存）。
 * 资产详情、观测项详情都用它——加新的编辑抽屉先复用这里，别各写一套 footer。
 */
export function FormDrawer({
  open, onClose, title, loading, error, leading, onSave, saveLabel = t('保存'), saving, saveDisabled, size = 'sm', children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** 加载中：显示转圈并暂时不渲染 children（表单在数据到之前是空壳） */
  loading?: boolean
  /** 加载/保存失败的错误文案 */
  error?: string
  /** 底部左侧的额外按钮（比如「删除」） */
  leading?: ReactNode
  onSave?: () => void
  saveLabel?: string
  saving?: boolean
  saveDisabled?: boolean
  size?: 'sm' | 'md'
  children?: ReactNode
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={(
        <>
          {leading}
          <span className="grow" />
          <Button variant="ghost" size={size} onClick={onClose}>{t('关闭')}</Button>
          <Button variant="primary" size={size} disabled={saveDisabled || saving} onClick={onSave}>
            {saving ? <Spinner /> : <Save size={14} />} {saveLabel}
          </Button>
        </>
      )}
    >
      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="empty"><Spinner /></div> : children}
    </Drawer>
  )
}
