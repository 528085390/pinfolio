// 从主机备注里认出「厂商 · 机房」，没有就老实返回空串（卡片上少一个徽标，别瞎猜）。
// 备注是自由文本（例如「Azure · 美中（WorkBuddy + 自建服务，2026-11-02 起）」），
// 所以只认分隔符「·」前后两段 + 少量地名关键词。

const VENDORS: Array<[RegExp, string]> = [
  [/oracle/i, 'ORACLE'],
  [/azure|microsoft/i, 'AZURE'],
  [/\baws\b|amazon/i, 'AWS'],
  [/google|\bgcp\b/i, 'GCP'],
  [/vultr/i, 'VULTR'],
  [/hetzner/i, 'HETZNER'],
  [/digitalocean/i, 'DO'],
  [/aliyun|alibaba|阿里/i, 'ALIYUN'],
  [/tencent|腾讯/i, 'TENCENT'],
  [/linode|akamai/i, 'LINODE'],
]

const FLAGS: Array<[RegExp, string]> = [
  [/东京|tokyo|日本|japan/i, '🇯🇵'],
  [/大阪|osaka/i, '🇯🇵'],
  [/俄勒冈|oregon|美中|美西|美东|美国|加州|西雅图|virginia|silicon/i, '🇺🇸'],
  [/新加坡|singapore/i, '🇸🇬'],
  [/香港|hong ?kong/i, '🇭🇰'],
  [/首尔|seoul|韩国|korea/i, '🇰🇷'],
  [/台湾|taiwan|taipei/i, '🇹🇼'],
  [/法兰克福|frankfurt|德国|germany/i, '🇩🇪'],
  [/伦敦|london|英国|england/i, '🇬🇧'],
  [/巴黎|paris|法国|france/i, '🇫🇷'],
  [/悉尼|sydney|澳大利亚|australia/i, '🇦🇺'],
  [/多伦多|toronto|加拿大|canada/i, '🇨🇦'],
  [/孟买|mumbai|印度|india/i, '🇮🇳'],
  [/圣保罗|sao ?paulo|巴西|brazil/i, '🇧🇷'],
]

/** 去掉括注（「（…）」和「(…)」都算），备注里括号通常是补充说明。 */
function stripParens(s: string): string {
  return s.replace(/[（(][^）)]*[）)]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 备注按「·」切成前后两段：前段是厂商，后段是机房/区域。 */
function splitNote(note: string): [string, string] {
  const clean = stripParens(note || '')
  const parts = clean.split(/\s*[·・|｜]\s*/).map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')]
  return [clean, '']
}

/** 厂商徽标文案（大写短名）；认不出来就空串。 */
export function hostVendor(note: string): string {
  const [head, tail] = splitNote(note)
  for (const [re, name] of VENDORS) if (re.test(head)) return name
  for (const [re, name] of VENDORS) if (re.test(tail)) return name
  return ''
}

/** 机房 / 区域文案（保留原文的「东京」「美中」）；没有就空串。 */
export function hostRegion(note: string): string {
  const [, tail] = splitNote(note)
  if (tail) return tail
  // 只有一段时（例如备注直接写「东京 · 1C1G」）把第一段当区域
  return ''
}

/** 国旗 emoji：按区域关键词猜，猜不到就空串（不显示比显示错的强）。 */
export function hostFlag(note: string): string {
  const text = stripParens(note || '')
  for (const [re, flag] of FLAGS) if (re.test(text)) return flag
  return ''
}
