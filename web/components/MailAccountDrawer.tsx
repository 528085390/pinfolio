import { useEffect, useState } from 'react'
import { Check, CircleAlert, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, cx, type MailAccount, type MailSecurity } from '../lib/api'
import { Button, Drawer, Field } from './ui'

type FormState = {
  id: number | null
  label: string
  email: string
  host: string
  port: string
  username: string
  password: string
  security: MailSecurity
  proxy: string
}

const EMPTY: FormState = {
  id: null,
  label: '',
  email: '',
  host: '',
  port: '993',
  username: '',
  password: '',
  security: 'ssl',
  proxy: '',
}

/** 常见邮箱的预设：只填 host/port，用户名密码仍要自己来 */
const PRESETS: { key: string; label: string; host: string; hint: string }[] = [
  { key: 'Gmail', label: 'Gmail', host: 'imap.gmail.com', hint: '密码要填「应用专用密码」：Google 账号 → 安全性 → 两步验证 → 应用专用密码。普通密码一定登录失败。' },
  { key: 'QQ', label: 'QQ 邮箱', host: 'imap.qq.com', hint: '密码要填「授权码」：QQ 邮箱设置 → 账号 → 开启 IMAP 服务后生成。' },
  { key: '163', label: '163 邮箱', host: 'imap.163.com', hint: '密码要填「授权码」；163 要求客户端发 IMAP ID，本程序已自动处理。' },
]

function securityLabel(v: string) {
  return v === 'ssl' ? 'SSL/TLS' : v === 'starttls' ? 'STARTTLS' : '不加密（仅本机调试）'
}

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
      setForm({ ...EMPTY })
      setMsg(null)
    }
  }, [open, accounts.length])

  function startAdd() {
    setForm({ ...EMPTY })
    setMsg(null)
  }

  function startEdit(a: MailAccount) {
    setForm({
      id: a.id,
      label: a.label,
      email: a.email,
      host: a.host,
      port: String(a.port),
      username: a.username,
      password: '',
      security: (a.security as MailSecurity) || 'ssl',
      proxy: a.proxy || '',
    })
    setMsg(null)
  }

  function patch(p: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...p } : f))
  }

  function applyPreset(host: string) {
    patch({ host, port: '993', security: 'ssl' })
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
      setMsg({ kind: 'ok', text: '连接成功：' + r.server + '，看到 ' + r.folders + ' 个文件夹' + (r.encrypted ? '，连接已加密' : '') })
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
      const body: any = {
        label: form.label,
        email: form.email,
        host: form.host,
        port: Number(form.port) || 993,
        username: form.username,
        security: form.security,
        proxy: form.proxy,
      }
      // 编辑时留空 = 不改密码
      if (form.password || form.id === null) body.password = form.password
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
      setMsg({ kind: 'ok', text: '已清除本机全部已读标记（服务器上的邮件状态从未被改动）' })
      onChanged()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message })
    } finally {
      setClearing(false)
    }
  }

  const footer = form ? (
    <>
      <Button onClick={() => { setForm(null); setMsg(null) }}>返回</Button>
      <div className="grow" />
      <Button onClick={test} disabled={testing || !form.host || !form.username}>
        {testing ? '测试中…' : '测试连接'}
      </Button>
      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? '保存中…' : form.id === null ? '添加' : '保存'}
      </Button>
    </>
  ) : (
    <>
      <Button variant="primary" onClick={startAdd}>
        <Plus size={14} /> 添加邮箱
      </Button>
      <div className="grow" />
      <Button variant="ghost" onClick={clearMarks} disabled={clearing}>
        {clearing ? '清理中…' : '清除本地已读标记'}
      </Button>
    </>
  )

  return (
    <Drawer open={open} onClose={onClose} title={form ? (form.id === null ? '添加邮箱' : '编辑邮箱') : '邮箱账号'} footer={footer}>
      {msg ? (
        <div className={cx('mail-msg', msg.kind === 'ok' ? 'mail-msg-ok' : 'mail-msg-err')}>
          {msg.kind === 'ok' ? <Check size={14} /> : <CircleAlert size={14} />}
          <span>{msg.text}</span>
        </div>
      ) : null}

      {form ? (
        <div className="mail-form">
          <div className="mail-presets">
            <span className="mail-presets-label">常用</span>
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.key}
                className={cx('chip', form.host === p.host && 'active')}
                onClick={() => applyPreset(p.host)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mail-form-grid">
            <Field label="名称" hint="列表和账号筛选里显示，随便写">
              <input className="input" value={form.label} placeholder="比如：个人 Gmail" onChange={(e) => patch({ label: e.target.value })} />
            </Field>
            <Field label="邮箱地址" hint="选填，只是给你自己看的">
              <input className="input" value={form.email} placeholder="you@gmail.com" onChange={(e) => patch({ email: e.target.value })} />
            </Field>
            <Field label="IMAP 服务器" hint="收信服务器，不是 SMTP">
              <input className="input" value={form.host} placeholder="imap.gmail.com" onChange={(e) => patch({ host: e.target.value })} />
            </Field>
            <Field label="端口">
              <input className="input" value={form.port} placeholder="993" onChange={(e) => patch({ port: e.target.value })} />
            </Field>
            <Field label="用户名" hint="一般就是完整邮箱地址">
              <input className="input" value={form.username} placeholder="you@gmail.com" onChange={(e) => patch({ username: e.target.value })} />
            </Field>
            <Field label="密码 / 授权码" hint={form.id === null ? '不会显示在任何接口返回值里' : '留空表示不修改'}>
              <input
                className="input"
                type="password"
                value={form.password}
                placeholder={form.id === null ? '应用专用密码 / 授权码' : '（不修改就留空）'}
                onChange={(e) => patch({ password: e.target.value })}
              />
            </Field>
            <Field label="加密方式">
              <select className="select" value={form.security} onChange={(e) => patch({ security: e.target.value as MailSecurity })}>
                <option value="ssl">SSL/TLS（993，推荐）</option>
                <option value="starttls">STARTTLS（143）</option>
                <option value="none">不加密（仅本机调试）</option>
              </select>
            </Field>
            <Field label="代理（可选）" hint="国内直连 imap.gmail.com 常超时：填本机 SOCKS5 代理，如 socks5://127.0.0.1:10808；QQ/163 留空直连">
              <input className="input" value={form.proxy} placeholder="socks5://127.0.0.1:10808" onChange={(e) => patch({ proxy: e.target.value })} />
            </Field>
          </div>

          <div className="mail-tips">
            {PRESETS.filter((p) => p.host === form.host).map((p) => (
              <div key={p.key}>{p.hint}</div>
            ))}
            <div>只做收信阅读：本程序只用 SELECT/SEARCH/FETCH（BODY.PEEK），不会把邮件标成已读，也不会删信、移动、发信。</div>
          </div>
        </div>
      ) : (
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
                    <Button size="sm" variant="danger" onClick={() => remove(a.id)}>
                      确认删除
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(a)}>
                      <Pencil size={13} /> 编辑
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(a.id)} title="删除账号（同时清掉它的本地缓存和已读标记）">
                      <Trash2 size={13} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
