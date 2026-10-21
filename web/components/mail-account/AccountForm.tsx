import { cx } from '../../lib/cx'
import { Field } from '../ui'
import type { MailSecurity } from '../../lib/api'
import { hintsFor, PRESETS, type FormState } from './form'

/** 添加 / 编辑邮箱的表单：常用邮箱 chip + 九个字段 + 底部提示 */
export function AccountForm({ form, patch, onPreset }: {
  form: FormState
  patch: (p: Partial<FormState>) => void
  onPreset: (host: string) => void
}) {
  return (
    <div className="mail-form">
      <div className="mail-presets">
        <span className="mail-presets-label">常用</span>
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p.key}
            className={cx('chip', form.host === p.host && 'active')}
            onClick={() => onPreset(p.host)}
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
        {hintsFor(form.host).map((h) => (
          <div key={h}>{h}</div>
        ))}
        <div>只做收信阅读：本程序只用 SELECT/SEARCH/FETCH（BODY.PEEK），不会把邮件标成已读，也不会删信、移动、发信。</div>
      </div>
    </div>
  )
}
