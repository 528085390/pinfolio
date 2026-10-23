import { request } from './http'

export type SessionInfo = {
  id: string; ua: string; ip: string;
  createdAt: string; lastSeenAt: string; expiresAt: string;
  current: boolean
}

export type ApiToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null }

export const authApi = {
  sessions: () => request<SessionInfo[]>('/auth/sessions'),
  revoke: (id: string) => request<{ ok: true }>('/auth/sessions/' + id, { method: 'DELETE' }),
  revokeOthers: () => request<{ ok: true }>('/auth/sessions/revoke-others', { method: 'POST', body: '{}' }),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>('/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  tokens: () => request<ApiToken[]>('/auth/tokens'),
  createToken: (name: string) =>
    request<{ id: string; name: string; token: string }>('/auth/tokens', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteToken: (id: string) => request<{ ok: true }>('/auth/tokens/' + id, { method: 'DELETE' }),
}
