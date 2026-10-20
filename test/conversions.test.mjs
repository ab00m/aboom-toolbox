import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { link, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { expectedSfx, sfxHeaders, wavBytes, workbookBytes } from '../scripts/conversion-smoke.mjs'
import { withTemporaryDirectory } from '../scripts/release-utils.mjs'
import { atomicOutput, collectJobs } from '../src/core/files.ts'
import { executeCommand, runConversion } from '../src/core/index.ts'
import { runFfmpeg } from '../src/plugins/audio/adapter.ts'
import { convertRows } from '../src/plugins/excel/core.ts'
import { resolveSchema } from '../src/plugins/excel/schema.ts'
import { audioCommand, excelCommand } from './tool-catalog.mjs'

it('通用表格：自动字段、空行、空表头、原生类型、日期和重复表头', () => {
  const schema = resolveSchema('table')
  assert.deepEqual(convertRows([['名称', '', '数值', '启用', '日期'], [' 测试 ', '忽略', 0, false, new Date('2026-01-01T00:00:00Z')], [], [null, null, 2]], schema), [
    { 名称: '测试', 数值: 0, 启用: false, 日期: '2026-01-01T00:00:00.000Z' },
    { 名称: null, 数值: 2, 启用: null, 日期: null },
  ])
  assert.throws(() => convertRows([['名称', '名称']], schema), /重复表头/)
  assert.throws(() => convertRows([[]], schema), /没有有效表头/)
})

it('自定义格式：表头行、数据行、字段映射、默认值、跳行和分组编号', () => {
  const schema = resolveSchema('table', {
    headerRow: 2,
    dataStartRow: 4,
    columns: {
      id: { header: '编号', type: 'integer', required: true },
      name: { header: '名称', type: 'string', required: true, default: '未命名' },
      score: { header: '得分', type: 'number', default: 0 },
      enabled: { header: '启用', type: 'boolean', default: false },
    },
    skipEmpty: 'id',
    index: { field: 'sequence', groupBy: 'id' },
  })
  const rows = [['说明'], ['名称', '得分', '编号', '启用'], ['备注'], ['', '', '7'], [' 第二条 ', '1e2', 7, 'TRUE'], ['无编号', 5], ['另组', -1, 8, 0]]
  assert.deepEqual(convertRows(rows, schema), [
    { id: 7, sequence: 1, name: '未命名', score: 0, enabled: false },
    { id: 7, sequence: 2, name: '第二条', score: 100, enabled: true },
    { id: 8, sequence: 1, name: '另组', score: -1, enabled: false },
  ])
  assert.equal(resolveSchema('table', { headerRow: 3 }).dataStartRow, 4)
  assert.throws(() => convertRows([...rows, ['坏数值', '0xff', 8]], schema), /第 8 行 score/)
  const disabled = resolveSchema('sfx', { skipEmpty: null, index: null })
  assert.equal(disabled.index, undefined)
  assert.throws(() => convertRows([sfxHeaders, [1, null, '', 'Play']], disabled), /Event.*不能为空/)
})

it('格式配置提前拒绝拼写错误、无效行号、默认值类型和字段引用', () => {
  for (const config of [
    { schemaVersion: 2 },
    { headerrow: 2 },
    { sheet: 0 },
    { sheet: '' },
    { headerRow: '2' },
    { headerRow: 2, dataStartRow: 2 },
    { columns: {} },
    { columns: { x: { header: 'x', type: 'number', default: '0' } } },
    { columns: { x: { header: 'x', type: 'integer', default: 1.5 } } },
    { columns: { x: { header: 'x', type: 'boolean', default: 0 } } },
    { columns: { x: { header: 'x', type: 'auto', default: {} } } },
    { columns: { x: { header: 'x', type: 'string', required: true, default: null } } },
    { columns: { x: { header: 'x', type: 'string', typo: true } } },
    { columns: { x: { header: 'x', type: 'string' } }, skipEmpty: 'missing' },
    { columns: { x: { header: 'x', type: 'string' } }, index: { field: 'x', groupBy: 'x' } },
  ]) {
    assert.throws(() => resolveSchema('table', config), undefined, JSON.stringify(config))
  }
})

it('真实 XLSX：格式文件读取指定工作表和表头行，空白前导行保留实际行号', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'custom.xlsx')
    const schema = join(directory, 'format.json')
    const output = join(directory, 'out')
    await writeFile(source, workbookBytes([[], ['编号', '名称'], [9, '测试'], [10]]))
    const config = { sheet: 'SFX', headerRow: 2, columns: { id: { header: '编号', type: 'integer', required: true }, label: { header: '名称', type: 'string', default: '默认名称' } } }
    await writeFile(schema, `\uFEFF${JSON.stringify(config)}`)
    const result = await executeCommand(excelCommand, { input: source, output, preset: 'table', schema })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(JSON.parse(await readFile(join(output, 'custom.json'), 'utf8')), [{ id: 9, label: '测试' }, { id: 10, label: '默认名称' }])
    await writeFile(schema, JSON.stringify({ ...config, sheet: '不存在' }))
    const failed = await executeCommand(excelCommand, { input: source, output, preset: 'table', schema, overwrite: true })
    assert.equal(failed.summary.failed, 1)
    assert.match(failed.summary.results[0].message, /不存在/)
    await writeFile(schema, '{ broken')
    const invalid = await executeCommand(excelCommand, { input: source, output, preset: 'table', schema })
    assert.match(invalid.error.detail, /Excel 格式配置/)
    assert.equal(invalid.summary, undefined)
  })
})

