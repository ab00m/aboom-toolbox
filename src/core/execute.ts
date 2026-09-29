import type { CommandResult, ExecutionContext, ToolCommand, ToolOptions } from './types.js'
import { fieldDefault, validFieldValue } from './options.js'

export async function executeCommand(command: ToolCommand, options: ToolOptions = {}, context: ExecutionContext = {}): Promise<CommandResult> {
  try {
    const normalized: ToolOptions = {}
    for (const field of command.fields ?? []) {
      const value = options[field.key] ?? fieldDefault(field)
      if (!validFieldValue(field, value)) {
        return { ok: false, error: { code: 'INVALID_OPTIONS', message: `请填写有效的${field.label}。` } }
      }
      normalized[field.key] = value
    }
    return await command.run({ ...options, ...normalized }, context)
  }
  catch (error) {
    return {
      ok: false,
      error: {
        code: context.signal?.aborted ? 'CANCELLED' : 'COMMAND_FAILED',
        message: context.signal?.aborted ? '已停止。' : `${command.name} 执行失败。`,
        detail: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
