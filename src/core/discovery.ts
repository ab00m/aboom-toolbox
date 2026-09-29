import type { ToolCommand, ToolField } from './types.js'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

declare const __ABOOM_BUNDLED__: boolean

export interface PluginIssue {
  directory: string
  message: string
}

export interface PluginCatalog {
  directory: string
  commands: ToolCommand[]
  issues: PluginIssue[]
}

export function pluginDirectory(): string {
  return resolve(process.env.ABOOM_PLUGIN_DIR || join(import.meta.dirname, typeof __ABOOM_BUNDLED__ !== 'undefined' ? 'plugins' : '../plugins'))
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const reservedNames = new Set(['tui', 'plugins', 'config', 'help'])

export function validateManifest(value: unknown): ToolCommand & { entry: string } {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.name !== 'string'
    || !/^[a-z][a-z0-9-]*$/.test(value.name) || reservedNames.has(value.name)
    || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value.version)
    || typeof value.description !== 'string' || !value.description.trim()
    || typeof value.entry !== 'string' || !value.entry.trim()) {
    throw new Error('插件描述需要 schemaVersion: 1、有效的 name/version/description/entry。')
  }
  for (const key of ['title', 'category', 'accent']) {
    if (value[key] !== undefined && typeof value[key] !== 'string')
      throw new Error(`插件 ${key} 必须为字符串。`)
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new Error('插件 enabled 必须为布尔值。')
  if (!Array.isArray(value.fields))
    throw new Error('插件 fields 必须为参数数组。')
  const keys = new Set<string>()
  for (const field of value.fields) {
    if (!object(field) || typeof field.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(field.key)
      || ['json', 'help', 'version', 'config', 'progress', 'quiet'].includes(field.key) || field.key.startsWith('no-') || keys.has(field.key) || typeof field.label !== 'string'
      || typeof field.description !== 'string' || !['text', 'boolean', 'select'].includes(String(field.type))) {
      throw new Error('插件参数字段格式无效或重名。')
    }
    keys.add(field.key)
    if ((field.required !== undefined && typeof field.required !== 'boolean')
      || (field.confirmation !== undefined && typeof field.confirmation !== 'string')
      || (field.default !== undefined && (field.type === 'boolean' ? typeof field.default !== 'boolean' : typeof field.default !== 'string'))) {
      throw new Error(`参数 ${field.key} 的默认值、必填或确认配置无效。`)
    }
    if (field.type === 'select' && (!Array.isArray(field.choices) || !field.choices.length
      || field.choices.some(choice => typeof choice !== 'string')
      || new Set(field.choices).size !== field.choices.length
      || (field.default !== undefined && !field.choices.includes(field.default)))) {
      throw new Error(`参数 ${field.key} 的选项无效。`)
    }
    if (field.choiceDescriptions !== undefined && (field.type !== 'select' || !object(field.choiceDescriptions)
      || Object.entries(field.choiceDescriptions).some(([choice, description]) => !(field.choices as string[]).includes(choice) || typeof description !== 'string'))) {
      throw new Error(`参数 ${field.key} 的选项说明无效。`)
    }
  }
  // 仅挑选允许公开的描述字段，描述文件不能提供执行函数或运行状态。
  return {
    name: value.name,
    version: value.version,
    description: value.description,
    entry: value.entry,
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.category === 'string' ? { category: value.category } : {}),
    ...(typeof value.accent === 'string' ? { accent: value.accent } : {}),
    fields: value.fields as unknown as ToolField[],
    run: () => { throw new Error('插件尚未加载。') },
  }
}

export async function discoverPlugins(directory = pluginDirectory()): Promise<PluginCatalog> {
  const catalog: PluginCatalog = { directory: resolve(directory), commands: [], issues: [] }
  let entries
  try {
    entries = await readdir(catalog.directory, { withFileTypes: true })
  }
  catch (error) {
    catalog.issues.push({ directory: catalog.directory, message: `无法读取插件目录：${error instanceof Error ? error.message : String(error)}` })
    return catalog
  }
  const names = new Set<string>()
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory())
      continue
    const folder = join(catalog.directory, entry.name)
    let text: string
    try {
      text = await readFile(join(folder, 'plugin.json'), 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        catalog.issues.push({ directory: folder, message: String(error) })
      continue
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (object(parsed) && parsed.enabled === false)
        continue
      const { entry: entryFile, ...manifest } = validateManifest(parsed)
      if (names.has(manifest.name))
        throw new Error(`重复的插件名称：${manifest.name}`)
      if (isAbsolute(entryFile))
        throw new Error('插件入口必须位于自己的目录中。')
      const root = await realpath(folder)
      const file = await realpath(resolve(folder, entryFile))
      const local = relative(root, file)
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local) || !/\.(?:mjs|js|ts)$/.test(file))
        throw new Error('插件入口必须是目录内的 JS/TS 模块。')
      const module = await import(pathToFileURL(file).href) as { default?: Partial<ToolCommand> }
      if (typeof module.default?.run !== 'function')
        throw new Error('插件入口需要默认导出 run(options, context)。')
      catalog.commands.push({ ...manifest, run: module.default.run, ...(typeof module.default.check === 'function' ? { check: module.default.check } : {}) })
      names.add(manifest.name)
    }
    catch (error) {
      catalog.issues.push({ directory: folder, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return catalog
}
