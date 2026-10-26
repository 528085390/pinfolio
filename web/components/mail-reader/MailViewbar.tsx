import { Eye, EyeOff } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Button } from '../ui'
import { t } from '../../lib/i18n'

/** HTML / 纯文本切换 + 「隐藏图片 / 显示图片（N）」——只有真有远程图片时才出后一个按钮 */
export function MailViewbar({ useText, hasHtml, onMode, remote, showImages, onToggleImages }: {
  useText: boolean
  hasHtml: boolean
  onMode: (mode: 'html' | 'text') => void
  remote: number
  showImages: boolean
  onToggleImages: () => void
}) {
  return (
    <div className="mail-viewbar">
      <div className="mail-seg">
        <button
          type="button"
          className={cx('mail-seg-btn', !useText && 'active')}
          onClick={() => onMode('html')}
          disabled={!hasHtml}
          title={hasHtml ? t('显示 HTML 排版') : t('这封邮件只有纯文本')}
        >
          HTML
        </button>
        <button type="button" className={cx('mail-seg-btn', useText && 'active')} onClick={() => onMode('text')}>
          {t('纯文本')}
        </button>
      </div>
      {remote > 0 ? (
        <Button size="sm" variant="ghost" onClick={onToggleImages} title={showImages ? t('不再请求发件人的图片') : t('加载邮件里的远程图片')}>
          {showImages ? <EyeOff size={14} /> : <Eye size={14} />}
          {showImages ? t('隐藏图片') : t('显示图片（{n}）', { n: remote })}
        </Button>
      ) : null}
    </div>
  )
}
