#!/usr/bin/env node
import process from 'node:process'
import { discoverPlugins } from '../core/index.js'
import { createProgram } from './program.js'

try {
  const catalog = await discoverPlugins()
  const program = createProgram(catalog)
  if (process.argv.length === 2)
    program.outputHelp()
  else await program.parseAsync(process.argv)
}
catch (error) {
  console.error(`执行失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
