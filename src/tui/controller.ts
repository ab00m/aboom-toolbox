import type { ToolCommand, ToolOptions } from '../core/types.js'
import type { ViewState } from './state.js'
import { useApp, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { checkAvailability, defaultOptions, executeCommand } from '../core/index.js'
import { initialState, transition } from './state.js'

export function useToolbox(commands: readonly ToolCommand[]): ViewState {
  const { exit } = useApp()
  const [view, setView] = useState(initialState)
  const currentRef = useRef(view)
  const draftsRef = useRef(new Map<string, ToolOptions>())
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const checkGenerationRef = useRef(0)
  const activeRef = useRef(true)

  function update(patch: Partial<ViewState>): void {
    if (!activeRef.current)
      return
    if (patch.values && JSON.stringify(patch.values) !== JSON.stringify(currentRef.current.values)) {
      checkGenerationRef.current++
      patch.checking = false
    }
    currentRef.current = { ...currentRef.current, ...patch }
    setView(currentRef.current)
  }

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      // eslint-disable-next-line react/exhaustive-deps -- 请求计数不是 DOM 引用，卸载时必须使最新异步回调失效。
      generationRef.current++
      // eslint-disable-next-line react/exhaustive-deps -- 同步使最新依赖检测失效。
      checkGenerationRef.current++
      controllerRef.current?.abort()
    }
  }, [])

  async function run(command: ToolCommand): Promise<void> {
    if (currentRef.current.screen === 'running')
      return
    const values = { ...currentRef.current.values }
    draftsRef.current.set(command.name, values)
    const task = new AbortController()
    const id = ++generationRef.current
    checkGenerationRef.current++
    controllerRef.current = task
    update({ screen: 'running', result: null, progress: null, logs: [], editing: false, stopping: false, checking: false })
    const result = await executeCommand(command, values, {
      signal: task.signal,
      onProgress(event) {
        if (generationRef.current === id)
          update({ progress: event, logs: [...currentRef.current.logs, event.message].slice(-4) })
      },
    })
    if (generationRef.current === id) {
      controllerRef.current = null
      update({ screen: 'result', result })
    }
  }

  function open(command: ToolCommand): void {
    checkGenerationRef.current++
    update({ screen: 'form', values: { ...(draftsRef.current.get(command.name) ?? defaultOptions(command)) }, focus: 0, editing: false, result: null, availability: command.availability ?? null, checking: false })
    if (!command.fields?.length)
      void run(command)
  }

  async function check(command: ToolCommand): Promise<void> {
    if (!command.check)
      return
    const id = ++checkGenerationRef.current
    const selected = currentRef.current.selected
    update({ checking: true })
    const availability = await checkAvailability(command, { ...currentRef.current.values })
    if (checkGenerationRef.current === id && currentRef.current.selected === selected)
      update({ availability, checking: false })
  }

  useInput((input, key) => {
    const previous = currentRef.current
    const command = commands[previous.selected]
    const next = transition(previous, input, key, commands)
    update(next.state)
    switch (next.effect) {
      case 'exit':
        checkGenerationRef.current++
        exit()
        break
      case 'open':
        if (command)
          open(command)
        break
      case 'run':
        if (command)
          void run(command)
        break
      case 'stop':
        controllerRef.current?.abort()
        update({ stopping: true })
        break
      case 'save':
        checkGenerationRef.current++
        if (command)
          draftsRef.current.set(command.name, { ...previous.values })
        break
      case 'check':
        if (command)
          void check(command)
        break
    }
  })
  return view
}
