/** 所有 API 请求的出口：统一拼 /api 前缀、自动带 JSON 头、把后端的 error 文案抛成 Error。 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, { ...init, headers: { ...headers, ...(init?.headers as any) } })
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText
    try {
      const j: any = await res.json()
      if (j && j.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  return (await res.json()) as T
}
