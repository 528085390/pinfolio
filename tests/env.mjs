// 测试目标地址。**规矩：e2e 不许打真实实例**（7788 上跑的是用户的真数据）。
//
//   node tests/run.mjs        # 自己起一个隔离实例（临时数据目录，跑完删），并通过 E2E_BASE 传下来
//   单跑某个脚本时也必须自己设 E2E_BASE 指向一个隔离实例，没设就直接退出——宁可跑不起来，
//   也不要把测试便签/资产写进真库。
const raw = process.env.E2E_BASE || process.env.MAIL_E2E_BASE
if (!raw) {
  console.error('[test] 没设 E2E_BASE：测试数据禁止写进真实库。')
  console.error('[test]   整跑：node tests/run.mjs（自动起隔离实例）')
  console.error('[test]   单跑：先起一个隔离实例，再 E2E_BASE=http://127.0.0.1:<端口> node tests/<脚本>.mjs')
  process.exit(2)
}

export const BASE = raw.replace(/\/+$/, '')
export const API = BASE + '/api'
