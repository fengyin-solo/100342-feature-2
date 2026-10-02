import { SEED_ROWS } from './seed'
import type { EntryRow, FilterTemplate } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'
// 巡护任务页的当班筛选模板单独存一份，不和业务条目混在一起。
const TEMPLATE_STORAGE_KEY = 'forest-fire-patrol:patrol-filter-templates'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// —— 当班筛选模板 ——

let templateCache: FilterTemplate[] | null = null

function readTemplates(): FilterTemplate[] {
  if (templateCache !== null) {
    return templateCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    templateCache = []
    return templateCache
  }
  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY)
    templateCache = raw ? (JSON.parse(raw) as FilterTemplate[]) : []
  } catch {
    templateCache = []
  }
  return templateCache
}

function writeTemplates(templates: FilterTemplate[]): void {
  templateCache = templates
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates))
  }
}

export function listTemplates(shift?: string): FilterTemplate[] {
  const templates = readTemplates()
  return shift ? templates.filter((item) => item.shift === shift) : templates
}

export function saveTemplate(template: FilterTemplate): FilterTemplate[] {
  const templates = readTemplates()
  // 同一当班、同一模板名视为覆盖更新，避免同名模板越存越多。
  const index = templates.findIndex(
    (item) => item.shift === template.shift && item.name === template.name,
  )
  if (index >= 0) {
    templates[index] = template
  } else {
    templates.push(template)
  }
  writeTemplates(templates)
  return templates.filter((item) => item.shift === template.shift)
}

export function removeTemplate(id: string, shift?: string): FilterTemplate[] {
  const templates = readTemplates().filter((item) => item.id !== id)
  writeTemplates(templates)
  return templates.filter((item) => item.shift === shift)
}
