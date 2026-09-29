import { discoverPlugins } from '../src/core/index.ts'

// eslint-disable-next-line antfu/no-top-level-await -- 测试共享实际目录发现结果。
export const { commands } = await discoverPlugins()
export const audioCommand = commands.find(command => command.name === 'audio')
export const excelCommand = commands.find(command => command.name === 'excel')