const convertSfx = rows => convertRows(rows, resolveSchema('sfx'))

it('Excel 预览验证真实工作簿和字段，不创建目录、不覆盖结果，逐文件报告错误', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'valid.xlsx')
    const bytes = workbookBytes()
    await writeFile(source, bytes)
    const options = { 'input': directory, 'dry-run': true }
    const preview = await executeCommand(excelCommand, options)
    assert.equal(preview.ok, true, JSON.stringify(preview))
    assert.equal(preview.summary.converted, 0)
    assert.equal(preview.summary.skipped, 1)
    assert.match(preview.summary.results[0].message, /预览.*1 条/)
    assert.deepEqual(await readdir(directory), ['valid.xlsx'])
    const output = join(directory, 'out')
    await mkdir(output)
    await writeFile(join(output, 'valid.json'), 'preserve')
    for (const overwrite of [false, true]) {
      const result = await executeCommand(excelCommand, { ...options, output, overwrite })
      assert.equal(result.ok, true)
      assert.equal(result.summary.results[0].message.includes('已有结果，将跳过'), !overwrite)
      assert.equal(await readFile(join(output, 'valid.json'), 'utf8'), 'preserve')
    }
    await writeFile(join(directory, 'broken.xlsx'), 'not a workbook')
    const mixed = await executeCommand(excelCommand, options)
    assert.equal(mixed.error.code, 'BATCH_FAILED')
    assert.equal(mixed.summary.failed, 1)
    assert.equal(mixed.summary.skipped, 1)
    const schema = join(directory, 'format.json')
    await writeFile(schema, JSON.stringify({ columns: { id: { header: 'Missing', type: 'integer' } } }))
    const invalid = await executeCommand(excelCommand, { ...options, input: source, schema })
    assert.match(invalid.summary.results[0].message, /缺少表头/)
    await writeFile(schema, '{"headerrow":2}')
    const invalidConfig = await executeCommand(excelCommand, { ...options, schema })
    assert.equal(invalidConfig.error.code, 'COMMAND_FAILED')
    assert.match(invalidConfig.error.detail, /未知字段/)
    assert.deepEqual(await readFile(source), bytes)
    assert.deepEqual((await readdir(directory)).sort(), ['broken.xlsx', 'format.json', 'out', 'valid.xlsx'])
  })
})

