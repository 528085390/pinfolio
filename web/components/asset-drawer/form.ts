import type { Asset } from '../../lib/api'

export const STATUSES = ['active', 'idle', 'retired', 'lost']
export const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'HKD']

export type AssetFormState = {
  name: string
  kind: string
  status: string
  location: string
  vendor: string
  serial: string
  price: string
  currency: string
  purchasedAt: string
  expiresAt: string
  url: string
  notes: string
  custom: Record<string, any>
}

export function blank(): AssetFormState {
  return {
    name: '', kind: 'device', status: 'active', location: '', vendor: '', serial: '',
    price: '', currency: 'CNY', purchasedAt: '', expiresAt: '', url: '', notes: '', custom: {},
  }
}

export function toForm(a: Asset): AssetFormState {
  return {
    name: a.name || '',
    kind: a.kind || 'device',
    status: a.status || 'active',
    location: a.location || '',
    vendor: a.vendor || '',
    serial: a.serial || '',
    price: a.price === null || a.price === undefined ? '' : String(a.price),
    currency: a.currency || 'CNY',
    purchasedAt: a.purchasedAt || '',
    expiresAt: a.expiresAt || '',
    url: a.url || '',
    notes: a.notes || '',
    custom: { ...(a.custom || {}) },
  }
}

/** 标签输入框：空格或逗号分隔，去掉前导 #，空项丢掉。 */
export function parseTags(text: string): string[] {
  return text.split(/[\s,，]+/).map((s) => s.replace(/^#/, '').trim()).filter(Boolean)
}

/** 提交给 POST / PATCH 的形状：字符串 trim、空价格与空日期转 null、标签从输入框解析。 */
export function buildPayload(form: AssetFormState, tagsText: string) {
  return {
    name: form.name.trim(),
    kind: form.kind,
    status: form.status,
    location: form.location.trim(),
    vendor: form.vendor.trim(),
    serial: form.serial.trim(),
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency,
    purchasedAt: form.purchasedAt || null,
    expiresAt: form.expiresAt || null,
    url: form.url.trim(),
    notes: form.notes,
    custom: form.custom,
    tags: parseTags(tagsText),
  }
}
