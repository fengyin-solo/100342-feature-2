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

// 巡护任务的组合定位条件：区域、状态、巡护员、发现火情数。
export type PatrolFilter = {
  区域: string
  状态: string
  巡护员: string
  发现火情数: string
}

// 当班筛选模板：把一组常用条件绑到某个班次上，换班后各取各的。
export type PatrolFilterTemplate = {
  id: number
  name: string
  shift: string
  conditions: PatrolFilter
  createdAt: string
}

export type DutySyncResult = {
  added: number
  skipped: number
  dutyIds: number[]
}

// 取数选项：翻页从这里走，page 越界由服务层夹回有效页。
export type ListOptions = {
  page?: number
  size?: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
