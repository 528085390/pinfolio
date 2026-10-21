import { Plus, Package } from 'lucide-react'
import type { FieldDef, Stats, Tag } from '../lib/api'
import { Button, Empty, Spinner } from '../components/ui'
import { AssetDrawer } from '../components/AssetDrawer'
import { useAssets } from './assets/useAssets'
import { AssetStats } from './assets/AssetStats'
import { AssetFilters } from './assets/AssetFilters'
import { AssetTagBar } from './assets/AssetTagBar'
import { AssetCard } from './assets/AssetCard'
import { AssetTable } from './assets/AssetTable'

export function AssetsPage({ tags, fields, stats, refreshMeta, openAssetId, setOpenAssetId }: {
  tags: Tag[]
  fields: FieldDef[]
  stats: Stats | null
  refreshMeta: () => void
  openAssetId: number | 'new' | null
  setOpenAssetId: (v: number | 'new' | null) => void
}) {
  const A = useAssets({ tags, refreshMeta })

  return (
    <div className="page page-wide">
      <AssetStats stats={stats} />

      <AssetFilters
        kind={A.kind}
        onKind={A.setKind}
        status={A.status}
        onStatus={A.setStatus}
        searchInput={A.searchInput}
        onSearchInput={A.setSearchInput}
        view={A.view}
        onView={A.setView}
        onNew={() => setOpenAssetId('new')}
      />

      <AssetTagBar usedTags={A.usedTags} tag={A.tag} onTag={A.setTag} />

      {A.error ? <div className="alert" style={{ marginTop: 14 }}>{A.error}</div> : null}

      {A.loading && A.assets.length === 0 ? (
        <div className="empty"><Spinner /></div>
      ) : A.assets.length === 0 ? (
        <Empty
          icon={<Package size={22} />}
          title={A.filtered ? '没有匹配的资产' : '还没有登记资产'}
          text={A.filtered ? '换个筛选条件试试。' : '设备、服务器、域名、订阅账号——都记在这里。字段可以自己加。'}
          action={<Button variant="primary" size="sm" onClick={() => setOpenAssetId('new')}><Plus size={14} /> 登记第一件</Button>}
        />
      ) : A.view === 'grid' ? (
        <div className="asset-grid" style={{ marginTop: 14 }}>
          {A.assets.map((a) => <AssetCard key={a.id} asset={a} fields={fields} onClick={() => setOpenAssetId(a.id)} />)}
        </div>
      ) : (
        <AssetTable assets={A.assets} onOpen={setOpenAssetId} />
      )}

      <AssetDrawer
        open={openAssetId !== null}
        assetId={openAssetId}
        fields={fields}
        tags={tags}
        onClose={() => setOpenAssetId(null)}
        onSaved={A.onSaved}
      />
    </div>
  )
}
