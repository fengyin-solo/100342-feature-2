<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>巡护任务管理</h2>
        <p class="page-desc">维护巡护任务，围绕任务编号、巡护区域、巡护路线、巡护员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡护任务</button>
        <button class="btn" type="button" @click="exportRows">导出巡护任务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 组合定位条件：区域、状态、巡护员、发现火情数；条件全部落库进既有筛选取数链路 -->
    <form class="filter-bar" @submit.prevent="search">
      <label class="filter-item">
        <span>巡护区域</span>
        <input v-model="filters['巡护区域']" list="patrol-area-options" placeholder="按巡护区域检索" />
        <datalist id="patrol-area-options">
          <option v-for="area in areaOptions" :key="area" :value="area"></option>
        </datalist>
      </label>
      <label class="filter-item">
        <span>任务状态</span>
        <select v-model="filters.status">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>巡护员</span>
        <input v-model="filters['巡护员']" list="patrol-ranger-options" placeholder="按巡护员检索" />
        <datalist id="patrol-ranger-options">
          <option v-for="ranger in rangerOptions" :key="ranger" :value="ranger"></option>
        </datalist>
      </label>
      <label class="filter-item">
        <span>发现火情数</span>
        <input v-model="filters['发现火情数']" type="number" min="0" placeholder="精确匹配火情数" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 当班筛选模板：模板随当前值勤班次存档，与手工条件冲突时手工条件优先 -->
    <div class="filter-bar template-bar">
      <label class="filter-item">
        <span>当班模板（{{ session.shiftLabel }}）</span>
        <input v-model="templateName" placeholder="给常用组合起个名" />
      </label>
      <button class="btn" type="button" @click="saveCurrentTemplate">存为当班模板</button>
      <button class="btn" type="button" :disabled="!templates.length" @click="dispatchCheckedTemplates">
        按勾选模板联合派班
      </button>
      <ul class="template-list">
        <li v-for="template in templates" :key="template.id" class="template-item">
          <label>
            <input type="checkbox" :value="template.id" v-model="checkedTemplateIds" />
            {{ template.name }}
            <small>{{ describeCriteria(template.criteria) || '无条件' }}</small>
          </label>
          <button class="link" type="button" @click="applyTemplate(template)">套用</button>
          <button class="link danger" type="button" @click="removeTemplate(template)">删除</button>
        </li>
        <li v-if="!templates.length" class="template-empty">当前班次还没有保存的筛选模板</li>
      </ul>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">派班</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="col-check">
            <input
              type="checkbox"
              :checked="linkedPatrolIds.has(Number(row.id))"
              @change="toggleShift(row, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无巡护任务数据，可先登记巡护任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡护任务记录</span>
      <span class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
      </span>
      <span v-if="message" class="info-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createDutyShiftsFromPatrol,
  deletePatrolTemplate,
  dispatchShiftsByTemplates,
  downloadEntries,
  dutyLinkedPatrolIds,
  filterRows,
  getPatrolTemplates,
  listEntries,
  mergeTemplateCriteria,
  moduleMeta,
  runAction as applyAction,
  savePatrolTemplate,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, FilterTemplate } from '@/data/types'

const session = useSessionStore()
const meta = moduleMeta('patrol')
const columns = ["任务编号", "巡护区域", "巡护路线", "巡护员", "巡护日期", "巡护时段", "发现火情数", "任务状态"]
const actions = ["开始巡护", "确认完成", "取消任务"]
const statuses = ["待执行", "执行中", "已完成", "已取消"]
const stats = [{"label": "今日任务数", "value": 0}, {"label": "已完成任务", "value": 0}, {"label": "巡护覆盖率", "value": 0}]

// 组合定位条件：键沿用既有 listEntries 筛选口径，status 对应行内当前状态字段。
const comboFields = ['巡护区域', '巡护员', '发现火情数']
// 状态与发现火情数走精确匹配，区域/巡护员保持包含匹配（兼容旧筛选习惯）。
const exactFields = ['status', '发现火情数']
const PAGE_SIZE = 5

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const errorMessage = ref('')
const message = ref('')
// 旧筛选是任意字段的字符串映射：这里仍用同一个结构，未登记的字段会照常走模糊包含。
const filters = ref<Record<string, string>>({})

