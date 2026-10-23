/**
 * 应用挂载前缀。构建时由 Vite 的 BASE_URL 决定；
 * 同一个构建通过反代挂到别的子路径时（例如把本机实例映射到 https://host/pinfolio/），
 * 由 index.html 里注入的 window.__PB_BASE__ 覆盖。
 */
declare global {
  interface Window {
    __PB_BASE__?: string
  }
}

export const BASE: string =
  (typeof window !== 'undefined' && window.__PB_BASE__) || import.meta.env.BASE_URL || '/'
