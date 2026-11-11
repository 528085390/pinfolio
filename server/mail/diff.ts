// 邮件增量差异的三路纯函数（2026-11-12 v2）。
// 单独成文件的原因：sync.ts 一 import 就会打开数据库，单测没法只测这点逻辑。
// 口径（有单测 tests/unit/mail-diff.test.mts）：
//   1. 本地少、服务器有 → 需要 FETCH（added）；
//   2. 本地有、服务器没了 → 删除（removed）；
//   3. uid 都在但未读标记变了 → 只回写变了的那几行（flagChanges）。

export type UidFlag = { uid: number; unread: number }

/** 该补哪些、该删哪些。两边顺序不影响结果，掉重复。 */
export function diffUids(local: number[], remote: number[]): { added: number[]; removed: number[] } {
  const have = new Set(local)
  const now = new Set(remote)
  // 两边都去重：撤回重发会撞号，同一 UID 在一次 SEARCH 里出现两遍时不能重复入库 / 重复上报。
  const added: number[] = []
  for (const u of now) if (!have.has(u)) added.push(u)
  const removed: number[] = []
  for (const u of have) if (!now.has(u)) removed.push(u)
  return { added, removed }
}

/** 未读标记的变化：只返回库里那份与服务器不一致的行 */
export function flagChanges(local: UidFlag[], unseen: Set<number>): UidFlag[] {
  const out: UidFlag[] = []
  for (const r of local) {
    const want = unseen.has(r.uid) ? 1 : 0
    if (Number(r.unread) !== want) out.push({ uid: r.uid, unread: want })
  }
  return out
}

/** 新信抓取顺序：UID 从大到小（先落最近的，首次全量同步中途被打断也能看到新信） */
export function fetchOrder(added: number[]): number[] {
  return added.slice().sort((x, y) => y - x)
}