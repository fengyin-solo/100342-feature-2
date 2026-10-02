import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  listTemplates,
  removeTemplate,
  resetRows,
  saveRows,
  saveTemplate,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FilterTemplate,
  ListOptions,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ShiftCreateResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(
  rows: EntryRow[],
  filters: Record<string, string>,
  exact: string[] = [],
): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, raw]) => {
      const value = raw.trim()
      const actual = String(row[field] ?? '')
      // exact 名单内的字段按精确相等比较（任务状态、发现火情数等），
      // 其余字段保持「包含」口径，兼容各页面旧筛选。
      return exact.includes(field) ? actual === value : actual.includes(value)
    }),
  )
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  options: ListOptions = {},
): PageResult {
  const matched = filterRows(listRows(key), filters, options.exact)
  const total = matched.length
  const size = options.size ?? total
  // size<=0（旧调用、无数据）时保持「一页全给」的旧口径。
  if (size <= 0) {
    return { items: matched, total, page: 1, size: total }
  }
  const pageCount = Math.max(1, Math.ceil(total / size))
  // 翻页越界（筛选后结果变少、直接改页码等）一律夹回最后一个有效页，不返回空页。
  const requested = Number.isFinite(options.page) ? Number(options.page) : 1
  const page = Math.min(Math.max(1, Math.trunc(requested)), pageCount)
  const start = (page - 1) * size
  return { items: matched.slice(start, start + size), total, page, size }
}

// —— 巡护任务：当班筛选模板 ——

export function getPatrolTemplates(shift?: string): FilterTemplate[] {
  return listTemplates(shift)
}

export function savePatrolTemplate(
  name: string,
  shift: string,
  criteria: Record<string, string>,
): FilterTemplate[] {
  const trimmedName = name.trim()
  if (!trimmedName) {
    throw new Error('模板名称不能为空')
  }
  const template: FilterTemplate = {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    shift,
    createdAt: Date.now(),
    // 空条件不入库，保证模板还原出来就是干净的组合条件。
    criteria: Object.fromEntries(
      Object.entries(criteria).filter(([, value]) => value.trim() !== ''),
    ),
  }
  return saveTemplate(template)
}

export function deletePatrolTemplate(id: string, shift?: string): FilterTemplate[] {
  return removeTemplate(id, shift)
}

/**
 * 模板与手工条件合并：手工已填的条件以手工为准，模板只回填空缺条件。
 * 即两套口径冲突时不覆盖值班员手输的内容。
 */
export function mergeTemplateCriteria(
  manual: Record<string, string>,
  templateCriteria: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...templateCriteria, ...manual }
  for (const [key, value] of Object.entries(merged)) {
    if (value.trim() === '') {
      delete merged[key]
    }
  }
  return merged
}

// —— 巡护任务 → 值勤排班：跨模块新增值勤班次 ——

const DUTY_KEY = 'duty'
const PATROL_KEY = 'patrol'
// 由巡护任务派生的值勤班次，在交接记录里留这个溯源标记，同时充当去重键。
const DUTY_SOURCE_PREFIX = '由巡护任务 '
const DUTY_STATUS_PENDING = '待确认'

function dutySourceTag(patrolId: number): string {
  return `${DUTY_SOURCE_PREFIX}${patrolId} 派生`
}

export function dutyLinkedPatrolIds(): Set<number> {
  const linked = new Set<number>()
  for (const row of listRows(DUTY_KEY)) {
    const note = String(row['交接记录'] ?? '')
    if (note.startsWith(DUTY_SOURCE_PREFIX)) {
      const matched = note.slice(DUTY_SOURCE_PREFIX.length).match(/^\d+/)
      if (matched) {
        linked.add(Number(matched[0]))
      }
    }
  }
  return linked
}

function nextDutyRow(rows: EntryRow[]): { id: number; code: string } {
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  let serial = 0
  for (const row of rows) {
    const matched = String(row['排班编号'] ?? '').match(/(\d+)\s*$/)
    if (matched) {
      serial = Math.max(serial, Number(matched[1]))
    }
  }
  return { id, code: `DUTY-${String(serial + 1).padStart(4, '0')}` }
}

/**
 * 把一组巡护任务派生成值勤班次写入值勤排班模块。
 * 同一巡护任务即使同时命中多个模板/被重复勾选，也只生成一份值勤班次
 *（入参先按任务去重，已派生过的任务计入 skipped）。
 */
export function createDutyShiftsFromPatrol(
  patrolIds: number[],
): ShiftCreateResult {
  const patrolRows = listRows(PATROL_KEY)
  const dutyRows = listRows(DUTY_KEY)
  const linked = dutyLinkedPatrolIds()

  // 入参去重 + 只保留真实存在的巡护任务，保证「命中两个模板只生成一份」。
  const targets = [...new Set(patrolIds)]
    .map((id) => patrolRows.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))

  if (targets.length === 0) {
    return {
      ok: false,
      message: '没有选中可派班的巡护任务',
      created: 0,
      skipped: 0,
      codes: [],
    }
  }

  const nextRows = [...dutyRows]
  const codes: string[] = []
  let created = 0
  let skipped = 0

  for (const patrol of targets) {
    const patrolId = Number(patrol.id)
    if (linked.has(patrolId)) {
      skipped += 1
      continue
    }
    const { id, code } = nextDutyRow(nextRows)
    nextRows.push({
      id,
      status: DUTY_STATUS_PENDING,
      pending: true,
      abnormal: false,
      排班编号: code,
      值勤日期: String(patrol['巡护日期'] ?? ''),
      值勤时段: String(patrol['巡护时段'] ?? ''),
      值勤岗位: `巡护岗：${patrol['巡护区域'] ?? ''}`,
      值勤人员: String(patrol['巡护员'] ?? ''),
      接班人员: '',
      交接记录: dutySourceTag(patrolId),
      排班状态: DUTY_STATUS_PENDING,
    })
    linked.add(patrolId)
    codes.push(code)
    created += 1
  }

  if (created === 0) {
    return {
      ok: false,
      message: `选中的 ${skipped} 条巡护任务都已派生过值勤班次，不重复生成`,
      created,
      skipped,
      codes,
    }
  }

  saveRows(DUTY_KEY, nextRows)
  return {
    ok: true,
    message: `已向值勤排班新增 ${created} 个班次（${codes.join('、')}）`
      + (skipped > 0 ? `，${skipped} 条此前已派生，已跳过` : ''),
    created,
    skipped,
    codes,
  }
}

/**
 * 按当班模板联合命中巡护任务并派班：多模板命中结果取并集，
 * 同一任务命中两个模板也只生成一份值勤班次。
 */
export function dispatchShiftsByTemplates(
  templates: FilterTemplate[],
): ShiftCreateResult {
  if (templates.length === 0) {
    return { ok: false, message: '请先勾选要派班的当班模板', created: 0, skipped: 0, codes: [] }
  }
  const patrolMeta = moduleMeta(PATROL_KEY)
  const exactFields = ['status', '发现火情数']
  const hitIds = new Set<number>()
  for (const template of templates) {
    // 模板条件只保留巡护模块真实存在的字段，避免旧模板/脏数据干扰取数。
    const criteria = Object.fromEntries(
      Object.entries(template.criteria).filter(
        ([field]) => field === 'status' || patrolMeta.fields.includes(field),
      ),
    )
    for (const row of filterRows(listRows(PATROL_KEY), criteria, exactFields)) {
      hitIds.add(Number(row.id))
    }
  }
  return createDutyShiftsFromPatrol([...hitIds])
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
