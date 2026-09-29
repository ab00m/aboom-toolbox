import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, it } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { cleanup, render } from 'ink-testing-library'
import { createElement } from 'react'
import { expectedTable, workbookBytes } from '../scripts/conversion-smoke.mjs'
import { withTemporaryDirectory } from '../scripts/release-utils.mjs'
import { applyConfig } from '../src/core/index.ts'
import { App } from '../src/tui/App.tsx'
import { audioCommand as realAudioCommand, excelCommand as realExcelCommand } from './tool-catalog.mjs'

afterEach(cleanup)

it('Excel 选择列表确认/取消、连续导航与执行、配置预设及草稿保留', async () => {
  const received = []
  const command = { ...realExcelCommand, run: async (options) => {
    received.push(options)
    await setTimeout(30)
    return { ok: true, message: '预设任务完成' }
  } }
  const ui = await open([command])
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /格式预设\s+table/)
  for (let index = 0; index < realExcelCommand.fields.findIndex(field => field.key === 'preset'); index++)
    await press(ui, '\t')
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /选择格式预设/)
  assert.match(ui.lastFrame(), /通用表格/)
  assert.match(ui.lastFrame(), /音效表/)
  await press(ui, '\u001B[B')
  await press(ui, '\u001B')
  assert.match(ui.lastFrame(), /格式预设\s+table/)
  await press(ui, '\r')
  ui.stdin.write('\u001B[B\r')
  await waitFor(() => /格式预设\s+sfx/.test(ui.lastFrame()))
  await press(ui, '\t')
  await press(ui, '\t')
  assert.match(ui.lastFrame(), /> 开始转换/)
  await press(ui, '\r')
  await press(ui, '\r')
  await waitFor(() => /预设任务完成/.test(ui.lastFrame()))
  assert.equal(received.length, 1)
  assert.equal(received[0].preset, 'sfx')
  assert.equal(received[0].output, '')
  await press(ui, 'r')
  assert.match(ui.lastFrame(), /格式预设\s+sfx/)
  await press(ui, '\u001B')
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /格式预设\s+sfx/)
  const configured = await open(applyConfig([command], { schemaVersion: 1, tools: { excel: { preset: 'sfx' } } }))
  await press(configured, '\r')
  assert.match(configured.lastFrame(), /格式预设\s+sfx/)
})

it('依赖检测采用当前参数，过期结果不会覆盖后续检测或其他页面', async () => {
  const pending = []
  const command = { name: 'check', description: '依赖检测', fields: [{ key: 'path', label: '程序路径', description: '', type: 'text', default: 'first' }], check: options => new Promise(resolve => pending.push({ options, resolve })), run: () => ({ ok: true, message: '完成' }) }
  const ui = await open([command])
  await press(ui, '\r')
  await press(ui, '\u001B[A')
  await press(ui, '\r')
  assert.equal(pending[0].options.path, 'first')
  await press(ui, '\t')
  await press(ui, '\r')
  await press(ui, '\u0015')
  await press(ui, 'second')
  await press(ui, '\r')
  await press(ui, '\u001B[A')
  await press(ui, '\r')
  assert.equal(pending[1].options.path, 'second')
  pending[1].resolve({ available: true, message: '新检测结果' })
  await waitFor(() => /新检测结果/.test(ui.lastFrame()))
  pending[0].resolve({ available: false, message: '过期检测结果' })
  await setTimeout(20)
  assert.match(ui.lastFrame(), /新检测结果/)
  assert.doesNotMatch(ui.lastFrame(), /过期检测结果/)
  await press(ui, '\r')
  await press(ui, '\u001B')
  pending[2].resolve({ available: false, message: '离开后的检测结果' })
  await setTimeout(20)
  assert.match(ui.lastFrame(), /工具列表/)
  assert.doesNotMatch(ui.lastFrame(), /离开后的检测结果/)
})

