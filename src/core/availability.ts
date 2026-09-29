import type { ToolAvailability, ToolCommand, ToolOptions } from './types.js'

/** 检测函数的同步异常和异步拒绝都转换为可展示的状态。 */
export async function checkAvailability(command: ToolCommand, options: ToolOptions): Promise<ToolAvailability> {
  try {
    return await command.check?.(options) ?? { available: true, message: '无需外部依赖。' }
  }
  catch (error) {
    return { available: false, message: error instanceof Error ? error.message : String(error) }
  }
}
