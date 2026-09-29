import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { expectedTable, wavBytes, workbookBytes } from '../scripts/conversion-smoke.mjs'
import { withTemporaryDirectory } from '../scripts/release-utils.mjs'

const cliArguments = ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/cli/index.ts', import.meta.url))]
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

function runCli(...args) {
  return spawnSync(process.execPath, [...cliArguments, ...args], { encoding: 'utf8' })
}

it('CLI 配置驱动通用 Excel，进度/关闭/静默/JSON 输出隔离', async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(join(directory, 'sample.xlsx'), workbookBytes([['说明'], ['编号', '数值'], [7], [8, '2.5']]))
    await writeFile(join(directory, 'format.json'), JSON.stringify({ headerRow: 2, columns: { id: { header: '编号', type: 'integer', required: true }, value: { header: '数值', type: 'number', default: 10 } } }))
    await writeFile(join(directory, 'aboom.config.json'), JSON.stringify({ schemaVersion: 1, tools: { excel: { preset: 'table', schema: 'format.json' } } }))
    for (const [mode, flags] of [['progress', ['--progress']], ['off', ['--no-progress']], ['quiet', ['--quiet']], ['json', ['--json', '--progress', '--quiet']]]) {
      const result = spawnSync(process.execPath, [...cliArguments, 'excel', '--config', join(directory, 'aboom.config.json'), '--output', 'aboom_output', '--overwrite', ...flags], { cwd: directory, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'aboom_output', 'sample.json'), 'utf8')), [{ id: 7, value: 10 }, { id: 8, value: 2.5 }])
      assert.equal(result.stderr.includes('\u001B') || result.stderr.includes('\r'), false)
      if (mode === 'progress')
        assert.match(result.stderr, /100% \(1\/1\)/)
      if (mode === 'off') {
        assert.doesNotMatch(result.stderr, /处理文件:/)
        assert.match(result.stderr, /已生成/)
      }
      if (mode === 'quiet') {
        assert.equal(result.stdout, '')
        assert.equal(result.stderr, '')
      }
      if (mode === 'json') {
        assert.equal(JSON.parse(result.stdout).summary.converted, 1)
        assert.equal(result.stderr, '')
      }
    }
    const invalid = spawnSync(process.execPath, [...cliArguments, 'excel', '--preset', 'missing'], { cwd: directory, encoding: 'utf8' })
    assert.equal(invalid.status, 1)
  })
})

it('CLI 和配置切换自动目录命名，显式布尔参数优先且不影响指定目录', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'sample.xlsx')
    const bytes = workbookBytes()
    await writeFile(source, bytes)
    const config = join(directory, 'defaults.json')
    await writeFile(config, JSON.stringify({ schemaVersion: 1, tools: { excel: { 'output-grow-o': false } } }))
    const runs = [
      [[], 'aboom_output'],
      [[], 'aboom_output1'],
      [['--output-grow-o'], 'abooom_output'],
      [['--output-grow-o', '--no-output-grow-o'], 'aboom_output2'],
      [[], 'aboom_output3'],
      [['--output', 'chosen'], 'chosen'],
    ]
    for (const [flags, name] of runs) {
      const result = spawnSync(process.execPath, [...cliArguments, 'excel', '--input', source, '--config', config, '--json', ...flags], { cwd: directory, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      const parsed = JSON.parse(result.stdout)
      assert.equal(parsed.ok, true)
      assert.equal(parsed.summary.outputDirectory, join(directory, name))
      assert.deepEqual(JSON.parse(await readFile(parsed.summary.results[0].output, 'utf8')), expectedTable)
    }
    assert.deepEqual(await readFile(source), bytes)
  })
})

it('根帮助列出 TUI 和工具命令', () => {
  const result = runCli('--help')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /aboom \[命令\]/)
  assert.match(result.stdout, /tui/)
  assert.match(result.stdout, /excel/)
  assert.match(result.stdout, /audio/)
  assert.doesNotMatch(result.stdout, /启动本地 Web|\bweb\b/)
})

it('非交互环境无参数启动输出帮助', () => {
  const result = runCli()
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Aboom Toolbox/)
  assert.match(result.stdout, /用法:/)
})

it('非交互环境显式 TUI 返回可读错误', () => {
  const result = runCli('tui')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /TUI 需要交互终端/)
  assert.doesNotMatch(result.stderr, /Raw mode/)
})

it('TUI 帮助无需交互终端', () => {
  const result = runCli('tui', '--help')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /aboom tui/)
})

it('版本与 package.json 一致', () => {
  const result = runCli('--version')
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), version)
})

