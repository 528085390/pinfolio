/** 便签和资产共用的标签；notes/assets 是带上的计数（/bootstrap 才有）。 */
export type Tag = { id: number; name: string; color: string; notes?: number; assets?: number }

/** 资产自定义字段的定义（设置页维护，资产抽屉按它渲染输入框）。 */
export type FieldDef = { id: number; key: string; label: string; type: string; options: string[]; sort: number }

export type Stats = {
  notes: number; archived: number; notesDone: number; notesPending: number; assets: number; active: number; totalValue: number
  expiringSoon: number; expired: number
  expiring: { id: number; name: string; kind: string; expiresAt: string; days: number }[]
}
