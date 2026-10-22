import { useEffect } from 'react'
import { ChevronLeft, Inbox, Mail } from 'lucide-react'
import { Button, Empty } from '../components/ui'
import { MailReader } from '../components/MailReader'
import { MailAccountDrawer } from '../components/MailAccountDrawer'
import { MailList } from './mail/MailList'
import { MailToolbar } from './mail/MailToolbar'
import { PAGE, useInbox } from './mail/useInbox'

/**
 * 邮件页：只负责拼装。
 * 数据与交互在 ./mail/useInbox.ts，列表与分页在 ./mail/MailList.tsx，工具条在 ./mail/MailToolbar.tsx。
 * 别把状态再搬回这里——e2e（tests/e2e-mail.mjs）依赖 .mail-row / .mail-pager / .mail-search 这些结构。
 */
export function MailPage({ onSummary }: { onSummary?: (s: { unseen: number; total: number; accounts: number }) => void }) {
  const M = useInbox()

  useEffect(() => {
    onSummary?.({ unseen: M.unseen, total: M.total, accounts: M.accounts.length })
  }, [M.unseen, M.total, M.accounts.length, onSummary])

  if (M.accountsLoaded && M.accounts.length === 0) {
    return (
      <div className="mail-page mail-page-empty">
        <Empty
          icon={<Mail size={22} />}
          title="还没有添加邮箱"
          text={
            <>
              支持 Gmail / QQ / 163 等任意 IMAP 邮箱，只收信、不改变服务器上的任何状态。
              <br />
              Gmail 用「应用专用密码」，QQ 和 163 用「授权码」。
            </>
          }
          action={
            <Button variant="primary" onClick={() => M.setDrawer(true)}>
              <Mail size={14} /> 添加邮箱
            </Button>
          }
        />
        <MailAccountDrawer open={M.drawer} accounts={M.accounts} onClose={() => M.setDrawer(false)} onChanged={() => { M.fetchAccounts(true); M.fetchList(0, true) }} />
      </div>
    )
  }

  return (
    <div className="mail-page">
      <MailToolbar
        accounts={M.accounts}
        accountFilter={M.accountFilter}
        onAccountFilter={M.setAccountFilter}
        unseenTotal={M.unseenTotal}
        folders={M.folders}
        folder={M.folder}
        onFolder={M.setFolder}
        fetchedAt={M.fetchedAt}
        refreshing={M.refreshing}
        onRefresh={M.refresh}
        onOpenAccounts={() => M.setDrawer(true)}
        loadedCount={M.items.length}
        q={M.q}
        onQ={M.setQ}
        unreadOnly={M.unreadOnly}
        onUnreadOnly={M.setUnreadOnly}
      />

      {M.listError ? <div className="alert mail-alert">{M.listError}</div> : null}

      <div className={M.sel ? 'mail-body is-reading' : 'mail-body'}>
        <MailList
          listRef={M.listRef}
          visible={M.visible}
          loadedCount={M.items.length}
          loading={M.loading}
          folderName={M.folderName}
          sel={M.sel}
          onOpen={M.open}
          offset={M.offset}
          total={M.total}
          pageSize={PAGE}
          hasMore={M.hasMore}
          filtered={!!M.q || M.unreadOnly}
          onPrev={() => M.fetchList(Math.max(0, M.offset - PAGE), true)}
          onNext={() => M.fetchList(M.offset + PAGE, true)}
        />

        <section className="mail-reader-pane">
          <button className="mail-back" onClick={M.close}>
            <ChevronLeft size={16} /> 返回列表
          </button>
          {M.sel ? (
            <MailReader key={M.sel.accountId + ':' + M.sel.folder + ':' + M.sel.uid} accountId={M.sel.accountId} folder={M.sel.folder} uid={M.sel.uid} folderLabel={M.folderName} />
          ) : (
            <div className="mail-reader-empty">
              <Empty icon={<Inbox size={20} />} title="选一封邮件" text="点左边的邮件，正文就显示在这里（不会把服务器上的邮件标成已读）。" />
            </div>
          )}
        </section>
      </div>

      <MailAccountDrawer
        open={M.drawer}
        accounts={M.accounts}
        onClose={() => M.setDrawer(false)}
        onChanged={() => {
          M.fetchAccounts(true)
          M.fetchList(M.offset, true)
        }}
      />
    </div>
  )
}
