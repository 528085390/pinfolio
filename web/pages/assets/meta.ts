import type { Asset, FieldDef, Tag } from '../../lib/api'
import { localeTag, t } from '../../lib/i18n'

/** 标签栏只列有资产关联的标签，按关联数降序（同数量按名称升序） */
export function usedTagsOf(tags: Tag[]): Tag[] {
  return tags
    .filter((tg) => (tg.assets || 0) > 0)
    .slice()
    .sort((a, b) => (b.assets || 0) - (a.assets || 0) || a.name.localeCompare(b.name, localeTag()))
}

/**
 * 卡片中间那几行「键 / 值」：序列号 → 位置 → 自定义字段（最多 2 个，跳过空值）→ 供应商。
 * 返回顺序就是渲染顺序，卡片上只取前 3 行（见 AssetCard）。
 */
export function cardMeta(asset: Pick<Asset, 'serial' | 'location' | 'custom' | 'vendor'>, fields: Pick<FieldDef, 'key' | 'label'>[]): { k: string; v: string }[] {
  const meta: { k: string; v: string }[] = []
  if (asset.serial) meta.push({ k: t('序列号'), v: asset.serial })
  if (asset.location) meta.push({ k: t('位置'), v: asset.location })
  const customKeys = Object.keys(asset.custom || {}).filter((k) => asset.custom[k] !== '' && asset.custom[k] !== null)
  for (const k of customKeys.slice(0, 2)) {
    const label = fields.find((f) => f.key === k)?.label || k
    meta.push({ k: label, v: String(asset.custom[k]) })
  }
  if (asset.vendor) meta.push({ k: t('供应商'), v: asset.vendor })
  return meta
}
