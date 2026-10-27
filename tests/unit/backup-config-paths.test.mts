import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveConfigPaths } from '../../server/backup/config-paths.js'

/** 造两个临时目录当 dataDir / cwd，测试结束删干净 */
function withDirs(fn: (dirs: { dataDir: string; cwd: string }) => void) {
  const root = mkdtempSync(join(tmpdir(), 'pinfolio-cfg-'))
  const dirs = { dataDir: join(root, 'data'), cwd: join(root, 'cwd') }
  mkdirSync(dirs.dataDir, { recursive: true })
  mkdirSync(dirs.cwd, { recursive: true })
  try {
    fn(dirs)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('配置路径：数据目录优先、cwd 兜底、缺失跳过，顺序跟着 names 走', () => {
  withDirs(({ dataDir, cwd }) => {
    writeFileSync(join(dataDir, 'quick-links.json'), '{"data":true}')
    writeFileSync(join(cwd, 'monitor-links.json'), '{"cwd":true}')

    const out = resolveConfigPaths(['quick-links.json', 'monitor-links.json', 'nope.json'], { dataDir, cwd })

    assert.deepEqual(out, [join(dataDir, 'quick-links.json'), join(cwd, 'monitor-links.json')])
    // 顺序与 names 一致：第一条是 quick-links，第二条才是 monitor-links
    assert.ok(out[0].endsWith('quick-links.json'))
    assert.ok(out[1].endsWith('monitor-links.json'))
    // 都是绝对路径
    assert.ok(out.every((p) => isAbsolute(p)))
    // quick-links 落在数据目录（不是 cwd）
    assert.equal(dirname(out[0]), dataDir)
  })
})

test('配置路径：同名两份都在时数据目录那份胜出，只返回一条', () => {
  withDirs(({ dataDir, cwd }) => {
    writeFileSync(join(dataDir, 'quick-links.json'), '{"from":"data"}')
    writeFileSync(join(cwd, 'quick-links.json'), '{"from":"cwd"}')

    const out = resolveConfigPaths(['quick-links.json'], { dataDir, cwd })

    assert.equal(out.length, 1)
    assert.deepEqual(out, [join(dataDir, 'quick-links.json')])
  })
})

test('配置路径：cwd 里那份只在该名字数据目录没有时才用', () => {
  withDirs(({ dataDir, cwd }) => {
    writeFileSync(join(cwd, 'host-services.json'), '{"from":"cwd"}')
    writeFileSync(join(cwd, 'monitor-actions.json'), '[]')

    const out = resolveConfigPaths(['host-services.json', 'monitor-actions.json'], { dataDir, cwd })

    assert.deepEqual(out, [join(cwd, 'host-services.json'), join(cwd, 'monitor-actions.json')])
  })
})

test('配置路径：目录 / 不存在的名字都不算，空输入给空数组', () => {
  withDirs(({ dataDir, cwd }) => {
    // 同名但是个目录，不能当文件收
    mkdirSync(join(dataDir, 'quick-links.json'))

    assert.deepEqual(resolveConfigPaths(['quick-links.json'], { dataDir, cwd }), [])
    assert.deepEqual(resolveConfigPaths([], { dataDir, cwd }), [])
  })
})

test('配置路径是纯函数：不读 PINBOARD_DATA，同样的入参给同样的结果', () => {
  withDirs(({ dataDir, cwd }) => {
    writeFileSync(join(dataDir, 'quick-links.json'), '{}')
    const saved = process.env.PINBOARD_DATA
    try {
      process.env.PINBOARD_DATA = join(cwd, 'elsewhere')
      assert.deepEqual(resolveConfigPaths(['quick-links.json'], { dataDir, cwd }), [join(dataDir, 'quick-links.json')])
    } finally {
      if (saved === undefined) delete process.env.PINBOARD_DATA
      else process.env.PINBOARD_DATA = saved
    }
  })
})