it('音频预览递归文件计划无需 FFmpeg，保护已有结果并支持取消', async () => {
  await withTemporaryDirectory(async (directory) => {
    const nested = join(directory, 'nested')
    await mkdir(nested)
    const source = join(nested, 'sample.wav')
    await writeFile(source, wavBytes())
    const options = { 'input': directory, 'recursive': true, 'from': 'WAV', 'to': 'OGG', 'ffmpeg': join(directory, 'missing-ffmpeg'), 'dry-run': true }
    const result = await executeCommand(audioCommand, options)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.summary.skipped, 1)
    assert.equal(result.summary.converted, 0)
    assert.equal(result.summary.results[0].output, join(directory, 'aboom_output', 'nested', 'sample.ogg'))
    assert.match(result.summary.results[0].message, /WAV → OGG/)
    assert.match(result.summary.results[0].message, /未验证音频内容或 FFmpeg/)
    assert.deepEqual(await readdir(directory), ['nested'])
    const output = join(directory, 'out')
    await mkdir(join(output, 'nested'), { recursive: true })
    const existing = join(output, 'nested', 'sample.ogg')
    await writeFile(existing, 'preserve')
    for (const overwrite of [false, true]) {
      const preview = await executeCommand(audioCommand, { ...options, output, overwrite })
      assert.equal(preview.ok, true)
      assert.equal(preview.summary.results[0].message.includes('已有结果，将跳过'), !overwrite)
      assert.equal(await readFile(existing, 'utf8'), 'preserve')
    }
    const controller = new AbortController()
    const cancelled = await executeCommand(audioCommand, options, {
      signal: controller.signal,
      onProgress(event) {
        if (event.phase === 'prepare')
          controller.abort()
      },
    })
    assert.equal(cancelled.error.code, 'CANCELLED')
    assert.deepEqual((await readdir(directory)).sort(), ['nested', 'out'])
    const real = await executeCommand(audioCommand, { ...options, 'dry-run': false })
    assert.equal(real.error.code, 'COMMAND_FAILED')
    assert.match(real.error.detail, /FFmpeg/)
  })
})

const copySpec = {
  sourceExtension: '.txt',
  targetExtension: '.json',
  write: async (job, temporary) => writeFile(temporary, await readFile(job.source)),
}
const copyCommand = { name: 'copy', description: '测试共享转换', run: (options, context) => runConversion(options, context, copySpec) }

it('自动输出处理文件/目录/留空路径、占名文件与链接，排除历史目录且允许选择历史目录作输入', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'a.txt')
    await writeFile(source, 'source')
    await writeFile(join(directory, 'aboom_output'), 'occupied')
    const target = join(directory, 'target')
    await mkdir(target)
    await symlink(target, join(directory, 'abooom_output'), process.platform === 'win32' ? 'junction' : 'dir')
    const previous = join(directory, 'aboooom_output')
    await mkdir(previous)
    await writeFile(join(previous, 'old.txt'), 'old')
    const first = await executeCommand(copyCommand, { input: `"${directory}"`, output: '  ', recursive: true })
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(first.summary.total, 1)
    assert.equal(first.summary.outputDirectory, join(directory, 'abooooom_output'))
    const second = await executeCommand(copyCommand, { input: source, output: '' })
    assert.equal(second.summary.outputDirectory, join(directory, 'aboooooom_output'))
    const selected = await executeCommand(copyCommand, { input: previous, recursive: true })
    assert.equal(selected.summary.total, 1)
    assert.equal(selected.summary.outputDirectory, join(previous, 'aboom_output'))
    assert.equal(await readFile(join(directory, 'aboom_output'), 'utf8'), 'occupied')
  })
})

it('数字后缀跳过文件和链接占名，递归排除两种历史输出且允许选择历史目录作输入', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'a.txt')
    await writeFile(source, 'source')
    await writeFile(join(directory, 'aboom_output'), 'occupied')
    const target = join(directory, 'target')
    await mkdir(target)
    await symlink(target, join(directory, 'aboom_output1'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const name of ['aboom_output2', 'abooom_output']) {
      await mkdir(join(directory, name))
      await writeFile(join(directory, name, 'old.txt'), 'old')
    }
    for (const [input, name] of [[directory, 'aboom_output3'], [source, 'aboom_output4']]) {
      const result = await executeCommand(copyCommand, { 'input': input, 'output': '', 'recursive': true, 'output-grow-o': false })
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(result.summary.total, 1)
      assert.equal(result.summary.outputDirectory, join(directory, name))
      assert.equal(await readFile(result.summary.results[0].output, 'utf8'), 'source')
    }
    const previous = join(directory, 'aboom_output2')
    const selected = await executeCommand(copyCommand, { 'input': previous, 'recursive': true, 'output-grow-o': false })
    assert.equal(selected.summary.total, 1)
    assert.equal(selected.summary.outputDirectory, join(previous, 'aboom_output'))
    const explicit = await executeCommand(copyCommand, { 'input': source, 'output': join(directory, 'aboom_output3'), 'output-grow-o': false })
    assert.equal(explicit.summary.skipped, 1)
    assert.equal(explicit.summary.outputDirectory, join(directory, 'aboom_output3'))
    assert.equal(await readFile(join(directory, 'aboom_output'), 'utf8'), 'occupied')
  })
})