it('TUI 恢复配置和草稿中的目录命名开关，可切换数字与 o 增长并执行真实转换', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'sample.xlsx')
    const bytes = workbookBytes()
    await writeFile(source, bytes)
    const configured = applyConfig([realExcelCommand], { schemaVersion: 1, tools: { excel: { 'input': source, 'output-grow-o': false } } })
    const ui = await open(configured)
    await press(ui, '\r')
    assert.match(ui.lastFrame(), /输出目录增加 o\s+\[关闭\]/)
    assert.match(ui.lastFrame(), /重名追加 1、2、3/)
    for (const name of ['aboom_output', 'aboom_output1']) {
      await press(ui, '\u001B[A')
      await press(ui, '\r')
      await waitFor(() => /已完成：成功 1/.test(ui.lastFrame()))
      assert.ok(ui.lastFrame().includes(join(directory, name)))
      assert.deepEqual(JSON.parse(await readFile(join(directory, name, 'sample.json'), 'utf8')), expectedTable)
      await press(ui, 'r')
      assert.match(ui.lastFrame(), /输出目录增加 o\s+\[关闭\]/)
    }
    for (let index = 0; index < realExcelCommand.fields.findIndex(field => field.key === 'output-grow-o'); index++)
      await press(ui, '\t')
    await press(ui, ' ')
    assert.match(ui.lastFrame(), /输出目录增加 o\s+\[开启\]/)
    assert.match(ui.lastFrame(), /重名增加 o/)
    for (let index = realExcelCommand.fields.findIndex(field => field.key === 'output-grow-o'); index < realExcelCommand.fields.length; index++)
      await press(ui, '\t')
    await press(ui, '\r')
    await waitFor(() => /已完成：成功 1/.test(ui.lastFrame()))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'abooom_output', 'sample.json'), 'utf8')), expectedTable)
    assert.deepEqual(await readFile(source), bytes)
  })
})

it('TUI 配置默认值进入表单和执行，配置中的覆盖仍需确认', async () => {
  let received
  const configured = applyConfig([{ ...realExcelCommand, run: (options) => {
    received = options
    return { ok: true, message: '配置任务完成' }
  } }], { schemaVersion: 1, tools: { excel: { input: 'configured.xlsx', output: 'configured-output', overwrite: true } } })
  const ui = await open(configured)
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /configured.xlsx/)
  assert.match(ui.lastFrame(), /configured-output/)
  for (let index = 0; index < realExcelCommand.fields.length; index++)
    await press(ui, '\t')
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /按 Y 确认/)
  assert.equal(received, undefined)
  await press(ui, 'y')
  await waitFor(() => /配置任务完成/.test(ui.lastFrame()))
  assert.equal(received.input, 'configured.xlsx')
  assert.equal(received.output, 'configured-output')
  assert.equal(received.overwrite, true)
})

// 无参数测试工具用于验证导航本身；真实插件另测表单和执行流程。
const excelCommand = { name: 'excel', description: 'Excel 数据转换', run: () => ({ ok: false, error: { code: 'TEST', message: 'Excel 转换测试错误。' } }) }
const audioCommand = { name: 'audio', description: '音频转换', run: () => ({ ok: false, error: { code: 'TEST', message: '音频转换测试错误。', solution: '测试建议' } }) }

async function waitFor(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待 TUI 更新超时')
    await setTimeout(10)
  }
}

async function open(commands) {
  const ui = render(createElement(App, { commands }))
  await waitFor(() => ui.stdin.listenerCount('readable') > 0)
  return ui
}

it('TUI 方向键选择工具，显示错误并保留返回后的选择', async () => {
  const ui = await open([excelCommand, audioCommand])
  assert.match(ui.lastFrame(), /> excel/)
  ui.stdin.write('\u001B[B')
  await waitFor(() => /> audio/.test(ui.lastFrame()))
  ui.stdin.write('\r')
  await waitFor(() => /音频转换测试错误/.test(ui.lastFrame()))
  assert.match(ui.lastFrame(), /测试建议/)
  ui.stdin.write('\u001B')
  await waitFor(() => /> audio/.test(ui.lastFrame()))
  ui.stdin.write('k')
  await waitFor(() => /> excel/.test(ui.lastFrame()))
  ui.stdin.write('\r')
  await waitFor(() => /Excel 转换测试错误/.test(ui.lastFrame()))
  ui.stdin.write('\r')
  await waitFor(() => /> excel/.test(ui.lastFrame()))
})

