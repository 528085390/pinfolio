import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Asset, type Tag } from '../../lib/api'
import { usedTagsOf } from './meta'

/** 资产页的数据与视图状态：拉取（筛选变了就重拉）、搜索防抖、标签栏统计 */
export function useAssets({ tags, refreshMeta }: { tags: Tag[]; refreshMeta: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'grid' | 'table'>('grid')

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 220)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.assets.list({ q, kind, status, tag })
      setAssets(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [q, kind, status, tag])

  useEffect(() => { load() }, [load])

  const usedTags = useMemo(() => usedTagsOf(tags), [tags])

  // 抽屉保存后：重拉列表 + 刷新全局 meta（标签计数/统计数字）
  const onSaved = useCallback(() => {
    load()
    refreshMeta()
  }, [load, refreshMeta])

  const filtered = !!(q || kind || status || tag)

  return {
    assets, loading, error, filtered,
    kind, setKind, status, setStatus, tag, setTag,
    searchInput, setSearchInput, q, view, setView,
    usedTags, load, onSaved,
  }
}

export type AssetsState = ReturnType<typeof useAssets>
