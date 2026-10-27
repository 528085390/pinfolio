// API 客户端门面：实现按领域拆在 api/ 下，这里只做聚合和类型再导出，
// 所以页面里一直写 `import { api, cx, type Note } from '../lib/api'` 不用改。
import { coreApi, tagsApi, fieldsApi } from './api/core'
import { notesApi } from './api/notes'
import { attachmentsApi } from './api/attachments'
import { assetsApi } from './api/assets'
import { monitorsApi } from './api/monitors'
import { hostsApi } from './api/hosts'
import { servicesApi } from './api/services'
import { mailApi } from './api/mail'
import { authApi } from './api/auth'
import { tunnelApi } from './api/tunnel'
import { outboundApi } from './api/outbound'
import { backupApi } from './api/backup'
import { cx } from './cx'

export const api = {
  ...coreApi,
  notes: notesApi,
  attachments: attachmentsApi,
  assets: assetsApi,
  monitors: monitorsApi,
  hosts: hostsApi,
  services: servicesApi,
  mail: mailApi,
  auth: authApi,
  tunnel: tunnelApi,
  outbound: outboundApi,
  backup: backupApi,
  tags: tagsApi,
  fields: fieldsApi,
}

export { cx }
export { request } from './api/http'

export type { Tag, FieldDef, Stats } from './api/types'
export type { SessionInfo, ApiToken } from './api/auth'
export type { TunnelStatus } from './api/tunnel'
export type { OutboundCfg, OutboundMode, OutboundPayload, OutboundSaveResult, ProxyProtocol, ProxyView } from './api/outbound'
export type {
  DeployKind, DeployRec, ServerRec, ServiceRec, ServicesPayload,
  ServerInput, ServiceInput, DeployInput,
} from './api/services'
export type { BackupStatus, BackupState, LocalFile, RemoteRow, RemoteConfigView, RemoteInput, Manifest } from './api/backup'
export type { Note } from './api/notes'
export type { UploadedImage } from './api/attachments'
export type { Asset } from './api/assets'
export type {
  Host, HostDisk, HostTop, HostSeriesPoint, HostsPayload, HostSummary,
  HostInput, HostPatch, HostServiceInput, HostOnboard, UnitMonitor, ProvisionResult,
} from './api/hosts'
export type {
  Monitor, MonitorGroup, MonitorSummary, MonitorsPayload, MonitorBeat, QuickLink,
  MonitorAction, MonitorActionStep, MonitorActionStepResult, MonitorDetail, KumaMeta, KumaFlavor,
} from './api/monitors'
export type {
  MailSecurity, MailAccount, MailAddr, MailRow, MailAccountError, MailListResult,
  MailAttachment, MailMessage, MailFolder, MailTestResult,
} from './api/mail'
