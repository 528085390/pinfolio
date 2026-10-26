import { Hono } from 'hono'
import { loadServices } from './store.js'

// 服务栏：只读。GET /api/services 把 data/services.json 解析后整份返回，
// 前端两种视角（按服务器 / 按服务）都在本地聚合，服务端不做任何过滤与探测。
export const servicesRoute = new Hono()

servicesRoute.get('/', (c) => c.json(loadServices()))