it('两种命名模式的并发任务原子分配独立输出目录，全部结果路径跟随实际分配', async () => {
  for (const [growO, names] of [[true, ['aboom_output', 'abooom_output', 'aboooom_output']], [false, ['aboom_output', 'aboom_output1', 'aboom_output2']]]) {
    await withTemporaryDirectory(async (directory) => {
      await writeFile(join(directory, 'a.txt'), 'source')
      const results = await Promise.all(Array.from({ length: 3 }, () => executeCommand(copyCommand, { 'input': directory, 'output-grow-o': growO })))
      assert.deepEqual(new Set(results.map(result => result.summary.outputDirectory)), new Set(names.map(name => join(directory, name))))
      for (const result of results) {
        assert.equal(result.ok, true, JSON.stringify(result))
        assert.equal(result.summary.results[0].output, join(result.summary.outputDirectory, 'a.json'))
        assert.equal(await readFile(result.summary.results[0].output, 'utf8'), 'source')
      }
    })
  }
})

it('无匹配、依赖失败、最终名称碰撞与转换前取消均不创建目录；预览只计划', async () => {
  await withTemporaryDirectory(async (directory) => {
    assert.equal((await executeCommand(copyCommand, { input: directory })).error.code, 'NO_FILES')
    await writeFile(join(directory, 'a.txt'), 'source')
    const unavailable = { ...copyCommand, run: (options, context) => runConversion(options, context, { ...copySpec, beforeRun: async () => {
      throw new Error('dependency')
    } }) }
    assert.match((await executeCommand(unavailable, { input: directory })).error.detail, /dependency/)
    const cancelled = new AbortController()
    const stopped = await executeCommand(copyCommand, { input: directory }, { signal: cancelled.signal, onProgress: (event) => {
      if (event.phase === 'prepare')
        cancelled.abort()
    } })
    assert.equal(stopped.error.code, 'CANCELLED')
    const preview = { ...copyCommand, run: (options, context) => runConversion(options, context, { ...copySpec, preview: job => `预览 ${job.output}` }) }
    assert.equal((await executeCommand(preview, { 'input': directory, 'dry-run': true })).summary.skipped, 1)
    await writeFile(join(directory, 'b.txt'), 'source')
    const collision = { ...copyCommand, run: (options, context) => runConversion(options, context, { ...copySpec, prepare: async () => ({ name: 'same.json', data: undefined }) }) }
    assert.match((await executeCommand(collision, { input: directory })).error.detail, /同名结果/)
    assert.deepEqual((await readdir(directory)).sort(), ['a.txt', 'b.txt'])
  })
})

it('写入失败清理本次空目录树，停止保留已完成结果，指定目录继续跳过/覆盖', async () => {
  await withTemporaryDirectory(async (directory) => {
    const nested = join(directory, 'nested')
    await mkdir(nested)
    await writeFile(join(nested, 'a.txt'), 'source')
    const failing = { ...copyCommand, run: (options, context) => runConversion(options, context, { ...copySpec, write: async (_job, temporary) => {
      await writeFile(temporary, 'partial')
      throw new Error('write failed')
    } }) }
    const failed = await executeCommand(failing, { input: directory, recursive: true })
    assert.equal(failed.summary.failed, 1)
    assert.deepEqual(await readdir(directory), ['nested'])
    await writeFile(join(nested, 'b.txt'), 'second')
    const controller = new AbortController()
    const partial = await executeCommand(copyCommand, { input: directory, recursive: true }, { signal: controller.signal, onProgress: (event) => {
      if (event.result)
        controller.abort()
    } })
    assert.equal(partial.error.code, 'CANCELLED')
    assert.equal(partial.summary.converted, 1)
    const output = partial.summary.outputDirectory
    assert.equal(await readFile(join(output, 'nested', 'a.json'), 'utf8'), 'source')
    const next = await executeCommand(copyCommand, { input: directory, output, recursive: true })
    assert.equal(next.summary.skipped, 1)
    assert.equal(next.summary.converted, 1)
    assert.equal((await executeCommand(copyCommand, { input: directory, output, recursive: true, overwrite: true })).summary.converted, 2)
  })
})

