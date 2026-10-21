import { Paperclip } from 'lucide-react'
import type { MailAttachment } from '../../lib/api'
import { bytes } from './text'

/** 附件列表：点一下直接下载（走后端 /mail/attachment，只读 FETCH） */
export function MailAttachments({ attachments, attUrl }: {
  attachments: MailAttachment[]
  attUrl: (index: number) => string
}) {
  if (!attachments.length) return null
  return (
    <div className="mail-attach">
      <div className="mail-attach-title">
        <Paperclip size={13} /> 附件 {attachments.length} 个
      </div>
      <div className="mail-attach-list">
        {attachments.map((a) => (
          <a key={a.index} className="mail-attach-item" href={attUrl(a.index)} download={a.filename}>
            <span className="mail-attach-name">{a.filename}</span>
            <span className="mail-attach-size">{bytes(a.size)}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
