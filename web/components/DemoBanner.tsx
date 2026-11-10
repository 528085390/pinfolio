import { ExternalLink } from 'lucide-react'
import { useDemo } from '../lib/demo'
import { t } from '../lib/i18n'

// 演示站横幅：只有 /api/auth/state 带回 demo 字段才渲染。
// 普通实例不显示，也不占高度（.demo-banner 在 .main 里是 flex: none 的一条）。
export function DemoBanner() {
  const demo = useDemo()
  if (!demo) return null
  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner-tag">{t('演示站')}</span>
      <span className="demo-banner-text">
        {t('这是 pinfolio 的公开演示，数据都是示例；每天{reset}自动重置，改动不会保留。', { reset: demo.reset })}
      </span>
      <a className="demo-banner-link" href={demo.repo} target="_blank" rel="noreferrer">
        {t('源码')}
        <ExternalLink size={12} />
      </a>
    </div>
  )
}