it('同批导航和 Enter 执行新选中的工具，返回后也接受连续输入', async () => {
  const ui = await open([excelCommand, audioCommand])
  ui.stdin.write('\u001B[B\r')
  await waitFor(() => /测试错误/.test(ui.lastFrame()))
  assert.match(ui.lastFrame(), /音频转换测试错误/)
  assert.doesNotMatch(ui.lastFrame(), /Excel 转换测试错误/)
  ui.stdin.write('\r\u001B[A\r')
  await waitFor(() => /Excel 转换测试错误/.test(ui.lastFrame()))
  assert.match(ui.lastFrame(), /Excel 数据转换/)
})

it('菜单退出项与 q 都释放输入监听', async () => {
  for (const useMenu of [true, false]) {
    const ui = await open([excelCommand, audioCommand])
    if (useMenu) {
      ui.stdin.write('\u001B[A')
      await waitFor(() => /> 退出/.test(ui.lastFrame()))
      ui.stdin.write('\r')
    }
    else {
      ui.stdin.write('q')
    }
    await waitFor(() => ui.stdin.listenerCount('readable') === 0)
  }
})

it('异步命令显示执行状态，连续 Enter 不会重复启动', async () => {
  let complete
  let calls = 0
  const ui = await open([{
    name: 'example',
    description: '测试工具',
    run() {
      calls += 1
      return new Promise((resolve) => {
        complete = resolve
      })
    },
  }])
  ui.stdin.write('\r')
  ui.stdin.write('\r')
  await waitFor(() => /正在执行 example/.test(ui.lastFrame()))
  assert.equal(calls, 1)
  complete({ ok: true, message: '执行完成' })
  await waitFor(() => /执行完成/.test(ui.lastFrame()))
  ui.stdin.write('q')
  await waitFor(() => ui.stdin.listenerCount('readable') === 0)
})

it('执行异常在 TUI 中显示为错误结果', async () => {
  const ui = await open([{
    name: 'example',
    description: '测试工具',
    run() { throw new Error('测试异常') },
  }])
  ui.stdin.write('\r')
  await waitFor(() => /example 执行失败/.test(ui.lastFrame()))
  assert.match(ui.lastFrame(), /原因: 测试异常/)
  assert.match(ui.lastFrame(), /返回工具列表/)
})

async function press(ui, key) {
  ui.stdin.write(key)
  await setTimeout(15)
}

it('转换表单预填当前目录和自动输出，可直接执行', async () => {
  for (const command of [realExcelCommand, realAudioCommand]) {
    let received
    const ui = await open([{ ...command, run: (options) => {
      received = options
      return { ok: true, message: '默认路径执行完成' }
    } }])
    await press(ui, '\r')
    assert.match(ui.lastFrame(), /输入路径\s+\./)
    assert.match(ui.lastFrame(), /自动：输入目录下新建 aboom_output/)
    await press(ui, '\u001B[A')
    if (command.check)
      await press(ui, '\u001B[A')
    await press(ui, '\r')
    await waitFor(() => /默认路径执行完成/.test(ui.lastFrame()))
    assert.equal(received.input, '.')
    assert.equal(received.output, '')
  }
})

it('真实 Excel 插件：输入、粘贴、执行、结果及参数保留', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, '中文 q sample.xlsx')
    await writeFile(source, workbookBytes())
    const ui = await open([realExcelCommand, realAudioCommand])
    await press(ui, '\r')
    assert.match(ui.lastFrame(), /输入路径/)
    await press(ui, '\r')
    await press(ui, '\u0015')
    await press(ui, `"${source}"`)
    await press(ui, '\r')
    await press(ui, '\t')
    await press(ui, '\r')
    await press(ui, '\u0015')
    await press(ui, join(directory, 'aboom_output'))
    await press(ui, '\r')
    for (let index = 1; index < realExcelCommand.fields.length; index++)
      await press(ui, '\t')
    assert.match(ui.lastFrame(), /> 开始转换/)
    await press(ui, '\r')
    await waitFor(() => /已完成：成功 1/.test(ui.lastFrame()))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'aboom_output', '中文 q sample.json'), 'utf8')), expectedTable)
    await press(ui, 'r')
    assert.match(ui.lastFrame(), /sample.xlsx/)
    await press(ui, '\u001B')
    assert.match(ui.lastFrame(), /> excel/)
  })
})