it('SFX 规则：重排表头、同 ContentId 顺序编号、空 Event、默认值和中文', () => {
  assert.deepEqual(convertSfx([sfxHeaders, [1001, '测试音效', 'event:/test', 'Play']]), expectedSfx)
  const rows = [['Event', 'Mode', 'Immediate', 'Delay', 'Volume', 'SFX', 'ContentId'], [' e1 ', ' Play ', 'TRUE', '0.5', '1e-1', '', '42'], ['', null], ['e2', 'Stop', 0, null, null, '音效', 42], ['e3', 'Play', true, -1, 1, null, 43], ['e4', 'Free', false, -1, 1, null, 42]]
  const data = convertSfx(rows)
  assert.deepEqual(data.map(row => row.EventIndex), [1, 2, 1, 3])
  assert.deepEqual(data[0], { ContentId: 42, EventIndex: 1, SFX: null, Event: 'e1', Mode: 'Play', Volume: 0.1, Delay: 0.5, Immediate: true })
})

it('SFX 错误报告实际行和列，拒绝重复表头、无穷数及不安全的整数', () => {
  assert.throws(() => convertSfx([]), /为空/)
  assert.throws(() => convertSfx([['Event']]), /缺少表头/)
  assert.throws(() => convertSfx([[...sfxHeaders, 'Event']]), /重复表头/)
  for (const [column, value, field] of [[0, true, 'ContentId'], [0, '42.0', 'ContentId'], [0, 9007199254740992, 'ContentId'], [3, 3, 'Mode'], [4, 'Infinity', 'Volume'], [4, '0xff', 'Volume'], [5, true, 'Delay'], [6, 'yes', 'Immediate']]) {
    const row = [42, null, 'event:/test', 'Play', 1, -1, false]
    row[column] = value
    assert.throws(() => convertSfx([sfxHeaders, [], row]), new RegExp(`第 3 行 ${field}`))
  }
})

it('真实 XLSX：读取公式缓存、指定输出、跳过已有文件、不修改输入', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, '样例.xlsx')
    const outputDirectory = join(directory, 'out')
    const bytes = workbookBytes([sfxHeaders, [1001, '测试音效', 'event:/test', 'Play', { formula: '1+1', cached: 2 }]])
    await writeFile(source, bytes)
    const events = []
    const result = await executeCommand(excelCommand, { input: source, output: outputDirectory }, { onProgress: event => events.push(event) })
    assert.equal(result.ok, true)
    assert.equal(result.summary.converted, 1)
    const output = join(outputDirectory, '样例.json')
    assert.equal(JSON.parse(await readFile(output, 'utf8'))[0].Volume, 2)
    assert.deepEqual(await readFile(source), bytes)
    assert.equal(events.at(-1).completed, 1)
    const second = await executeCommand(excelCommand, { input: source, output: outputDirectory })
    assert.equal(second.summary.skipped, 1)
  })
})

it('递归保留结构、排除输出目录和 Office 临时表；批次错误不停止其他文件', async () => {
  await withTemporaryDirectory(async (directory) => {
    const sub = join(directory, '子目录')
    const output = join(directory, 'out')
    await mkdir(sub)
    await mkdir(output)
    await writeFile(join(sub, 'good.xlsx'), workbookBytes())
    await writeFile(join(directory, 'bad.xlsx'), 'invalid')
    await writeFile(join(directory, '~$locked.xlsx'), workbookBytes())
    await writeFile(join(output, 'old.xlsx'), workbookBytes())
    const result = await executeCommand(excelCommand, { input: directory, output, recursive: true, preset: 'sfx' })
    assert.equal(result.ok, false)
    assert.equal(result.summary.total, 2)
    assert.equal(result.summary.failed, 1)
    assert.equal(result.summary.converted, 1)
    assert.deepEqual(JSON.parse(await readFile(join(output, '子目录', 'good.json'), 'utf8')), expectedSfx)
  })
})

