import { CircleAlert, Pencil, Trash2 } from 'lucide-react'
import type { MailAccount } from '../../lib/api'
import { Button } from '../ui'
import { securityLabel } from './form'

/** 账号列表：一行一个，编辑 / 删除（删除要二次确认，且会清掉它的本地缓存与已读标记） */
export function AccountList({ accounts, confirmId, onConfirm, onEdit, onRemove }: {
  accounts: MailAccount[]
  confirmId: number | null
  onConfirm: (id: number | null) => void
  onEdit: (a: MailAccount) => void
  onRemove: (id: number) => void
}) {
  return (
    <div className="mail-acc-list">
      {accounts.length === 0 ? (
        <div className="mail-acc-empty">
          还没有邮箱。点下面的「添加邮箱」，Gmail 用应用专用密码，QQ / 163 用授权码。
        </div>
      ) : null}
      {accounts.map((a) => (
        <div className="mail-acc-item" key={a.id}>
          <div className="mail-acc-main">
            <div className="mail-acc-name">{a.label || a.email || a.username}</div>
            <div className="mail-acc-sub">
              {a.host}:{a.port} · {securityLabel(a.security)} · {a.username}
            </div>
            {a.error ? (
              <div className="mail-acc-err">
                <CircleAlert size={12} /> {a.error}
              </div>
            ) : null}
          </div>
          <div className="mail-acc-actions">
            {confirmId === a.id ? (
              <>
                <Button size="sm" variant="danger" onClick={() => onRemove(a.id)}>
                  确认删除
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onConfirm(null)}>
                  取消
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => onEdit(a)}>
                  <Pencil size={13} /> 编辑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onConfirm(a.id)} title="删除账号（同时清掉它的本地缓存和已读标记）">
                  <Trash2 size={13} />
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
