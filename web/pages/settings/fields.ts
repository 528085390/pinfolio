// 设置页的纯逻辑：字段类型表、选项解析、新建校验、导出文件名、标签名归一。
// 都不碰 React 与网络，所以能直接单测（tests/unit/settings-fields.test.mts）。
import { t } from '../../lib/i18n'

export type FieldTypeOption = { v: string; label: string }

// label 用 getter：调用方照旧写 FIELD_TYPES[i].label，取值时才知道当前语言，
// 不在模块加载期调 t()（那会把当时语言的译文冻住，见 docs/i18n.md）。
export const FIELD_TYPES: FieldTypeOption[] = [
  { v: 'text', get label() { return t('文本') } },
  { v: 'number', get label() { return t('数字') } },
  { v: 'date', get label() { return t('日期') } },
  { v: 'url', get label() { return t('链接') } },
  { v: 'select', get label() { return t('单选') } },
  { v: 'bool', get label() { return t('开关') } },
]

/** 未知类型原样显示（别悄悄变成「文本」，否则坏数据看不出来） */
export function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((ft) => ft.v === type)?.label || type
}

/** 单选字段的选项：中文/英文逗号都认，去空白、丢空项 */
export function parseFieldOptions(text: string): string[] {
  return text.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
}

/** 新建字段的前置校验：返回错误文案，没问题回 null */
export function validateNewField(key: string, label: string): string | null {
  if (!key.trim() || !label.trim()) return t('字段 key 和显示名都要填')
  return null
}

/** 导出文件名：pinboard-YYYY-MM-DD.json（UTC 日期，与原实现一致） */
export function exportFilename(d: Date = new Date()): string {
  return 'pinboard-' + d.toISOString().slice(0, 10) + '.json'
}

/** 新标签名：去空白、去掉用户顺手写的开头 # */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#/, '')
}

/** 删除确认文案（带名字，避免点错行） */
export function fieldDeletePrompt(label: string): string {
  return t('删除字段「{label}」？已填的值会留在数据里但不再显示。', { label })
}

export function tagDeletePrompt(name: string): string {
  return t('删除标签「#{name}」？便签和资产本身不会被删除。', { name })
}
