import test from 'node:test'
import assert from 'node:assert/strict'
import { PATHS, TITLES, pageFromPath, pathForPage } from '../../web/lib/paths.js'

test('pageFromPath：五个页面', () => {
  assert.equal(pageFromPath('/notes'), 'notes')
  assert.equal(pageFromPath('/mail'), 'mail')
  assert.equal(pageFromPath('/assets'), 'assets')
  assert.equal(pageFromPath('/monitors'), 'monitors')
  assert.equal(pageFromPath('/settings'), 'settings')
})

test('pageFromPath：尾斜杠与大小写都归一', () => {
  assert.equal(pageFromPath('/mail/'), 'mail')
  assert.equal(pageFromPath('/assets//'), 'assets')
  assert.equal(pageFromPath('/MAIL'), 'mail')
  // 双斜杠开头不是浏览器会给的形态，落到便签页即可（实测行为，别改成猜的）
  assert.equal(pageFromPath('//assets//'), 'notes')
})

test('pageFromPath：根路径和未知路径回便签页', () => {
  assert.equal(pageFromPath('/'), 'notes')
  assert.equal(pageFromPath(''), 'notes')
  assert.equal(pageFromPath('/nope'), 'notes')
})

test('pathForPage：每个页面都有规范路径', () => {
  for (const page of Object.keys(PATHS)) {
    assert.equal(pathForPage(page as keyof typeof PATHS), '/' + page)
  }
  assert.equal(pathForPage('notes'), '/notes')
})

test('PATHS / TITLES：键集合一致', () => {
  assert.deepEqual(Object.keys(PATHS).sort(), Object.keys(TITLES).sort())
  assert.equal(TITLES.monitors, '观测台')
})
