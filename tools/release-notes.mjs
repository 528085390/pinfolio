// 从 CHANGELOG.md 抽出某个版本的段落，给 GitHub Release 当正文。
// 用法：node tools/release-notes.mjs v0.2.0 > notes.md
// 抽不到就 exit 1——宁可让 release workflow 红，也不要发一个正文空白的 Release。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function extractSection(text, tag) {
  const version = String(tag || '').replace(/^v/, '').trim();
  if (!version) return null;
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes('[' + version + ']'));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const tag = process.argv[2];
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const body = extractSection(text, tag);
  if (!body) {
    console.error('CHANGELOG.md 里没有 [' + (tag || '').replace(/^v/, '') + '] 这一段，先在 CHANGELOG 里补上再发版。');
    process.exit(1);
  }
  console.log(body);
}
