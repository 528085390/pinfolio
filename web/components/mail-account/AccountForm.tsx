import { cx } from '../../lib/cx'
import { Field } from '../ui'
import type { MailSecurity } from '../../lib/api'
import { hintsFor, PRESETS, type FormState } from './form'
import { t } from '../../lib/i18n'

/** 添加 / 编辑邮箱的表单：常用邮箱 chip + 九个字段 + 底部提示 */
export function AccountForm({ form, patch, onPreset }: {
  form: FormState
  patch: (p: Partial<FormState>) => void
  onPreset: (host: string) => void
}) {
  return (
    <div className="mail-form">
      <div className="mail-presets">
        <span className="mail-presets-label">{t('常用')}</span>
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
        <Field label={t('名称')} hint={t('列表和账号筛选里显示，随便写')}>
          <input className="input" value={form.label} placeholder={t('比如：个人 Gmail')} onChange={(e) => patch({ label: e.target.value })} />
        </Field>
        <Field label={t('邮箱地址')} hint={t('选填，只是给你自己看的')}>
          <input className="input" value={form.email} placeholder="you@gmail.com" onChange={(e) => patch({ email: e.target.value })} />
        </Field>
        <Field label={t('IMAP 服务器')} hint={t('收信服务器，不是 SMTP')}>
          <input className="input" value={form.host} placeholder="imap.gmail.com" onChange={(e) => patch({ host: e.target.value })} />
        </Field>
        <Field label={t('端口')}>
          <input className="input" value={form.port} placeholder="993" onChange={(e) => patch({ port: e.target.value })} />
        </Field>
        <Field label={t('用户名')} hint={t('一般就是完整邮箱地址')}>
          <input className="input" value={form.username} placeholder="you@gmail.com" onChange={(e) => patch({ username: e.target.value })} />
        </Field>
        <Field label={t('密码 / 授权码')} hint={form.id === null ? t('不会显示在任何接口返回值里') : t('留空表示不修改')}>
          <input
            className="input"
            type="password"
            value={form.password}
            placeholder={form.id === null ? t('应用专用密码 / 授权码') : t('（不修改就留空）')}
            onChange={(e) => patch({ password: e.target.value })}
          />
        </Field>
        <Field label={t('加密方式')}>
          <select className="select" value={form.security} onChange={(e) => patch({ security: e.target.value as MailSecurity })}>
            <option value="ssl">{t('SSL/TLS（993，推荐）')}</option>
            <option value="starttls">{t('STARTTLS（143）')}</option>
            <option value="none">{t('不加密（仅本机调试）')}</option>
          </select>
        </Field>
        <Field label={t('代理（可选）')} hint={t('国内直连 imap.gmail.com 常超时：填本机 SOCKS5 代理，如 socks5://127.0.0.1:10808；QQ/163 留空直连')}>
          <input className="input" value={form.proxy} placeholder="socks5://127.0.0.1:10808" onChange={(e) => patch({ proxy: e.target.value })} />
        </Field>
      </div>

      <div className="mail-tips">
        {hintsFor(form.host).map((h) => (
          <div key={h}>{h}</div>
        ))}
        <div>{t('只做收信阅读：本程序只用 SELECT/SEARCH/FETCH（BODY.PEEK），不会把邮件标成已读，也不会删信、移动、发信。')}</div>
      </div>
    </div>
  )
}
