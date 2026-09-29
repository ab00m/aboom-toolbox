import type { ToolCommand, ToolOptions } from './types.js'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { defaultOptions, fieldDefault, validFieldValue } from './options.js'

export interface ToolboxConfig {
  schemaVersion: 1
  tools: Record<string, ToolOptions>
}

export interface LoadedConfig {
  path: string
  exists: boolean
  config: ToolboxConfig
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 显式路径 / 环境变量 > 当前目录 > 用户配置。只读取一份配置。 */
export function configPath(explicit?: string): { path: string, required: boolean } {
  const selected = explicit ?? process.env.ABOOM_CONFIG
  if (selected !== undefined) {
    if (!selected.trim())
      throw new Error('配置文件路径不能为空。')
    return { path: resolve(selected), required: true }
  }
  const project = resolve('aboom.config.json')
  const user = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'AboomToolbox', 'config.json')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'aboom', 'config.json')
  return { path: existsSync(project) ? project : user, required: false }
}

export function validateConfig(value: unknown, commands: readonly ToolCommand[]): ToolboxConfig {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.tools)
    || Object.keys(value).some(key => !['schemaVersion', 'tools'].includes(key))) {
    throw new Error('配置需要 schemaVersion: 1 和 tools 对象。')
  }
  const tools: Record<string, ToolOptions> = {}
  for (const [name, options] of Object.entries(value.tools)) {
    const command = commands.find(command => command.name === name)
    if (!command || !object(options))
      throw new Error(`配置 tools.${name} 需要已加载的插件及参数对象。`)
    const normalized: ToolOptions = {}
    for (const [key, option] of Object.entries(options)) {
      const field = command.fields?.find(field => field.key === key)
      if (!field || !validFieldValue(field, option)) {
        throw new Error(`配置 tools.${name}.${key} 无效，请按插件参数的类型和可选值填写。`)
      }
      normalized[key] = option as string | boolean
    }
    tools[name] = normalized
  }
  return { schemaVersion: 1, tools }
}

export async function loadConfig(commands: readonly ToolCommand[], explicit?: string): Promise<LoadedConfig> {
  const { path, required } = configPath(explicit)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path, exists: false, config: { schemaVersion: 1, tools: {} } }
    throw new Error(`无法读取配置 ${path}：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    return { path, exists: true, config: validateConfig(JSON.parse(text.replace(/^\uFEFF/, '')), commands) }
  }
  catch (error) {
    throw new Error(`配置 ${path} 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function resolveOptions(command: ToolCommand, options: ToolOptions = {}, config?: ToolboxConfig): ToolOptions {
  const defaults = defaultOptions(command)
  return { ...defaults, ...config?.tools[command.name], ...options }
}

/** 表单和依赖检测使用同一份有效默认值。 */
export function applyConfig(commands: readonly ToolCommand[], config: ToolboxConfig): ToolCommand[] {
  return commands.map(command => ({
    ...command,
    fields: (command.fields ?? []).map(field => ({ ...field, default: config.tools[command.name]?.[field.key] ?? fieldDefault(field) })),
  }))
}

export async function createConfig(commands: readonly ToolCommand[], path = resolve('aboom.config.json')): Promise<string> {
  if (!path.trim())
    throw new Error('配置文件路径不能为空。')
  const target = resolve(path)
  const config: ToolboxConfig = { schemaVersion: 1, tools: Object.fromEntries(commands.map(command => [command.name, resolveOptions(command)])) }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return target
}
