import { Hono } from 'hono'
import { db } from '../db.js'
import { checkTunnel, getTunnel, setPublicUrl } from '../tunnel.js'

// 公网映射状态：读当前配置与最近一次探活结果、改地址、立即探活。
export const tunnelRoute = new Hono()

tunnelRoute.get('/', (c) => c.json(getTunnel(db)))

tunnelRoute.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { publicUrl?: string }
  try {
    setPublicUrl(db, body.publicUrl)
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 400)
  }
  return c.json(await checkTunnel(db))
})

tunnelRoute.post('/check', async (c) => c.json(await checkTunnel(db)))
