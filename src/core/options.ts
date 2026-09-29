import type { ToolCommand, ToolField, ToolOptions } from './types.js'

export function fieldDefault(field: ToolField): string | boolean {
  return field.default ?? (field.type === 'boolean' ? false : '')
}

export function validFieldValue(field: ToolField, value: unknown): value is string | boolean {
  return (field.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string')
    && (!field.required || !!String(value).trim())
    && (field.type !== 'select' || !!field.choices?.includes(String(value)))
}

export function defaultOptions(command: ToolCommand): ToolOptions {
  return Object.fromEntries((command.fields ?? []).map(field => [field.key, fieldDefault(field)]))
}