it('覆盖保护：拒绝同名碰撞和源文件覆盖，失败/取消保留旧结果并清理临时文件', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'tone.wav')
    const output = join(directory, 'tone.flac')
    await writeFile(source, wavBytes())
    await writeFile(output, 'old')
    await assert.rejects(collectJobs(source, directory, { sourceExtension: '.wav', targetExtension: '.wav' }), /覆盖输入/)
    await assert.rejects(atomicOutput({ source, output }, true, undefined, async (temporary) => {
      await writeFile(temporary, 'partial')
      throw new Error('failed')
    }), /failed/)
    const controller = new AbortController()
    await assert.rejects(atomicOutput({ source, output }, true, controller.signal, async (temporary) => {
      await writeFile(temporary, 'partial')
      controller.abort()
    }))
    assert.equal(await readFile(output, 'utf8'), 'old')
    assert.deepEqual((await readdir(directory)).sort(), ['tone.flac', 'tone.wav'])
    const alias = join(directory, 'alias.wav')
    await link(source, alias)
    await assert.rejects(atomicOutput({ source, output: alias }, true, undefined, async temporary => writeFile(temporary, 'bad')), /同一文件/)
    await writeFile(join(directory, 'tone.WAV'), wavBytes())
    if (process.platform !== 'win32')
      await assert.rejects(collectJobs(directory, join(directory, 'out'), { sourceExtension: '.wav', targetExtension: '.flac' }), /同名结果/)
  })
})

it('取消批次不启动剩余文件；输入错误和空目录可读', async () => {
  await withTemporaryDirectory(async (directory) => {
    const empty = await executeCommand(excelCommand, { input: directory })
    assert.equal(empty.error.code, 'NO_FILES')
    assert.match((await executeCommand(excelCommand, { input: join(directory, 'missing') })).error.detail, /输入路径不存在/)
    await writeFile(join(directory, 'a.xlsx'), workbookBytes())
    await writeFile(join(directory, 'b.xlsx'), workbookBytes())
    const controller = new AbortController()
    const result = await executeCommand(excelCommand, { input: directory, output: join(directory, 'out') }, { signal: controller.signal, onProgress: (event) => {
      if (event.phase === 'convert' && event.result && event.completed === 1)
        controller.abort()
    } })
    assert.equal(result.error.code, 'CANCELLED')
    assert.equal(result.summary.converted, 1)
    assert.equal(result.summary.total, 2)
  })
})

it('FFmpeg Adapter 停止实际子进程并限制错误输出', async () => {
  const controller = new AbortController()
  const pending = runFfmpeg(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], controller.signal)
  controller.abort()
  await assert.rejects(pending, /取消/)
  await assert.rejects(runFfmpeg(process.execPath, ['-e', 'console.error("bad"); process.exit(2)']), /bad/)
})

it('音频缺少 FFmpeg 的提示可读；全部结果已有时不依赖 FFmpeg', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'tone.wav')
    const output = join(directory, 'out')
    await writeFile(source, wavBytes())
    const options = { input: source, output, ffmpeg: join(directory, 'missing-ffmpeg') }
    const result = await executeCommand(audioCommand, options)
    assert.equal(result.ok, false)
    assert.match(result.error.detail, /ABOOM_FFMPEG/)
    await mkdir(output)
    await writeFile(join(output, 'tone.flac'), 'old')
    assert.equal((await executeCommand(audioCommand, options)).summary.skipped, 1)
  })
})

it('真实 FFmpeg：四种目标格式均可解码，FLAC PCM 相同，源文件保持不变', { skip: !process.env.ABOOM_TEST_FFMPEG }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, '音频 sample.wav')
    const bytes = wavBytes()
    await writeFile(source, bytes)
    for (const to of ['FLAC', 'OGG', 'MP3', 'WAV']) {
      const output = join(directory, to)
      const result = await executeCommand(audioCommand, { input: source, output, to, ffmpeg: process.env.ABOOM_TEST_FFMPEG })
      assert.equal(result.ok, true, JSON.stringify(result))
      const decoded = spawnSync(process.env.ABOOM_TEST_FFMPEG, ['-v', 'error', '-i', join(output, `音频 sample.${to.toLowerCase()}`), '-f', 's16le', '-c:a', 'pcm_s16le', '-'], { encoding: 'buffer' })
      assert.equal(decoded.status, 0, String(decoded.stderr))
      assert.ok(decoded.stdout.length > 0)
      if (to === 'FLAC' || to === 'WAV')
        assert.deepEqual(Buffer.from(decoded.stdout), bytes.subarray(44))
    }
    assert.deepEqual(await readFile(source), bytes)
  })
})
