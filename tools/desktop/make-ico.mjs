#!/usr/bin/env node
// 把 web/public/icons/icon-512.png 包成 desktop/assets/icon.ico（给 electron-builder 当 win.icon）。
//
//   node tools/desktop/make-ico.mjs
//
// electron-builder 的 Windows 图标只认 .ico（它自己会把 png 转成 ico 需要额外装 imagemagick 之类的
// 外部工具，不能指望）。所以这里手工拼一个**单条 PNG 条目的 ICO**：Vista 之后 Windows 的 ico
// 允许条目内容直接是 PNG 字节，不需要 BMP + AND 掩码那一套老格式。
//
// 结构（全部小端）：
//   0  ICONDIR     reserved u16=0 | type u16=1(图标) | count u16=1
//   6  ICONDIRENTRY（16 字节） width u8 | height u8 | colors u8 | reserved u8 | planes u16 |
//                              bitCount u16 | bytesInRes u32 | imageOffset u32
//   22 PNG 原始字节
// width/height 写 0 = 256 及以上（ICO 的 8 位字段装不下 256 以上，规范里 0 就是这个意思）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../..', import.meta.url);
const SRC = fileURLToPath(new URL('web/public/icons/icon-512.png', ROOT));
const OUT = fileURLToPath(new URL('desktop/assets/icon.ico', ROOT));

/** png 的前 8 字节固定签名，认一下免得把一张 JPEG / 空文件包进 ico 里 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const png = readFileSync(SRC);
if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
  console.error('源文件不是 PNG：' + SRC);
  process.exit(1);
}

const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;
const IMAGE_OFFSET = HEADER_SIZE + ENTRY_SIZE; // 22

const header = Buffer.alloc(HEADER_SIZE);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(1, 4); // count = 1

const entry = Buffer.alloc(ENTRY_SIZE);
entry.writeUInt8(0, 0); // width：0 表示 256 及以上
entry.writeUInt8(0, 1); // height：同上
entry.writeUInt8(0, 2); // 调色板颜色数：真彩图为 0
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // 位深
entry.writeUInt32LE(png.length, 8); // bytesInRes
entry.writeUInt32LE(IMAGE_OFFSET, 12); // imageOffset

const ico = Buffer.concat([header, entry, png]);
mkdirSync(fileURLToPath(new URL('desktop/assets/', ROOT)), { recursive: true });
writeFileSync(OUT, ico);

console.log('icon.ico 已生成：' + OUT);
console.log('  PNG ' + png.length + ' B + ICO 头 ' + IMAGE_OFFSET + ' B = 共 ' + ico.length + ' B');
