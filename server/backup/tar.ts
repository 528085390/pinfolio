// 极简 ustar 读写：只为了把几个文件打成一个 tar.gz，不引第三方依赖。
// 支持普通文件（typeflag '0'），路径长度 <= 100（备份包里的名字都很短）。

export type TarEntry = { name: string; data: Buffer; mtime?: Date; mode?: number }

const BLOCK = 512

function octal(n: number, width: number): string {
  const s = Math.max(0, Math.floor(n)).toString(8)
  return s.padStart(width - 1, '0') + '\0'
}

function header(e: TarEntry): Buffer {
  const h = Buffer.alloc(BLOCK, 0)
  const name = Buffer.from(e.name, 'utf8')
  if (name.length > 100) throw new Error('tar 路径太长: ' + e.name)
  name.copy(h, 0)
  h.write(octal(e.mode ?? 0o644, 8), 100, 'latin1')
  h.write(octal(0, 8), 108, 'latin1')
  h.write(octal(0, 8), 116, 'latin1')
  h.write(octal(e.data.length, 12), 124, 'latin1')
  const mtime = Math.floor((e.mtime ?? new Date()).getTime() / 1000)
  h.write(octal(mtime, 12), 136, 'latin1')
  h.write('        ', 148, 'latin1') // 校验和先填空格
  h.write('0', 156, 'latin1')
  h.write('ustar\0', 257, 'latin1')
  h.write('00', 263, 'latin1')
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += h[i]
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1')
  return h
}

export function createTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    parts.push(header(e))
    parts.push(e.data)
    const rest = e.data.length % BLOCK
    if (rest) parts.push(Buffer.alloc(BLOCK - rest, 0))
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0))
  return Buffer.concat(parts)
}

function readString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

function readOctal(buf: Buffer, start: number, len: number): number {
  const s = readString(buf, start, len).trim()
  return s ? parseInt(s, 8) : 0
}

export function readTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = []
  let off = 0
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK)
    if (h.every((b) => b === 0)) break
    const name = readString(h, 0, 100)
    const size = readOctal(h, 124, 12)
    const mtime = readOctal(h, 136, 12)
    const type = String.fromCharCode(h[156])
    const dataStart = off + BLOCK
    const data = buf.subarray(dataStart, dataStart + size)
    if (type === '0' || type === '\0') out.push({ name, data: Buffer.from(data), mtime: new Date(mtime * 1000) })
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK
  }
  return out
}
