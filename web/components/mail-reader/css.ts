/** 邮件 CSS 里的危险/越界写法：@import 拉外链、expression()、behavior、fixed 定位会盖住整个应用 */
export function scrubCss(css: string, allowRemote: boolean): string {
  let out = css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'none(')
    .replace(/javascript\s*:/gi, '')
    .replace(/behavior\s*:[^;}]*;?/gi, '')
    .replace(/-moz-binding\s*:[^;}]*;?/gi, '')
    .replace(/position\s*:\s*(fixed|sticky)/gi, 'position:static')
  if (!allowRemote) out = out.replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none')
  return out
}