for (const name of ['excel', 'audio']) {
  it(`${name} 帮助可用`, () => {
    const result = runCli(name, '--help')
    assert.equal(result.status, 0)
    assert.match(result.stdout, new RegExp(`aboom ${name}`))
    assert.match(result.stdout, /default: "\."/)
    assert.match(result.stdout, /留空在输入目录下新建 aboom_output/)
  })

  it(`${name} 不指定输入时扫描当前目录，空目录返回可读错误`, async () => {
    await withTemporaryDirectory(async (directory) => {
      const result = spawnSync(process.execPath, [...cliArguments, name], { cwd: directory, encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /没有找到符合条件的文件/)
    })
  })

  it(`${name} 默认路径及留空路径生成新目录，递归排除历次结果`, { skip: name === 'audio' && !process.env.ABOOM_TEST_FFMPEG }, async () => {
    await withTemporaryDirectory(async (directory) => {
      const oldOutput = join(directory, 'aboom_output')
      const extension = name === 'excel' ? 'xlsx' : 'wav'
      const bytes = name === 'excel' ? workbookBytes() : wavBytes()
      await writeFile(join(directory, `sample.${extension}`), bytes)
      await mkdir(oldOutput)
      await writeFile(join(oldOutput, `excluded.${extension}`), bytes)
      const dependency = name === 'audio' ? ['--ffmpeg', process.env.ABOOM_TEST_FFMPEG] : []
      for (const [paths, folder] of [[[], 'abooom_output'], [['--input', '  ', '--output', '  '], 'aboooom_output']]) {
        const result = spawnSync(process.execPath, [...cliArguments, name, ...paths, ...dependency, '--recursive', '--json'], { cwd: directory, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        const { summary } = JSON.parse(result.stdout)
        assert.equal(summary.total, 1)
        assert.equal(summary.outputDirectory, join(directory, folder))
        assert.equal(summary.converted, 1)
        if (name === 'excel')
          assert.deepEqual(JSON.parse(await readFile(summary.results[0].output, 'utf8')), expectedTable)
      }
      assert.deepEqual(await readFile(join(directory, `sample.${extension}`)), bytes)
    })
  })

  it(`${name} 异地启动时默认输出跟随输入文件或目录，指定目录按原规则处理`, { skip: name === 'audio' && !process.env.ABOOM_TEST_FFMPEG }, async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourceDirectory = join(directory, 'source')
      await mkdir(sourceDirectory)
      const source = join(sourceDirectory, name === 'excel' ? 'sample.xlsx' : 'sample.wav')
      await writeFile(source, name === 'excel' ? workbookBytes() : wavBytes())
      const dependency = name === 'audio' ? ['--ffmpeg', process.env.ABOOM_TEST_FFMPEG] : []
      for (const [input, folder] of [[source, 'aboom_output'], [sourceDirectory, 'abooom_output']]) {
        const result = spawnSync(process.execPath, [...cliArguments, name, '--input', input, ...dependency, '--json'], { cwd: directory, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        const { summary } = JSON.parse(result.stdout)
        assert.equal(summary.outputDirectory, join(sourceDirectory, folder))
        assert.equal(summary.total, 1)
      }
      const output = join(directory, 'custom')
      const args = [...cliArguments, name, '--input', source, '--output', 'custom', ...dependency, '--json']
      for (const skipped of [0, 1]) {
        const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        const { summary } = JSON.parse(result.stdout)
        assert.equal(summary.outputDirectory, output)
        assert.equal(summary.skipped, skipped)
      }
    })
  })

  it(`${name} 不接受未声明的选项或参数`, () => {
    for (const argument of ['--unknown', 'input.wav']) {
      const result = runCli(name, argument)
      assert.equal(result.status, 1)
      assert.doesNotMatch(result.stderr, /请填写有效的输入路径/)
    }
  })
}

it('未知命令返回失败状态', () => {
  const result = runCli('unknown')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /未知命令/)
})

it('图片 CLI 连字符参数：预览不写入，放大与居中裁切传到插件', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'sample.png')
    await sharp({ create: { width: 13, height: 8, channels: 3, background: '#709064' } }).png().toFile(source)
    const args = ['image', '--size', '40', '--allow-upscale', '--crop-multiple', '--multiple', '4', '--json']
    const preview = spawnSync(process.execPath, [...cliArguments, ...args, '--dry-run'], { cwd: directory, encoding: 'utf8' })
    assert.equal(preview.status, 0, preview.stderr)
    assert.equal(JSON.parse(preview.stdout).summary.converted, 0)
    assert.match(JSON.parse(preview.stdout).summary.results[0].message, /预览.*40×24/)
    const result = spawnSync(process.execPath, [...cliArguments, ...args], { cwd: directory, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const metadata = await sharp(join(directory, 'aboom_output', 'sample@40@clip.png')).metadata()
    assert.equal(metadata.width, 40)
    assert.equal(metadata.height, 24)
  })
})
