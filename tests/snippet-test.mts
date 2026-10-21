
import { snippetFromText } from '../server/mail/client.ts'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const s = (x: string) => snippetFromText(Buffer.from(x, 'utf8'))

// 被 maxLength 截断的半截注释（真实 Gmail 邮件里出现过）
const a = s('掌控您的账号数据 a@b.com 这封邮件总结了您共享的信息。目前，您无需采取任何措施。 <!--[if')
console.log('1:', JSON.stringify(a))
ok(!a.includes('<!--') && !a.includes('[if'), 'unterminated trailing comment removed')
ok(a.includes('这封邮件总结了您共享的信息'), 'text before comment kept')

// 完整注释 + 半截注释混排
const b = s('前 <!--[if mso]>x<![endif]--> 中 <!--[if gte mso 9]> 后')
console.log('2:', JSON.stringify(b))
ok(!b.includes('<!--') && !b.includes('中') === false, 'mixed comments handled')

// 零宽/组合字符占位
const c = s('Your list: a \u034f\u034f\u034f\u200b b \ufeffc')
console.log('3:', JSON.stringify(c))
ok(!/[\u034f\u200b\ufeff]/.test(c), 'invisible padding chars stripped')
ok(c.includes('Your list') && c.includes('b c'), 'words kept')

// 回归：上一轮的用例
const d = s('[image: Google] 已创建应用专用密码，5 < 6 元')
console.log('4:', JSON.stringify(d))
ok(!d.includes('[image'), 'still strips [image: ...]')
ok(d.includes('5 < 6 元'), 'still keeps "<" text')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
