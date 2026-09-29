import type { ColumnRule, ExcelSchema } from './schema.js'
import { resolveSchema } from './schema.js'

export type JsonCell = string | number | boolean | null
export type JsonEntry = Record<string, JsonCell>

function blank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim())
}

function invalid(row: number, field: string, message: string): never {
  throw new Error(`第 ${row} 行 ${field}：${message}`)
}

function cellValue(value: unknown, rule: ColumnRule, row: number, field: string): JsonCell {
  if (blank(value)) {
    if (rule.default !== undefined)
      return rule.default
    if (rule.required)
      invalid(row, field, '不能为空')
    return null
  }
  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string')
        invalid(row, field, '必须是文本')
      return value.trim()
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' && (typeof value !== 'string'
        || !(rule.type === 'integer' ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i).test(value.trim()))) {
        invalid(row, field, rule.type === 'integer' ? '必须是整数' : '必须是有限数值')
      }
      const result = Number(value)
      if (!Number.isFinite(result) || (rule.type === 'integer' && !Number.isSafeInteger(result)))
        invalid(row, field, rule.type === 'integer' ? '必须是 JavaScript 安全范围内的整数' : '必须是有限数值')
      return result
    }
    case 'boolean': {
      if (typeof value === 'boolean')
        return value
      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value
      if (normalized === 'true' || normalized === '1' || normalized === 1)
        return true
      if (normalized === 'false' || normalized === '0' || normalized === 0)
        return false
      return invalid(row, field, '只接受 true/false 或 1/0')
    }
    case 'auto':
      if (value instanceof Date)
        return value.toISOString()
      if (typeof value === 'string')
        return value.trim()
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
        return value
      invalid(row, field, '无法转换为 JSON 值')
  }
}

/** 行号均从 1 开始；规则与预设共享同一转换引擎。 */
export function convertRows(rows: readonly (readonly unknown[])[], schema: ExcelSchema = resolveSchema()): JsonEntry[] {
  const headers = rows[schema.headerRow - 1]
  if (!headers)
    throw new Error(`工作表为空或第 ${schema.headerRow} 行表头不存在`)
  const names = headers.map(value => blank(value) ? '' : String(value).trim())
  const rules = schema.columns ?? Object.fromEntries(names.filter(Boolean).map(header => [header, { header, type: 'auto' as const }]))
  const entries = Object.entries(rules)
  if (!entries.length)
    throw new Error(`第 ${schema.headerRow} 行没有有效表头`)
  const used = schema.columns ? entries.map(([, rule]) => rule.header) : names.filter(Boolean)
  const missing = used.filter(header => !names.includes(header))
  if (missing.length)
    throw new Error(`第 ${schema.headerRow} 行缺少表头：${missing.join(', ')}`)
  const duplicates = [...new Set(used.filter(header => names.filter(name => name === header).length > 1))]
  if (duplicates.length)
    throw new Error(`第 ${schema.headerRow} 行存在重复表头：${duplicates.join(', ')}`)
  if (schema.skipEmpty && !Object.hasOwn(rules, schema.skipEmpty))
    throw new Error(`skipEmpty 字段不存在：${schema.skipEmpty}`)
  if (schema.index && (!Object.hasOwn(rules, schema.index.groupBy) || Object.hasOwn(rules, schema.index.field)))
    throw new Error('index 需要新的 field 和已有的 groupBy 输出字段')
  const columns = entries.map(([field, rule]) => ({ field, rule, column: names.indexOf(rule.header) }))
  const skipColumn = columns.find(column => column.field === schema.skipEmpty)?.column
  const counts = new Map<JsonCell, number>()
  const result: JsonEntry[] = []
  for (let index = schema.dataStartRow - 1; index < rows.length; index++) {
    const row = rows[index]!
    if (row.every(blank) || (skipColumn !== undefined && blank(row[skipColumn])))
      continue
    const values: [string, JsonCell][] = columns.map(({ field, rule, column }) => [field, cellValue(row[column], rule, index + 1, field)])
    if (schema.index) {
      const groupPosition = values.findIndex(([field]) => field === schema.index!.groupBy)
      const group = values[groupPosition]![1]
      const count = (counts.get(group) ?? 0) + 1
      counts.set(group, count)
      values.splice(groupPosition + 1, 0, [schema.index.field, count])
    }
    result.push(Object.fromEntries(values))
  }
  return result
}
