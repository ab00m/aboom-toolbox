import type { ToolCommand } from '../core/index.js'
import { render } from 'ink'
import { checkAvailability, resolveOptions } from '../core/index.js'
import { App } from './App.js'

export async function startTui(commands: readonly ToolCommand[]): Promise<void> {
  const checked = await Promise.all(commands.map(async command => ({ ...command, ...(command.check ? { availability: await checkAvailability(command, resolveOptions(command)) } : {}) })))
  const instance = render(<App commands={checked} />, { exitOnCtrlC: false })
  await instance.waitUntilExit()
}
