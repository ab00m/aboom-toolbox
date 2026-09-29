import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { it } from 'node:test'
import { withTemporaryDirectory } from '../scripts/release-utils.mjs'
import { checkAvailability, discoverPlugins, validateManifest } from '../src/core/index.ts'
import { checkFfmpeg } from '../src/plugins/audio/adapter.ts'

const description = { schemaVersion: 1, name: 'example', version: '1.0.0', title: '示例工具', description: '实际发现的插件', entry: 'index.mjs', fields: [] }

it('选项说明保留字符串 choices，拒绝重复/无效说明，检测异常可读', async () => {
  const field = { key: 'preset', label: '预设', description: '', type: 'select', choices: ['table', 'sfx'], default: 'table', choiceDescriptions: { table: '通用', sfx: '音效' } }
  assert.deepEqual(validateManifest({ ...description, fields: [field] }).fields[0], field)
  for (const invalid of [
    { ...field, choices: ['table', 'table'] },
    { ...field, choiceDescriptions: { missing: '无效' } },
    { ...field, choiceDescriptions: { table: false } },
    { ...field, type: 'text' },
  ]) {
    assert.throws(() => validateManifest({ ...description, fields: [invalid] }), /选项/)
  }
  assert.deepEqual(await checkAvailability({ check: () => {
    throw new Error('同步检测失败')
  } }, {}), { available: false, message: '同步检测失败' })
})

async function plugin(directory, name, manifest = description, code = 'export default { run: async () => ({ ok: true, message: "已执行" }) }') {
  const folder = join(directory, name)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(join(folder, 'index.mjs'), code)
}

it('只从有描述信息的目录发现插件，支持新增、移除和空目录', async () => {
  await withTemporaryDirectory(async (directory) => {
    assert.deepEqual((await discoverPlugins(directory)).commands, [])
    await mkdir(join(directory, 'ignored'))
    await writeFile(join(directory, 'ignored', 'index.mjs'), 'throw new Error("不应执行")')
    await plugin(directory, 'first')
    let catalog = await discoverPlugins(directory)
    assert.deepEqual(catalog.commands.map(tool => tool.name), ['example'])
    assert.equal(catalog.commands[0].title, '示例工具')
    assert.deepEqual(await catalog.commands[0].run({}, {}), { ok: true, message: '已执行' })
    await writeFile(join(directory, 'first', 'plugin.json'), JSON.stringify({ ...description, enabled: false }))
    assert.equal((await discoverPlugins(directory)).commands.length, 0)
    await writeFile(join(directory, 'first', 'plugin.json'), JSON.stringify(description))
    await rm(join(directory, 'first', 'plugin.json'))
    catalog = await discoverPlugins(directory)
    assert.equal(catalog.commands.length, 0)
    assert.equal(catalog.issues.length, 0)
  })
})

it('隔离坏描述、重复名称、缺少入口与越界入口，不影响正常插件', async () => {
  await withTemporaryDirectory(async (directory) => {
    await plugin(directory, 'a-valid')
    await plugin(directory, 'b-duplicate')
    await plugin(directory, 'c-invalid', { ...description, name: 'invalid', fields: [{ key: 'x', label: '字段', description: '', type: 'select', choices: [] }] })
    await plugin(directory, 'd-missing', { ...description, name: 'missing', entry: 'missing.mjs' })
    await writeFile(join(directory, 'outside.mjs'), 'throw new Error("越界代码不应执行")')
    await plugin(directory, 'e-outside', { ...description, name: 'outside', entry: '../outside.mjs' })
    await plugin(directory, 'f-broken', { ...description, name: 'broken' }, 'export default {}')
    const catalog = await discoverPlugins(directory)
    assert.deepEqual(catalog.commands.map(tool => tool.name), ['example'])
    assert.equal(catalog.issues.length, 5)
    assert.match(catalog.issues[0].message, /重复/)
    assert.match(catalog.issues[3].message, /目录内/)
  })
})

it('指定不存在的 FFmpeg 时明确不可用，不回退到其他本地程序', async () => {
  await withTemporaryDirectory(async (directory) => {
    const status = await checkFfmpeg(join(directory, 'missing-ffmpeg.exe'))
    assert.equal(status.available, false)
    assert.match(status.message, /无法运行/)
    assert.equal(status.executable, undefined)
  })
})

it('FFmpeg 自动检测真实本地程序，并可通过显式路径复用', async () => {
  const status = await checkFfmpeg()
  if (status.available) {
    assert.ok(status.executable)
    assert.equal((await checkFfmpeg(`"${status.executable}"`)).available, true)
  }
  else {
    assert.match(status.message, /不可用.*未找到/)
  }
})
