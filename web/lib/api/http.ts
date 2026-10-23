/** 所有 API 请求的出口：统一拼 /api 前缀、自动带 JSON 头、把后端的 error 文案抛成 Error。 */
export const UNAUTHORIZED_EVENT = 'pb:unauthorized'

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, { ...init, headers: { ...headers, ...(init?.headers as any) } })
  if (!res.ok) {
    // 会话过期 / 被踢下线：通知外壳切回登录页
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    let msg = res.status + ' ' + res.statusText
    try {
      const j: any = await res.json()
      if (j && j.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  return (await res.json()) as T
}
