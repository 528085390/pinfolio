import type { MailAccount, MailSecurity } from '../../lib/api'

export type FormState = {
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

export const EMPTY: FormState = {
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
export const PRESETS: { key: string; label: string; host: string; hint: string }[] = [
  { key: 'Gmail', label: 'Gmail', host: 'imap.gmail.com', hint: '密码要填「应用专用密码」：Google 账号 → 安全性 → 两步验证 → 应用专用密码。普通密码一定登录失败。' },
  { key: 'QQ', label: 'QQ 邮箱', host: 'imap.qq.com', hint: '密码要填「授权码」：QQ 邮箱设置 → 账号 → 开启 IMAP 服务后生成。' },
  { key: '163', label: '163 邮箱', host: 'imap.163.com', hint: '密码要填「授权码」；163 要求客户端发 IMAP ID，本程序已自动处理。' },
]

export function securityLabel(v: string) {
  return v === 'ssl' ? 'SSL/TLS' : v === 'starttls' ? 'STARTTLS' : '不加密（仅本机调试）'
}

export function blankForm(): FormState {
  return { ...EMPTY }
}

/** 编辑已有账号：密码永远留空（留空 = 不修改，后端不会回传密码） */
export function toForm(a: MailAccount): FormState {
  return {
    id: a.id,
    label: a.label,
    email: a.email,
    host: a.host,
    port: String(a.port),
    username: a.username,
    password: '',
    security: (a.security as MailSecurity) || 'ssl',
    proxy: a.proxy || '',
  }
}

/** 点常用邮箱的 chip：只改服务器 / 端口 / 加密，别把已经填好的用户名密码冲掉 */
export function applyPreset(form: FormState, host: string): FormState {
  return { ...form, host, port: '993', security: 'ssl' }
}

/** 提交给 POST/PUT 的形状；编辑时密码留空就整个字段不发（后端按「不修改」处理） */
export function buildBody(form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    label: form.label,
    email: form.email,
    host: form.host,
    port: Number(form.port) || 993,
    username: form.username,
    security: form.security,
    proxy: form.proxy,
  }
  if (form.password || form.id === null) body.password = form.password
  return body
}

/** 「测试连接」按钮的可用条件：至少要有服务器和用户名 */
export function canTest(form: FormState): boolean {
  return !!form.host && !!form.username
}

/** 表单下方的提示：当前服务器命中了哪个常用邮箱就说哪个，没命中就只说只读那一段 */
export function hintsFor(host: string): string[] {
  return PRESETS.filter((p) => p.host === host).map((p) => p.hint)
}
