import { readJson, writeJson } from './local-store'
import type { PatrolFilter, PatrolFilterTemplate } from './types'

// 当班筛选模板单独持久化：按班次隔离，同一名值班员换班后仍能取回对应模板。
const TEMPLATE_STORAGE_KEY = 'forest-fire-patrol:patrol-filter-templates'

export const EMPTY_PATROL_FILTER: PatrolFilter = {
  区域: '',
  状态: '',
  巡护员: '',
  发现火情数: '',
}

export function emptyPatrolFilter(): PatrolFilter {
  return { ...EMPTY_PATROL_FILTER }
}

export function normalizePatrolFilter(input: Partial<PatrolFilter> | undefined): PatrolFilter {
  return {
    区域: String(input?.区域 ?? '').trim(),
    状态: String(input?.状态 ?? '').trim(),
    巡护员: String(input?.巡护员 ?? '').trim(),
    发现火情数: String(input?.发现火情数 ?? '').trim(),
  }
}

// 空条件不允许存成模板：全量条件没有筛选意义，也会让「命中两个模板」失去参照。
export function hasAnyCondition(conditions: PatrolFilter): boolean {
  return Object.values(conditions).some((value) => value !== '')
}

export function listTemplates(): PatrolFilterTemplate[] {
  return readJson<PatrolFilterTemplate[]>(TEMPLATE_STORAGE_KEY, [])
}

export function listShiftTemplates(shift: string): PatrolFilterTemplate[] {
  return listTemplates()
    .filter((item) => item.shift === shift)
    .sort((a, b) => b.id - a.id)
}

function persist(templates: PatrolFilterTemplate[]): PatrolFilterTemplate[] {
  writeJson(TEMPLATE_STORAGE_KEY, templates)
  return templates
}

export function saveTemplate(input: {
  name: string
  shift: string
  conditions: PatrolFilter
}): PatrolFilterTemplate {
  const templates = listTemplates()
  const nextId = templates.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const template: PatrolFilterTemplate = {
    id: nextId,
    name: input.name.trim() || `当班模板 ${nextId}`,
    shift: input.shift,
    conditions: normalizePatrolFilter(input.conditions),
    createdAt: new Date().toISOString(),
  }
  persist([...templates, template])
  return template
}

export function deleteTemplate(id: number): void {
  persist(listTemplates().filter((item) => item.id !== id))
}

export function getTemplate(id: number): PatrolFilterTemplate | undefined {
  return listTemplates().find((item) => item.id === id)
}
