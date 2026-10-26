import { useEffect, useState } from 'react'
import { Check, CircleAlert, Plus } from 'lucide-react'
import { api, cx, type MailAccount } from '../lib/api'
import { Button, Drawer } from './ui'
import { AccountForm } from './mail-account/AccountForm'
import { AccountList } from './mail-account/AccountList'
import { applyPreset, blankForm, buildBody, canTest, toForm, type FormState } from './mail-account/form'
import { t } from '../lib/i18n'

/**
 * 邮箱账号抽屉：列表 ↔ 添加/编辑表单，外加「测试连接」与「清除本地已读标记」。
 * 表单形状与提交规则在 ./mail-account/form.ts（有单测），这里只管状态与接口调用。
 */
export function MailAccountDrawer({ open, accounts, onClose, onChanged }: {
  open: boolean
  accounts: MailAccount[]
  onClose: () => void
  onChanged: () => void
}) {
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (!open) {
      setForm(null)
      setMsg(null)
      setConfirmId(null)
    } else if (accounts.length === 0) {
      // 一个账号都没有时，打开抽屉直接进「添加」表单，省掉多点一次
      setForm(blankForm())
      setMsg(null)
    }
  }, [open, accounts.length])

  function startAdd() {
    setForm(blankForm())
    setMsg(null)
  }

  function startEdit(a: MailAccount) {
    setForm(toForm(a))
    setMsg(null)
  }

  function patch(p: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...p } : f))
  }

  function applyPresetHost(host: string) {
    setForm((f) => (f ? applyPreset(f, host) : f))
  }

  async function test() {
    if (!form) return
    setTesting(true)
    setMsg(null)
    try {
      const r = await api.mail.test({
        id: form.id ?? undefined,
        host: form.host,
        port: Number(form.port) || 993,
        username: form.username,
        password: form.password || undefined,
        security: form.security,
        proxy: form.proxy,
      })
      setMsg({
        kind: 'ok',
        text: t('连接成功：{server}，看到 {folders} 个文件夹{enc}', {
          server: r.server,
          folders: r.folders,
          enc: r.encrypted ? t('，连接已加密') : '',
        }),
      })
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    if (!form) return
    setSaving(true)
    setMsg(null)
    try {
      const body = buildBody(form)
      if (form.id === null) await api.mail.create(body)
      else await api.mail.update(form.id, body)
      setForm(null)
      onChanged()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    try {
      await api.mail.remove(id)
      setConfirmId(null)
      if (form?.id === id) setForm(null)
      onChanged()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message })
    }
  }

  async function clearMarks() {
    setClearing(true)
    try {
      await api.mail.clearLocalRead('all')
      setMsg({ kind: 'ok', text: t('已清除本机全部已读标记（服务器上的邮件状态从未被改动）') })
      onChanged()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message })
    } finally {
      setClearing(false)
    }
  }

  const footer = form ? (
    <>
      <Button onClick={() => { setForm(null); setMsg(null) }}>{t('返回')}</Button>
      <div className="grow" />
      <Button onClick={test} disabled={testing || !canTest(form)}>
        {testing ? t('测试中…') : t('测试连接')}
      </Button>
      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? t('保存中…') : form.id === null ? t('添加') : t('保存')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="primary" onClick={startAdd}>
        <Plus size={14} /> {t('添加邮箱')}
      </Button>
      <div className="grow" />
      <Button variant="ghost" onClick={clearMarks} disabled={clearing}>
        {clearing ? t('清理中…') : t('清除本地已读标记')}
      </Button>
    </>
  )

  return (
    <Drawer open={open} onClose={onClose} title={form ? (form.id === null ? t('添加邮箱') : t('编辑邮箱')) : t('邮箱账号')} footer={footer}>
      {msg ? (
        <div className={cx('mail-msg', msg.kind === 'ok' ? 'mail-msg-ok' : 'mail-msg-err')}>
          {msg.kind === 'ok' ? <Check size={14} /> : <CircleAlert size={14} />}
          <span>{msg.text}</span>
        </div>
      ) : null}

      {form ? (
        <AccountForm form={form} patch={patch} onPreset={applyPresetHost} />
      ) : (
        <AccountList accounts={accounts} confirmId={confirmId} onConfirm={setConfirmId} onEdit={startEdit} onRemove={remove} />
      )}
    </Drawer>
  )
}
