/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

// 列表取数的可选参数：不传时保持「不分页、模糊包含」的旧口径。
export type ListOptions = {
  page?: number
  size?: number
  // 这些字段走精确匹配（如任务状态、发现火情数），其余字段仍按包含匹配。
  exact?: string[]
}

// 巡护任务页的当班筛选模板：criteria 的键与列表筛选条件一致（含 status）。
export type FilterTemplate = {
  id: string
  name: string
  shift: string
  createdAt: number
  criteria: Record<string, string>
}

// 巡护任务派生出值勤班次后的回执：created/skipped 用于说明去重结果。
export type ShiftCreateResult = {
  ok: boolean
  message: string
  created: number
  skipped: number
  codes: string[]
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
