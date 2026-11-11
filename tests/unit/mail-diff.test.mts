import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffUids, fetchOrder, flagChanges } from '../../server/mail/diff.ts'

// 邮件增量同步的三路差异（2026-11-12 v2）：本地库 vs 服务器 UID 列表。
// 这三条口径错了会直接表现为「新信不出现」「删掉的信还在」「未读数对不上」。

test('diffUids：服务器多了新信 → 只补这些', () => {
  const r = diffUids([1, 2, 3], [1, 2, 3, 4, 5])
  assert.deepEqual(r.added, [4, 5])
  assert.deepEqual(r.removed, [])
})

test('diffUids：服务器删了信 → 只删这些', () => {
  const r = diffUids([1, 2, 3], [1, 3])
  assert.deepEqual(r.added, [])
  assert.deepEqual(r.removed, [2])
})

test('diffUids：一边增一边删同时发生', () => {
  const r = diffUids([1, 2, 3], [2, 3, 9])
  assert.deepEqual(r.added, [9])
  assert.deepEqual(r.removed, [1])
})

test('diffUids：完全一致时什么都不做（增量同步的稳态，一次 FETCH 都不该发生）', () => {
  const r = diffUids([5, 6, 7], [7, 5, 6])
  assert.equal(r.added.length, 0)
  assert.equal(r.removed.length, 0)
})

test('diffUids：本地空库 → 全部要补；服务器空了 → 全部要删', () => {
  assert.deepEqual(diffUids([], [1, 2]).added, [1, 2])
  assert.deepEqual(diffUids([1, 2], []).removed, [1, 2])
})

test('diffUids：重复 uid 不该重复补（撤回重发会撞号）', () => {
  const r = diffUids([1], [1, 2, 2])
  assert.deepEqual(r.added, [2])
})

test('flagChanges：只回写真正变了的那几行', () => {
  const local = [
    { uid: 1, unread: 1 },
    { uid: 2, unread: 0 },
    { uid: 3, unread: 1 },
  ]
  const changes = flagChanges(local, new Set([1, 2]))
  // 1 本来未读 → 不变；2 服务器未读但库里是已读 → 改；3 服务器已读但库里未读 → 改
  assert.deepEqual(changes, [
    { uid: 2, unread: 1 },
    { uid: 3, unread: 0 },
  ])
})

test('flagChanges：一致时返回空数组（稳态不写库）', () => {
  const local = [{ uid: 1, unread: 1 }, { uid: 2, unread: 0 }]
  assert.deepEqual(flagChanges(local, new Set([1])), [])
})

test('fetchOrder：新信按 UID 从大到小抓，先落最近的', () => {
  assert.deepEqual(fetchOrder([3, 1, 2]), [3, 2, 1])
  assert.deepEqual(fetchOrder([]), [])
})