import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, resolveFromRules, type ActionRecipe, type ActionStep, type Rule } from './recipe.js'

const ACTIONS_FILE = process.env.MONITOR_ACTIONS || join(process.cwd(), 'monitor-actions.json')

function loadRules(): Rule[] {
  try {
    return parseRules(JSON.parse(readFileSync(ACTIONS_FILE, 'utf8')))
  } catch {
    return []
  }
}

export function resolveAction(m: { id: number; name: string; type: string }): ActionRecipe {
  return resolveFromRules(loadRules(), m)
}

export { runRecipe, type StepResult } from './runner.js'
export type { ActionRecipe, ActionStep } from './recipe.js'
