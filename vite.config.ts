import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 部署在子路径（如 nginx 的 /pinfolio/）时用 PINBOARD_BASE=pinfolio 构建；默认根路径。
// 允许写成 /pinfolio/ 或 pinfolio，统一归一成「前后各一个斜杠」。
const rawBase = (process.env.PINBOARD_BASE || '').replace(/^\/+|\/+$/g, '')
const base = rawBase ? '/' + rawBase + '/' : '/'

export default defineConfig({
  root: 'web',
  base,
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5273,
    proxy: { '/api': 'http://127.0.0.1:7788' },
  },
})
