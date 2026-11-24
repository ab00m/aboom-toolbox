import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { createImageConversion } from '../desktop/conversion.mjs'
import { discoverPlugins, executeCommand } from '../src/core/index.ts'

const payload = { size: '12', dryRun: true, recursive: false }

test('桌面预览不写文件，正式缩放通过同一个图片插件，原图不变', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aboom-desktop-'))
  try {
    const original = join(root, '示例.png')
    await sharp({ create: { width: 24, height: 16, channels: 3, background: '#d25727' } }).png().toFile(original)
    const originalBytes = await readFile(original)
    const { commands } = await discoverPlugins()
    const command = commands.find(item => item.name === 'image')
    assert.ok(command)
    const conversion = createImageConversion(command, executeCommand)
    await assert.rejects(conversion.run(payload), /先选择/)
    conversion.setPath('file', original)
    await assert.rejects(conversion.run({ ...payload, size: '0' }), /整数/)
    const preview = await conversion.run(payload, () => {})
    assert.equal(preview.ok, true)
    assert.match(preview.summary.results[0].message, /24×16 → 12×8/)
    assert.deepEqual(await readdir(root), ['示例.png'])
    const output = await conversion.run({ ...payload, dryRun: false }, () => {})
    assert.equal(output.ok, true)
    const metadata = await sharp(output.summary.results[0].output).metadata()
    assert.equal(metadata.width, 12)
    assert.equal(metadata.height, 8)
    assert.deepEqual(await readFile(original), originalBytes)
    conversion.setPath('output', output.summary.outputDirectory)
    const second = await conversion.run({ ...payload, dryRun: false, overwrite: true }, () => {})
    assert.equal(second.summary.skipped, 1)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('桌面一次只跑一批，丢弃非允许参数，取消信号传入 Core', async () => {
  const conversion = createImageConversion({}, async (_command, options, { signal }) => {
    assert.equal(options.input, '/native/input')
    assert.equal(options.overwrite, false)
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return { ok: false, error: { code: 'CANCELLED' } }
  })
  conversion.setPath('folder', '/native/input')
  const running = conversion.run({ ...payload, input: '/renderer/input', overwrite: true }, () => {})
  await assert.rejects(conversion.run(payload), /正在进行/)
  assert.throws(() => conversion.setPath('output', '/native/output'), /等待/)
  conversion.cancel()
  assert.equal((await running).error.code, 'CANCELLED')
})
