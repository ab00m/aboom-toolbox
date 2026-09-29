import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { withTemporaryDirectory } from '../scripts/release-utils.mjs'
import { applyConfig, createConfig, discoverPlugins, loadConfig, resolveOptions, validateConfig } from '../src/core/index.ts'

// eslint-disable-next-line antfu/no-top-level-await -- 配置测试使用实际插件契约。
const { commands } = await discoverPlugins()
const cli = ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/cli/index.ts', import.meta.url))]

function run(directory, args, environment = {}) {
  return spawnSync(process.execPath, [...cli, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ABOOM_CONFIG: '', ...environment },
  })
}

it('参数优先级保留显式 false、空字符串和连字符字段，TUI 使用相同默认值', () => {
  const image = commands.find(command => command.name === 'image')
  const config = validateConfig({ schemaVersion: 1, tools: { image: { 'size': '80', 'allow-upscale': true, 'output': 'pictures' } } }, commands)
  const options = resolveOptions(image, { 'allow-upscale': false, 'output': '' }, config)
  assert.equal(options.size, '80')
  assert.equal(options['allow-upscale'], false)
  assert.equal(options.output, '')
  assert.equal(options.multiple, '4')
  const configured = applyConfig(commands, config).find(command => command.name === 'image')
  assert.equal(resolveOptions(configured).size, '80')
  assert.equal(resolveOptions(configured)['allow-upscale'], true)
  assert.equal(resolveOptions(image).size, '2048')
})

it('拒绝配置版本、未知插件/字段、错误类型和枚举，不悄悄回退', () => {
  for (const config of [
    { schemaVersion: 2, tools: {} },
    { schemaVersion: 1, tools: {}, extra: true },
    { schemaVersion: 1, tools: { unknown: {} } },
    { schemaVersion: 1, tools: { audio: { to: 'invalid' } } },
    { schemaVersion: 1, tools: { image: { size: 80 } } },
    { schemaVersion: 1, tools: { excel: { recursive: 'true' } } },
    { schemaVersion: 1, tools: { excel: { typo: true } } },
    { schemaVersion: 1, tools: { image: { size: '' } } },
  ])
    assert.throws(() => validateConfig(config, commands), /配置/)
})

it('生成配置后可读取，已有文件不会被覆盖；显式缺失和损坏文件报错，支持 BOM', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'nested', 'defaults.json')
    await createConfig(commands, path)
    const original = await readFile(path, 'utf8')
    const generated = (await loadConfig(commands, path)).config
    assert.equal(generated.tools.audio.to, 'FLAC')
    for (const command of commands)
      assert.equal(generated.tools[command.name]['output-grow-o'], true)
    await assert.rejects(createConfig(commands, path), /EEXIST/)
    assert.equal(await readFile(path, 'utf8'), original)
    await assert.rejects(loadConfig(commands, join(directory, 'missing.json')), /无法读取配置/)
    await writeFile(path, '{ broken')
    await assert.rejects(loadConfig(commands, path), /配置.*无效/)
    await writeFile(path, `\uFEFF${original}`)
    assert.equal((await loadConfig(commands, path)).exists, true)
  })
})

it('CLI 项目配置覆盖用户配置；显式路径覆盖环境变量；缺少默认配置可运行', async () => {
  await withTemporaryDirectory(async (directory) => {
    const userRoot = join(directory, 'user')
    const userPath = process.platform === 'win32'
      ? join(userRoot, 'AboomToolbox', 'config.json')
      : join(userRoot, 'aboom', 'config.json')
    await mkdir(join(userPath, '..'), { recursive: true })
    const defaults = size => JSON.stringify({ schemaVersion: 1, tools: { image: { size } } })
    const environment = { APPDATA: userRoot, XDG_CONFIG_HOME: userRoot }
    // 删除继承的 ABOOM_CONFIG，让默认路径探测真实生效。
    const invoke = (args, env = {}) => spawnSync(process.execPath, [...cli, ...args], { cwd: directory, encoding: 'utf8', env: { ...process.env, ...environment, ...env, ABOOM_CONFIG: env.ABOOM_CONFIG } })
    const empty = invoke(['config', 'show'])
    assert.equal(empty.status, 0, empty.stderr)
    assert.equal(JSON.parse(empty.stdout).exists, false)
    await writeFile(userPath, defaults('80'))
    assert.equal(JSON.parse(invoke(['config', 'show']).stdout).effective.image.size, '80')
    await writeFile(join(directory, 'aboom.config.json'), defaults('40'))
    assert.equal(JSON.parse(invoke(['config', 'show']).stdout).effective.image.size, '40')
    const explicit = join(directory, 'custom.json')
    await writeFile(explicit, defaults('20'))
    const selected = invoke(['config', 'show', '--config', explicit], { ABOOM_CONFIG: userPath })
    assert.equal(selected.status, 0, selected.stderr)
    assert.equal(JSON.parse(selected.stdout).effective.image.size, '20')
    assert.equal(JSON.parse(invoke(['config', 'show'], { ABOOM_CONFIG: userPath }).stdout).effective.image.size, '80')
  })
})

it('CLI 动态插件读取默认参数，正反布尔开关和显式参数可覆盖配置', async () => {
  await withTemporaryDirectory(async (directory) => {
    const plugins = join(directory, 'plugins')
    const folder = join(plugins, 'example')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'plugin.json'), JSON.stringify({
      schemaVersion: 1,
      name: 'example',
      version: '1.0.0',
      description: '参数回显',
      entry: 'index.mjs',
      fields: [
        { key: 'label', label: '标签', description: '', type: 'text', default: 'builtin' },
        { key: 'feature-enabled', label: '开关', description: '', type: 'boolean', default: false },
      ],
    }))
    await writeFile(join(folder, 'index.mjs'), 'export default { run: (options) => ({ ok: true, message: JSON.stringify(options) }) }')
    const config = join(directory, 'defaults.json')
    await writeFile(config, JSON.stringify({ schemaVersion: 1, tools: { example: { 'label': 'configured', 'feature-enabled': true } } }))
    for (const [args, expected] of [
      [[], { 'label': 'configured', 'feature-enabled': true }],
      [['--label', '', '--no-feature-enabled'], { 'label': '', 'feature-enabled': false }],
      [['--no-feature-enabled', '--feature-enabled'], { 'label': 'configured', 'feature-enabled': true }],
    ]) {
      const result = run(directory, ['example', '--json', '--config', config, ...args], { ABOOM_PLUGIN_DIR: plugins })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(JSON.parse(result.stdout).message), expected)
    }
    const initialized = run(directory, ['config', 'init', '--config', join(directory, 'new.json')], { ABOOM_PLUGIN_DIR: plugins })
    assert.equal(initialized.status, 0, initialized.stderr)
    assert.equal(JSON.parse(await readFile(join(directory, 'new.json'), 'utf8')).tools.example.label, 'builtin')
  })
})

it('损坏配置不阻止帮助，但执行会在运行插件前失败', async () => {
  await withTemporaryDirectory(async (directory) => {
    const config = join(directory, 'broken.json')
    await writeFile(config, '{ broken')
    assert.equal(run(directory, ['image', '--help', '--config', config]).status, 0)
    const failed = run(directory, ['image', '--config', config])
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /配置.*无效/)
  })
})
