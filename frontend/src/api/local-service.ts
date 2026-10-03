import { MODULE_BY_KEY } from '@/data/modules'
import { getTemplate, listTemplates } from '@/data/patrol-templates'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DutySyncResult,
  EntryRow,
  ListOptions,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PatrolFilter,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 组合条件里的「状态」直接对记录的流转状态列取值，和表格里的「当前状态」同源。
const FIELD_ALIASES: Record<string, string> = {
  状态: 'status',
}

// 发现火情数是计数列：按数值精确匹配，避免「1」误命中「10」这类子串问题。
const EXACT_NUMBER_FIELDS = new Set(['发现火情数'])

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function matchField(row: EntryRow, field: string, keyword: string): boolean {
  const column = FIELD_ALIASES[field] ?? field
  const raw = String(row[column] ?? '')
  if (EXACT_NUMBER_FIELDS.has(field) && keyword !== '' && Number.isFinite(Number(keyword))) {
    return Number(raw) === Number(keyword)
  }
  return raw.includes(keyword)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => matchField(row, field, value.trim())),
  )
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  options: ListOptions = {},
): PageResult {
  const matched = filterRows(listRows(key), filters)
  const size = options.size ?? 0
  // 不传分页时维持旧口径：整页返回，page/size 照旧给出全量长度，旧页面无需改动。
  if (!size || size <= 0) {
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const lastPage = Math.max(1, Math.ceil(matched.length / size))
  // 翻页越界（筛完变少、删数据等）统一夹回有效页，调用方拿返回的 page 回写即可。
  const page = Math.min(Math.max(1, options.page ?? 1), lastPage)
  const start = (page - 1) * size
  return { items: matched.slice(start, start + size), total: matched.length, page, size }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// —— 巡护任务：当班筛选模板与值勤班次联动 ——

const PATROL_KEY = 'patrol'
const DUTY_KEY = 'duty'

// 模板条件到巡护记录列的映射；状态直接取流转状态，和列表「当前状态」一列同源。
const PATROL_CONDITION_FIELDS: Record<keyof PatrolFilter, string> = {
  区域: '巡护区域',
  状态: 'status',
  巡护员: '巡护员',
  发现火情数: '发现火情数',
}

function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function filterPatrolRows(conditions: PatrolFilter): EntryRow[] {
  const filters: Record<string, string> = {}
  for (const [condition, column] of Object.entries(PATROL_CONDITION_FIELDS)) {
    const value = conditions[condition as keyof typeof conditions]?.trim()
    if (value) {
      filters[column] = value
    }
  }
  return filterRows(listRows(PATROL_KEY), filters)
}

export function patrolsByTemplate(templateId: number): EntryRow[] {
  const template = getTemplate(templateId)
  return template ? filterPatrolRows(template.conditions) : []
}

// 当前班次下所有模板命中的巡护任务并集；同一任务被两个模板命中只保留一份。
export function patrolsMatchedByShift(shift: string): EntryRow[] {
  const unique = new Map<number, EntryRow>()
  for (const template of listTemplates().filter((item) => item.shift === shift)) {
    for (const row of filterPatrolRows(template.conditions)) {
      unique.set(Number(row.id), row)
    }
  }
  return [...unique.values()]
}

// 把选中的巡护任务排入值勤班表。按巡护任务编号幂等去重，重复选中或二次生成都只留一份。
export function addDutyForPatrols(patrolIds: number[], shift: string): DutySyncResult {
  const patrolRows = listRows(PATROL_KEY)
  const dutyRows = listRows(DUTY_KEY)
  const linked = new Set(
    dutyRows.map((row) => String(row['关联巡护任务'] ?? '')).filter((code) => code !== ''),
  )
  let nextId = dutyRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const created: EntryRow[] = []
  const dutyIds: number[] = []
  let skipped = 0

  for (const patrolId of patrolIds) {
    const task = patrolRows.find((row) => Number(row.id) === Number(patrolId))
    if (!task) {
      continue
    }
    const taskCode = String(task['任务编号'] ?? `PATR-${patrolId}`)
    if (linked.has(taskCode)) {
      skipped += 1
      continue
    }
    linked.add(taskCode)
    nextId += 1
    dutyIds.push(nextId)
    created.push({
      id: nextId,
      status: '待确认',
      pending: true,
      abnormal: false,
      排班编号: `DUTY-${String(nextId).padStart(4, '0')}`,
      值勤日期: todayText(),
      值勤时段: shift,
      值勤岗位: String(task['巡护区域'] ?? ''),
      值勤人员: String(task['巡护员'] ?? ''),
      接班人员: '待安排',
      交接记录: `由巡护任务 ${taskCode} 排入`,
      排班状态: '',
      关联巡护任务: taskCode,
    })
  }

  if (created.length > 0) {
    saveRows(DUTY_KEY, [...dutyRows, ...created])
  }
  return { added: created.length, skipped, dutyIds }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
