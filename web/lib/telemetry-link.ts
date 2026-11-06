// 资产与主机指标 / 观测项之间的双向联动纯函数

export type AssetTelemetry = {
  hostId: string | null
  monitorIds: number[]
}

/**
 * 剥离观测项组名后缀
 * 例：「aws (AWS · 俄勒冈)」->「aws」
 */
export function shortGroup(name: string): string {
  if (!name) return ''
  return name.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || name.trim()
}

/**
 * 安全解析 asset.custom 中的 hostId 与 monitorIds
 * - hostId: trim 字符串，非字符串或空白回退 null
 * - monitorIds: 正整数数组，去重且过滤无效项
 */
export function parseAssetTelemetry(custom: any): AssetTelemetry {
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
    return { hostId: null, monitorIds: [] }
  }

  const rawHostId = custom.hostId
  let hostId: string | null = null
  if (typeof rawHostId === 'string') {
    const trimmed = rawHostId.trim()
    if (trimmed.length > 0) {
      hostId = trimmed
    }
  }

  const rawMonitors = custom.monitorIds
  const monitorIds: number[] = []
  if (Array.isArray(rawMonitors)) {
    const seen = new Set<number>()
    for (const item of rawMonitors) {
      if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
        if (!seen.has(item)) {
          seen.add(item)
          monitorIds.push(item)
        }
      }
    }
  }

  return { hostId, monitorIds }
}

/**
 * 将 hostId 与 monitorIds 合并进 asset.custom 的浅拷贝
 * 不污染原对象，保留已有其它自定义属性
 */
export function mergeAssetTelemetry(
  custom: any,
  telemetry: Partial<AssetTelemetry>
): Record<string, any> {
  const base =
    custom && typeof custom === 'object' && !Array.isArray(custom) ? { ...custom } : {}

  if (telemetry.hostId !== undefined) {
    base.hostId = telemetry.hostId
  }
  if (telemetry.monitorIds !== undefined) {
    base.monitorIds = [...telemetry.monitorIds]
  }

  return base
}

/**
 * 根据资产名称与位置，智能推荐匹配的主机 ID 与监控项 ID 列表
 */
export function suggestTelemetry(
  assetName: string,
  assetLocation: string,
  availableHosts: Array<{ id: string; label?: string }>,
  availableMonitors: Array<{ id: number; name: string; group?: string }>
): { suggestedHostId: string | null; suggestedMonitorIds: number[] } {
  const nameLower = (assetName || '').trim().toLowerCase()
  const locLower = (assetLocation || '').trim().toLowerCase()

  let suggestedHostId: string | null = null

  // 1. 匹配主机 ID / Label（忽略大小写）
  if (Array.isArray(availableHosts)) {
    // 优先匹配主机 id
    for (const host of availableHosts) {
      const hid = (host.id || '').trim().toLowerCase()
      if (!hid) continue
      if ((nameLower && nameLower === hid) || (locLower && locLower === hid)) {
        suggestedHostId = host.id
        break
      }
    }

    // 其次匹配主机 label
    if (!suggestedHostId) {
      for (const host of availableHosts) {
        const hlabel = (host.label || '').trim().toLowerCase()
        if (!hlabel) continue
        if ((nameLower && nameLower === hlabel) || (locLower && locLower === hlabel)) {
          suggestedHostId = host.id
          break
        }
      }
    }
  }

  // 2. 匹配观测项（通过匹配的主机、或资产名称，匹配组名或监控项名）
  const suggestedMonitorIds: number[] = []
  if (Array.isArray(availableMonitors)) {
    const seen = new Set<number>()
    const hostTarget = suggestedHostId ? suggestedHostId.toLowerCase() : null

    for (const m of availableMonitors) {
      if (!m || typeof m.id !== 'number') continue
      const mgroup = (m.group || '').trim()
      const mgroupShort = shortGroup(mgroup).toLowerCase()
      const mgroupRaw = mgroup.toLowerCase()
      const mname = (m.name || '').trim().toLowerCase()

      let matched = false

      // 规则 A：通过匹配到的主机 ID 匹配观测组或观测项前缀
      if (hostTarget) {
        if (
          mgroupShort === hostTarget ||
          mname.startsWith(`${hostTarget} /`) ||
          mname.startsWith(`${hostTarget}/`) ||
          mgroupRaw.includes(hostTarget)
        ) {
          matched = true
        }
      }

      // 规则 B：直接通过资产名称匹配组名或前缀
      if (!matched && nameLower) {
        if (
          mgroupShort === nameLower ||
          mname.startsWith(`${nameLower} /`) ||
          mname.startsWith(`${nameLower}/`)
        ) {
          matched = true
        }
      }

      if (matched && !seen.has(m.id)) {
        seen.add(m.id)
        suggestedMonitorIds.push(m.id)
      }
    }
  }

  return { suggestedHostId, suggestedMonitorIds }
}

/**
 * 反向查找：根据 hostId 找出关联的资产列表
 * 条件：custom.hostId === hostId 或 asset.name === hostId（忽略大小写）
 */
export function findAssetsForHost(
  hostId: string,
  assets: Array<{ id: number; name: string; custom?: any }>
): Array<{ id: number; name: string }> {
  if (!hostId || !Array.isArray(assets)) return []

  const target = hostId.trim().toLowerCase()
  const result: Array<{ id: number; name: string }> = []

  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'number') continue
    const cHost =
      asset.custom?.hostId && typeof asset.custom.hostId === 'string'
        ? asset.custom.hostId.trim().toLowerCase()
        : ''
    const aName = asset.name ? asset.name.trim().toLowerCase() : ''

    if ((cHost && cHost === target) || (aName && aName === target)) {
      result.push({ id: asset.id, name: asset.name })
    }
  }

  return result
}

/**
 * 反向查找：根据 monitorId 与 monitorGroup 找出关联的资产列表
 * 条件：custom.monitorIds 包含 monitorId 或 asset.name 匹配 monitorGroup（忽略大小写）
 */
export function findAssetsForMonitor(
  monitorId: number,
  monitorGroup: string,
  assets: Array<{ id: number; name: string; custom?: any }>
): Array<{ id: number; name: string }> {
  if (!Array.isArray(assets)) return []

  const targetGroup = (monitorGroup || '').trim().toLowerCase()
  const targetGroupShort = shortGroup(monitorGroup || '').toLowerCase()
  const result: Array<{ id: number; name: string }> = []
  const seen = new Set<number>()

  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'number') continue
    if (seen.has(asset.id)) continue

    let matched = false

    // 检查 custom.monitorIds
    if (
      Array.isArray(asset.custom?.monitorIds) &&
      asset.custom.monitorIds.includes(monitorId)
    ) {
      matched = true
    }

    // 检查 asset.name 是否匹配监控项组名
    if (!matched && asset.name) {
      const aName = asset.name.trim().toLowerCase()
      if (
        (targetGroup && aName === targetGroup) ||
        (targetGroupShort && aName === targetGroupShort)
      ) {
        matched = true
      }
    }

    if (matched) {
      seen.add(asset.id)
      result.push({ id: asset.id, name: asset.name })
    }
  }

  return result
}