it('表单不把 q 当作退出，支持 Unicode 光标编辑、缺少必填参数及格式选择', async () => {
  let received
  const plugin = { ...realAudioCommand, fields: [{ ...realAudioCommand.fields[0], required: true, default: '' }, ...realAudioCommand.fields.slice(1)], run: (options) => {
    received = options
    return { ok: true, message: '已完成' }
  } }
  const ui = await open([plugin])
  await press(ui, '\r')
  await press(ui, '\u001B[A')
  await press(ui, '\u001B[A')
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /输入或粘贴路径/)
  await press(ui, 'q中文🧪')
  await press(ui, '\u001B[D')
  await press(ui, '\u007F')
  await press(ui, '字')
  await press(ui, '\r')
  await press(ui, '\t')
  await press(ui, '\t')
  await press(ui, '\t')
  await press(ui, '\u001B[C')
  await press(ui, '\t')
  await press(ui, '\u001B[C')
  for (let index = 0; index < 4; index++)
    await press(ui, '\t')
  await press(ui, '\r')
  await waitFor(() => /已完成/.test(ui.lastFrame()))
  assert.equal(received.input, 'q中字🧪')
  assert.equal(received.from, 'FLAC')
  assert.equal(received.to, 'OGG')
})

it('覆盖确认允许取消，只有确认后调用插件', async () => {
  let calls = 0
  const fields = [{ ...realExcelCommand.fields[0], required: true, default: '' }, realExcelCommand.fields.find(field => field.key === 'overwrite')]
  const ui = await open([{ ...realExcelCommand, fields, run: () => {
    calls += 1
    return { ok: true, message: '覆盖完成' }
  } }])
  await press(ui, '\r')
  await press(ui, '\r')
  await press(ui, 'sample.xlsx')
  await press(ui, '\t')
  await press(ui, ' ')
  await press(ui, '\t')
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /按 Y 确认/)
  assert.equal(calls, 0)
  await press(ui, 'n')
  assert.doesNotMatch(ui.lastFrame(), /按 Y 确认/)
  await press(ui, '\r')
  await press(ui, 'y')
  await waitFor(() => /覆盖完成/.test(ui.lastFrame()))
  assert.equal(calls, 1)
})

it('运行期间 Esc 取消并显示结果，不启动第二个任务', async () => {
  let calls = 0
  const ui = await open([{ name: 'cancel', description: '可停止工具', run: (_options, context) => {
    calls += 1
    return new Promise(resolve => context.signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'CANCELLED', message: '已停止' } }), { once: true }))
  } }])
  await press(ui, '\r')
  await press(ui, '\r')
  assert.match(ui.lastFrame(), /正在执行 cancel/)
  await press(ui, '\u001B')
  await waitFor(() => /已停止/.test(ui.lastFrame()))
  assert.equal(calls, 1)
})

it('窄终端和宽终端都显示完整菜单和可操作表单', async () => {
  for (const columns of [52, 80, 100]) {
    const ui = await open([realExcelCommand, realAudioCommand])
    Object.defineProperty(ui.stdout, 'columns', { value: columns, configurable: true })
    ui.rerender(createElement(App, { commands: [realExcelCommand, realAudioCommand] }))
    await press(ui, '\u001B[B')
    assert.match(ui.lastFrame(), /音频格式转换/)
    await press(ui, '\r')
    assert.match(ui.lastFrame(), /来源格式/)
    assert.match(ui.lastFrame(), /开始转换/)
    assert.match(ui.lastFrame(), /FFmpeg 路径/)
  }
})
