export type CellType = 'auto' | 'string' | 'number' | 'integer' | 'boolean'
export interface ColumnRule {
  header: string
  type: CellType
  required?: boolean
  default?: string | number | boolean | null
}
export interface ExcelSchema {
  schemaVersion: 1
  sheet: string | number
  headerRow: number
  dataStartRow: number
  columns?: Record<string, ColumnRule>
  skipEmpty?: string
  index?: { field: string, groupBy: string }
}

export const presets: Record<string, ExcelSchema> = {
  table: { schemaVersion: 1, sheet: 1, headerRow: 1, dataStartRow: 2 },
  sfx: {
    schemaVersion: 1,
    sheet: 1,
    headerRow: 1,
    dataStartRow: 2,
    columns: {
      ContentId: { header: 'ContentId', type: 'integer', required: true },
      SFX: { header: 'SFX', type: 'string', default: null },
      Event: { header: 'Event', type: 'string', required: true },
      Mode: { header: 'Mode', type: 'string', required: true },
      Volume: { header: 'Volume', type: 'number', default: 1 },
      Delay: { header: 'Delay', type: 'number', default: -1 },
      Immediate: { header: 'Immediate', type: 'boolean', default: false },
    },
    skipEmpty: 'Event',
    index: { field: 'EventIndex', groupBy: 'ContentId' },
  },
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length)
    throw new Error(`${label}存在未知字段：${unknown.join(', ')}`)
}

/** 格式配置覆盖选用的预设；columns 整体替换，null 可关闭跳行和编号。 */
export function resolveSchema(preset = 'table', value: unknown = {}): ExcelSchema {
  const base = Object.hasOwn(presets, preset) ? presets[preset] : undefined
  if (!base)
    throw new Error(`未知 Excel 预设：${preset}`)
  if (!object(value))
    throw new Error('Excel 格式配置必须是对象')
  keys(value, ['schemaVersion', 'sheet', 'headerRow', 'dataStartRow', 'columns', 'skipEmpty', 'index'], 'Excel 格式配置')
  const schema = { ...base, ...value }
  if (schema.schemaVersion !== 1)
    throw new Error('Excel 格式配置需要 schemaVersion: 1')
  if (!(typeof schema.sheet === 'string' && schema.sheet.trim()) && !(typeof schema.sheet === 'number' && Number.isSafeInteger(schema.sheet) && schema.sheet > 0))
    throw new Error('sheet 必须是工作表名称或从 1 开始的序号')
  // 只设置表头行时，数据默认紧随表头。
  if (value.headerRow !== undefined && value.dataStartRow === undefined)
    schema.dataStartRow = Number(schema.headerRow) + 1
  if (!Number.isSafeInteger(schema.headerRow) || Number(schema.headerRow) < 1
    || !Number.isSafeInteger(schema.dataStartRow) || Number(schema.dataStartRow) <= Number(schema.headerRow)) {
    throw new Error('headerRow/dataStartRow 必须为正整数，数据行必须位于表头之后')
  }
  if (schema.columns !== undefined) {
    if (!object(schema.columns) || !Object.keys(schema.columns).length)
      throw new Error('columns 必须是非空字段映射对象')
    for (const [field, rule] of Object.entries(schema.columns)) {
      if (!field.trim() || !object(rule))
        throw new Error('columns 需要非空输出字段名和规则对象')
      keys(rule, ['header', 'type', 'required', 'default'], `columns.${field}`)
      if (typeof rule.header !== 'string' || !rule.header.trim() || rule.header !== rule.header.trim()
        || !['auto', 'string', 'number', 'integer', 'boolean'].includes(String(rule.type))
        || (rule.required !== undefined && typeof rule.required !== 'boolean')) {
        throw new Error(`columns.${field} 的 header/type/required 无效`)
      }
      if (rule.default !== undefined && rule.default !== null) {
        const fallback = rule.default
        const valid = rule.type === 'auto'
          ? ['string', 'number', 'boolean'].includes(typeof fallback)
          : rule.type === 'number' || rule.type === 'integer'
            ? typeof fallback === 'number' && Number.isFinite(fallback) && (rule.type !== 'integer' || Number.isSafeInteger(fallback))
            : rule.type === 'string' ? typeof fallback === 'string' : typeof fallback === 'boolean'
        if (!valid || (typeof fallback === 'number' && !Number.isFinite(fallback)) || (rule.required && typeof fallback === 'string' && !fallback.trim()))
          throw new Error(`columns.${field}.default 与字段类型不匹配`)
      }
      if (rule.required && rule.default === null)
        throw new Error(`columns.${field} 为必填，default 不能为 null`)
    }
  }
  const fields = schema.columns ? Object.keys(schema.columns) : undefined
  if (schema.skipEmpty !== undefined && schema.skipEmpty !== null
    && (typeof schema.skipEmpty !== 'string' || !schema.skipEmpty.trim() || (fields && !fields.includes(schema.skipEmpty)))) {
    throw new Error('skipEmpty 必须指向输出字段，或设为 null 关闭')
  }
  if (schema.index !== undefined && schema.index !== null) {
    if (!object(schema.index))
      throw new Error('index 必须是编号规则对象，或设为 null 关闭')
    keys(schema.index, ['field', 'groupBy'], 'index')
    if (typeof schema.index.field !== 'string' || !schema.index.field.trim()
      || typeof schema.index.groupBy !== 'string' || !schema.index.groupBy.trim()
      || schema.index.field === schema.index.groupBy
      || (fields && (fields.includes(schema.index.field) || !fields.includes(schema.index.groupBy)))) {
      throw new Error('index 需要新的 field 和已有的 groupBy 输出字段')
    }
  }
  const { skipEmpty, index, ...rest } = schema
  return { ...rest, ...(skipEmpty != null ? { skipEmpty } : {}), ...(index != null ? { index } : {}) } as ExcelSchema
}
