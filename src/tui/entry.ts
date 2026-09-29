#!/usr/bin/env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { applyConfig, discoverPlugins, loadConfig } from '../core/index.js'
import { startTui } from './index.js'

export async function openTui(configFile?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('TUI 需要交互终端；可运行 aboom --help 查看命令。')
  const catalog = await discoverPlugins()
  const loaded = await loadConfig(catalog.commands, configFile)
  for (const issue of catalog.issues)
    console.error(`${issue.directory}：${issue.message}`)
  await startTui(applyConfig(catalog.commands, loaded.config))
}

// 可独立启动；被 CLI 动态导入时不会自行运行。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2)
  try {
    if (args.length && !(args.length === 2 && args[0] === '--config'))
      throw new Error('用法：node tui.mjs [--config <配置文件>]')
    // eslint-disable-next-line antfu/no-top-level-await -- 独立 TUI 入口等待界面退出。
    await openTui(args[1])
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
