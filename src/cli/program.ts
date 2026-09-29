import type { PluginCatalog, ToolOptions } from '../core/index.js'
import process from 'node:process'
import { Command, Option } from 'commander'
import metadata from '../../package.json' with { type: 'json' }
import { checkAvailability, createConfig, executeCommand, loadConfig, resolveOptions } from '../core/index.js'
import { createProgress } from './progress.js'

export function createProgram(catalog: PluginCatalog): Command {
  const { commands } = catalog
  const program = new Command()
    .name('aboom')
    .description('Aboom Toolbox - 游戏开发流程工具箱')
    .usage('[命令] [选项]')
    .version(metadata.version, '-v, --version', '显示版本')
    .helpOption('-h, --help', '显示帮助')
    .option('--config <路径>', '使用指定 JSON 配置文件（也可设置 ABOOM_CONFIG）')
    .addHelpCommand('help [command]', '显示命令帮助')
    .configureHelp({
      showGlobalOptions: true,
      styleTitle: (title) => {
        const titles: Record<string, string> = { 'Usage:': '用法:', 'Options:': '选项:', 'Global Options:': '全局选项:', 'Commands:': '命令:', 'Arguments:': '参数:' }
        return titles[title] ?? title
      },
    })

  const selectedConfig = (): string | undefined => program.opts<{ config?: string }>().config

  program.command('tui')
    .description('打开交互式工具菜单')
    .helpOption('-h, --help', '显示帮助')
    .action(async () => {
      const { openTui } = await import('../tui/entry.js')
      await openTui(selectedConfig())
    })

  const config = program.command('config').description('管理各功能的默认参数')
  config.command('path').description('显示当前选用的配置路径').action(async () => {
    const loaded = await loadConfig(commands, selectedConfig())
    console.log(loaded.path)
  })
  config.command('init').description('生成各插件的默认配置；已有文件不覆盖').action(async () => {
    console.log(`已创建配置：${await createConfig(commands, selectedConfig() ?? process.env.ABOOM_CONFIG)}`)
  })
  config.command('show').description('输出配置来源及各功能的有效默认参数（JSON）').action(async () => {
    const loaded = await loadConfig(commands, selectedConfig())
    console.log(JSON.stringify({ ...loaded, effective: Object.fromEntries(commands.map(command => [command.name, resolveOptions(command, {}, loaded.config)])) }, null, 2))
  })
  config.action(() => config.outputHelp())

  program.command('plugins')
    .description('查看插件目录、加载状态和依赖检测结果')
    .option('--json', '输出结构化结果')
    .action(async ({ json }: { json?: boolean }) => {
      const loaded = await loadConfig(commands, selectedConfig())
      const tools = await Promise.all(commands.map(async (command) => {
        const { run: _run, check, ...tool } = command
        return { ...tool, ...(check ? { availability: await checkAvailability(command, resolveOptions(command, {}, loaded.config)) } : {}) }
      }))
      if (json) {
        console.log(JSON.stringify({ directory: catalog.directory, tools, issues: catalog.issues }))
      }
      else {
        console.log(`插件目录：${catalog.directory}`)
        for (const tool of tools)
          console.log(`${tool.name} v${tool.version} · ${tool.title ?? tool.description}${tool.availability ? ` · ${tool.availability.message}` : ''}`)
        for (const issue of catalog.issues)
          console.error(`${issue.directory}：${issue.message}`)
        if (!tools.length)
          console.log('没有可用插件。请检查插件目录中的 plugin.json 和入口文件。')
      }
    })

  for (const command of commands) {
    const entry = program.command(command.name)
      .description(command.description)
      .helpOption('-h, --help', '显示帮助')
      .option('--json', '输出完整的结构化结果，便于脚本使用')
      .option('--progress', '显示进度（默认开启；终端原地刷新，管道输出普通文本）')
      .option('--no-progress', '关闭进度显示，保留文件处理记录')
      .option('-q, --quiet', '仅输出错误；与 --json 同用时保留 JSON 结果')
      .addHelpText('after', '\n参数优先级：命令行 > 配置文件 > 内置默认值。config show 可查看有效默认值。')
    const fieldNames = new Map<string, string>()
    for (const field of command.fields ?? []) {
      // Commander 默认值用于帮助；执行时只提取用户显式传入的值。
      const option = new Option(`--${field.key}${field.type === 'boolean' ? '' : ' <值>'}`, `${field.label}：${field.description}`)
      if (field.default !== undefined)
        option.default(field.default)
      if (field.choices)
        option.choices([...field.choices])
      entry.addOption(option)
      fieldNames.set(field.key, option.attributeName())
      if (field.type === 'boolean')
        entry.option(`--no-${field.key}`, `关闭${field.label}（覆盖配置）`)
    }
    entry.action(async ({ json, quiet, progress }: { json?: boolean, quiet?: boolean, progress?: boolean }) => {
      const loaded = await loadConfig(commands, selectedConfig())
      const explicit: ToolOptions = {}
      for (const [key, attribute] of fieldNames) {
        if (entry.getOptionValueSource(attribute) === 'cli')
          explicit[key] = entry.getOptionValue(attribute) as string | boolean
      }
      const controller = new AbortController()
      const cancel = () => controller.abort()
      process.once('SIGINT', cancel)
      const display = createProgress({ json: json === true, quiet: quiet === true, enabled: progress !== false })
      display.start()
      const result = await executeCommand(command, resolveOptions(command, explicit, loaded.config), {
        signal: controller.signal,
        onProgress: display.update,
      }).finally(() => {
        display.finish()
        process.removeListener('SIGINT', cancel)
      })
      if (json) {
        console.log(JSON.stringify(result))
      }
      else {
        if (result.ok) {
          if (!quiet)
            console.log(result.message)
        }
        else {
          console.error(result.error.message)
          if (result.error.detail)
            console.error(`原因: ${result.error.detail}`)
          if (result.error.solution)
            console.error(`建议: ${result.error.solution}`)
        }
        if (result.summary && !quiet)
          console.log(`输出目录：${result.summary.outputDirectory}`)
      }
      if (!result.ok)
        process.exitCode = result.error.code === 'CANCELLED' ? 130 : 1
    })
  }

  program.on('command:*', ([name]) => {
    console.error(`未知命令: ${name}\n\n运行 aboom --help 查看可用命令。`)
    process.exitCode = 1
  })
  return program
}
