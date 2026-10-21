import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, resolveFromRules, type ActionRecipe, type ActionStep, type Rule } from './recipe.js'

// 「立即观测」= 配方（recipe）+ 步骤（step）。配方放在 pinboard 根目录的
// monitor-actions.json 里，**每次请求热读**（改完不用重启），可进 git；加观测项不用改代码。
// 这个文件只管「读配置 + 挑配方」，纯逻辑在 recipe.ts，执行在 runner.ts。
const ACTIONS_FILE = process.env.MONITOR_ACTIONS || join(process.cwd(), 'monitor-actions.json')

function loadRules(): Rule[] {
  try {
    return parseRules(JSON.parse(readFileSync(ACTIONS_FILE, 'utf8')))
  } catch {
    return [] // 没配置 / 写坏了都当没配方，不影响观测页
  }
}

/** 先按 id 再按名字找配方（改名不会悄悄换掉动作）。 */
export function resolveAction(m: { id: number; name: string; type: string }): ActionRecipe {
  return resolveFromRules(loadRules(), m)
}

export { runRecipe, type StepResult } from './runner.js'
export type { ActionRecipe, ActionStep } from './recipe.js'
