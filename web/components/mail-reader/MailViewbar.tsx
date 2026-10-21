import { Eye, EyeOff } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Button } from '../ui'

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
          title={hasHtml ? '显示 HTML 排版' : '这封邮件只有纯文本'}
        >
          HTML
        </button>
        <button type="button" className={cx('mail-seg-btn', useText && 'active')} onClick={() => onMode('text')}>
          纯文本
        </button>
      </div>
      {remote > 0 ? (
        <Button size="sm" variant="ghost" onClick={onToggleImages} title={showImages ? '不再请求发件人的图片' : '加载邮件里的远程图片'}>
          {showImages ? <EyeOff size={14} /> : <Eye size={14} />}
          {showImages ? '隐藏图片' : '显示图片（' + remote + '）'}
        </Button>
      ) : null}
    </div>
  )
}
