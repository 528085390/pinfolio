import { API_BASE, UNAUTHORIZED_EVENT } from './http'

export type UploadedImage = { id: number; url: string; mime: string; bytes: number; name: string }

/**
 * 上传一张图：请求体就是图片二进制，Content-Type 用图片类型。
 * **不能走 request()** —— 那个函数会把 Content-Type 强改成 application/json（服务端靠 image/* 放行，见 auth/middleware.ts）。
 */
async function upload(file: Blob, name?: string): Promise<UploadedImage> {
  const qs = new URLSearchParams()
  if (name) qs.set('name', name)
  const q = qs.toString()
  const res = await fetch(API_BASE + '/attachments' + (q ? '?' + q : ''), {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    let msg = res.status + ' ' + res.statusText
    try {
      const j: any = await res.json()
      if (j && j.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  return (await res.json()) as UploadedImage
}

export const attachmentsApi = {
  upload,
  /** 直接取图的地址（正文里用相对路径 /api/attachments/<id>，渲染时再按部署前缀重写） */
  url: (id: number) => API_BASE + '/attachments/' + id,
}
