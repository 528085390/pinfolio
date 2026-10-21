/**
 * 观测台 HTTP 面的两个小工具：都是纯函数，放这里是为了能单测。
 */

/** 写接口只收 application/json：跨站表单只能发 text/plain，这样能挡掉 CSRF。 */
export function isJsonContentType(ct: string | null | undefined): boolean {
  return String(ct || '').toLowerCase().includes('application/json')
}

/**
 * Kuma 的错误映射成 HTTP 状态。
 * 注意 `getMonitor` 对不存在的 id 不返回 ok:false，而是抛 TypeError（reading 'id'），
 * 所以除了 code === 'notfound'，还要按消息文本兜底判 404，否则前端看到的是 502。
 */
export function kumaErrorStatus(e: any): 404 | 502 {
  const msg = String(e?.message || '')
  if (e?.code === 'notfound' || /not found|Cannot read properties of null/i.test(msg)) return 404
  return 502
}
