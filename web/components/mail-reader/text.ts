import type { MailAddr } from '../../lib/api'

/** 一个地址写成「名字 <地址>」；只有名字或只有地址就只写那一半 */
export function addrText(a: MailAddr | null | undefined) {
  if (!a) return ''
  if (a.name && a.address) return a.name + ' <' + a.address + '>'
  return a.name || a.address || ''
}

/** 收件人/抄送列表；空列表写成「（无）」而不是空串，界面上好读 */
export function addrList(list: MailAddr[] | undefined) {
  if (!list || !list.length) return '（无）'
  return list.map(addrText).filter(Boolean).join('，')
}

/** 附件大小：小于 10 KB 留一位小数，再大取整到 KB，超过 1 MB 留一位小数 */
export function bytes(n: number) {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