const templates = ref<FilterTemplate[]>([])
const templateName = ref('')
const checkedTemplateIds = ref<string[]>([])
const linkedPatrolIds = ref<Set<number>>(new Set())

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: filterRows(listEntries(meta.key).items, { status }, ['status']).length,
  })),
)

// 区域/巡护员下拉候选直接复用同一条取数链路，不额外维护枚举。
const areaOptions = computed(() => distinctValues('巡护区域'))
const rangerOptions = computed(() => distinctValues('巡护员'))

function distinctValues(field: string): string[] {
  return [
    ...new Set(
      listEntries(meta.key)
        .items.map((row) => String(row[field] ?? '').trim())
        .filter(Boolean),
    ),
  ]
}

function describeCriteria(criteria: Record<string, string>): string {
  const labels: Record<string, string> = {
    status: '状态',
    巡护区域: '区域',
    巡护员: '巡护员',
    发现火情数: '火情数',
  }
  return Object.entries(criteria)
    .map(([key, value]) => `${labels[key] ?? key}=${value}`)
    .join(' / ')
}

function resetFilters() {
  filters.value = {}
  page.value = 1
  reload()
}

function search() {
  page.value = 1
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡护任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// —— 当班模板 ——

function loadTemplates() {
  templates.value = getPatrolTemplates(session.shiftLabel)
}

function saveCurrentTemplate() {
  errorMessage.value = ''
  try {
    templates.value = savePatrolTemplate(templateName.value, session.shiftLabel, filters.value)
    templateName.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '模板保存失败'
  }
}

function applyTemplate(template: FilterTemplate) {
  // 口径取舍：手工条件优先，模板只回填空缺条件，不覆盖值班员手输的值。
  filters.value = mergeTemplateCriteria(filters.value, template.criteria)
  page.value = 1
  reload()
}

function removeTemplate(template: FilterTemplate) {
  templates.value = deletePatrolTemplate(template.id, session.shiftLabel)
  checkedTemplateIds.value = checkedTemplateIds.value.filter((id) => id !== template.id)
}

function dispatchCheckedTemplates() {
  errorMessage.value = ''
  message.value = ''
  const selected = templates.value.filter((template) => checkedTemplateIds.value.includes(template.id))
  const result = dispatchShiftsByTemplates(selected)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    message.value = result.message
  }
  reload()
}

// —— 勾选任务 → 其他模块（值勤排班）新增值勤班次 ——

function toggleShift(row: EntryRow, checked: boolean) {
  errorMessage.value = ''
  message.value = ''
  const patrolId = Number(row.id)
  if (!checked) {
    // 已派生的班次不在此处删除，避免误删值勤排班模块里的记录。
    if (linkedPatrolIds.value.has(patrolId)) {
      message.value = '该任务已生成值勤班次，如需撤回请到值勤排班模块处理'
    }
    return
  }
  const result = createDutyShiftsFromPatrol([patrolId])
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    message.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 只把组合条件（及兼容的旧字段）传给列表：模板面板自身的状态不参与取数。
    const query = Object.fromEntries(
      Object.entries(filters.value).filter(([key]) =>
        key === 'status' || comboFields.includes(key) || meta.fields.includes(key),
      ),
    )
    const payload = listEntries(meta.key, query, { page: page.value, size: PAGE_SIZE, exact: exactFields })
    rows.value = payload.items
    total.value = payload.total
    // 服务层会把越界页夹回有效页，这里以返回口径为准同步页码。
    page.value = payload.page
    linkedPatrolIds.value = dutyLinkedPatrolIds()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡护任务列表读取失败'
  }
}

onMounted(() => {
  loadTemplates()
  reload()
})
</script>

<style scoped>
.template-bar {
  align-items: flex-start;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: #fbfdff;
}
.template-list {
  flex-basis: 100%;
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.template-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 12px;
  font-size: 12px;
}
.template-item small {
  color: var(--muted);
  margin-left: 4px;
}
.template-empty {
  font-size: 12px;
  color: var(--muted);
}
.col-check {
  width: 40px;
  text-align: center;
}
.pager {
  display: flex;
  align-items: center;
  gap: 8px;
}
.info-text {
  color: var(--brand);
}
.link.danger {
  color: #b42318;
}
.filter-item select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
}
</style>
