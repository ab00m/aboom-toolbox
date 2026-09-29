import type { Key } from 'ink'
import type { CommandResult, ProgressEvent, ToolAvailability, ToolCommand, ToolOptions } from '../core/types.js'
import { validFieldValue } from '../core/index.js'
import { editText } from './editor.js'

export interface ViewState {
  screen: 'menu' | 'form' | 'select' | 'confirm' | 'running' | 'result'
  selected: number
  focus: number
  editing: boolean
  cursor: number
  choice: number
  values: ToolOptions
  result: CommandResult | null
  progress: ProgressEvent | null
  logs: string[]
  stopping: boolean
  availability: ToolAvailability | null
  checking: boolean
}

export function initialState(): ViewState {
  return { screen: 'menu', selected: 0, focus: 0, editing: false, cursor: 0, choice: 0, values: {}, result: null, progress: null, logs: [], stopping: false, availability: null, checking: false }
}

type Effect = 'exit' | 'open' | 'run' | 'stop' | 'save' | 'check'
interface Transition { state: ViewState, effect?: Effect }
const wrap = (value: number, length: number) => (value + length) % length

/** 纯状态转换；异步任务、退出和会话草稿由控制器处理。 */
export function transition(state: ViewState, input: string, key: Key, commands: readonly ToolCommand[]): Transition {
  const command = commands[state.selected]
  const change = (patch: Partial<ViewState>, effect?: Effect): Transition => ({ state: { ...state, ...patch }, ...(effect ? { effect } : {}) })
  if (key.ctrl && input === 'c')
    return change({}, state.screen === 'running' ? 'stop' : 'exit')
  if (state.screen === 'running')
    return change({}, key.escape || input === 's' ? 'stop' : undefined)
  if (state.screen === 'confirm') {
    if (input.toLowerCase() === 'y')
      return change({}, 'run')
    return change(input.toLowerCase() === 'n' || key.escape ? { screen: 'form' } : {})
  }
  if (state.screen === 'result') {
    if (input === 'q')
      return change({}, 'exit')
    if (input === 'r')
      return change({}, 'open')
    return change(key.escape || key.backspace || key.return ? { screen: 'menu', result: null } : {})
  }
  if (state.screen === 'menu') {
    if (input === 'q' || key.escape)
      return change({}, 'exit')
    if (key.upArrow || key.downArrow || input === 'k' || input === 'j')
      return change({ selected: wrap(state.selected + (key.upArrow || input === 'k' ? -1 : 1), commands.length + 1) })
    return change({}, key.return ? (command ? 'open' : 'exit') : undefined)
  }
  if (!command)
    return change({})
  const fields = command.fields ?? []
  const field = fields[state.focus]
  const count = fields.length + 1 + (command.check ? 1 : 0)
  if (state.screen === 'select' && field) {
    const choices = field.choices ?? []
    if (key.escape)
      return change({ screen: 'form' })
    if (key.return)
      return change({ screen: 'form', values: { ...state.values, [field.key]: choices[state.choice]! } })
    if (key.upArrow || key.downArrow || input === 'j' || input === 'k')
      return change({ choice: wrap(state.choice + (key.upArrow || input === 'k' ? -1 : 1), choices.length) })
    return change({})
  }
  if (state.editing && field) {
    if (key.escape || key.return || key.tab)
      return change({ editing: false, ...(key.tab ? { focus: wrap(state.focus + (key.shift ? -1 : 1), count) } : {}) })
    const edited = editText(String(state.values[field.key] ?? ''), state.cursor, input, key)
    return change({ values: { ...state.values, [field.key]: edited.value }, cursor: edited.cursor })
  }
  if (key.escape)
    return change({ screen: 'menu' }, 'save')
  if (key.upArrow || key.downArrow || key.tab)
    return change({ focus: wrap(state.focus + (key.upArrow || (key.tab && key.shift) ? -1 : 1), count) })
  if (key.return && !field) {
    if (state.focus > fields.length)
      return change({}, 'check')
    const missing = fields.findIndex(item => !validFieldValue(item, state.values[item.key]))
    if (missing >= 0)
      return change({ focus: missing, editing: fields[missing]!.type === 'text', cursor: 0 })
    if (fields.some(item => item.confirmation && state.values[item.key]))
      return change({ screen: 'confirm' })
    return change({}, 'run')
  }
  if (field && (key.return || input === ' ' || key.leftArrow || key.rightArrow)) {
    if (field.type === 'boolean')
      return change({ values: { ...state.values, [field.key]: !state.values[field.key] } })
    if (field.type === 'select') {
      const choices = field.choices ?? []
      const index = Math.max(0, choices.indexOf(String(state.values[field.key])))
      if (key.return)
        return change({ screen: 'select', choice: index })
      return change({ values: { ...state.values, [field.key]: choices[wrap(index + (key.leftArrow ? -1 : 1), choices.length)]! } })
    }
    if (key.return)
      return change({ editing: true, cursor: Array.from(String(state.values[field.key] ?? '')).length })
  }
  return change({})
}
