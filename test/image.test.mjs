import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { it } from 'node:test'
import sharp from 'sharp'
import { withTemporaryDirectory } from '../scripts/release-utils.mjs'
import { executeCommand } from '../src/core/index.ts'
import { commands } from './tool-catalog.mjs'

const image = commands.find(tool => tool.name === 'image')

async function fixture(path, width = 83, height = 47) {
  await sharp({ create: { width, height, channels: 4, background: { r: 170, g: 90, b: 40, alpha: 0.5 } } }).png().toFile(path)
  return readFile(path)
}

it('真实 PNG 等比缩放后裁切到 4 的倍数，保持透明和源文件不变，默认跳过及覆盖可用', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'sample.png')
    const bytes = await fixture(source)
    const output = join(directory, 'out')
    const options = { 'input': source, output, 'size': '40', 'crop-multiple': true }
    const result = await executeCommand(image, options)
    assert.equal(result.ok, true, JSON.stringify(result))
    const file = join(output, 'sample@40@clip.png')
    const metadata = await sharp(file).metadata()
    assert.equal(metadata.width, 40)
    assert.equal(metadata.height, 20)
    assert.equal(metadata.hasAlpha, true)
    assert.deepEqual(await readFile(source), bytes)
    assert.equal((await executeCommand(image, options)).summary.skipped, 1)
    await writeFile(file, 'existing')
    assert.equal((await executeCommand(image, { ...options, overwrite: true })).summary.converted, 1)
    assert.equal((await sharp(file).metadata()).height, 20)
  })
})

it('小图默认原样复制，开启放大可达到目标最长边；JPG 保持格式', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'small.jpg')
    await sharp({ create: { width: 10, height: 20, channels: 3, background: '#7a4930' } }).jpeg().toFile(source)
    const bytes = await readFile(source)
    const options = { input: source, output: join(directory, 'out'), size: '40' }
    assert.equal((await executeCommand(image, options)).ok, true)
    assert.deepEqual(await readFile(join(options.output, 'small.jpg')), bytes)
    assert.equal((await executeCommand(image, { ...options, 'allow-upscale': true })).ok, true)
    const metadata = await sharp(join(options.output, 'small@40.jpg')).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, 20)
    assert.equal(metadata.height, 40)
  })
})

it('居中裁切移除边缘像素，EXIF 自动旋转后计算尺寸', async () => {
  await withTemporaryDirectory(async (directory) => {
    const raw = Buffer.alloc(15 * 11 * 3)
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 15; x++) {
        raw[(y * 15 + x) * 3] = x
        raw[(y * 15 + x) * 3 + 1] = y
      }
    }
    const source = join(directory, 'center.png')
    await sharp(raw, { raw: { width: 15, height: 11, channels: 3 } }).png().toFile(source)
    const options = { 'input': source, 'output': join(directory, 'out'), 'crop-multiple': true }
    assert.equal((await executeCommand(image, options)).ok, true)
    const { data, info } = await sharp(join(options.output, 'center@clip.png')).raw().toBuffer({ resolveWithObject: true })
    assert.equal(info.width, 12)
    assert.equal(info.height, 8)
    assert.deepEqual([...data.subarray(0, 3)], [1, 1, 0])
    const jpeg = join(directory, 'rotated.jpeg')
    await sharp(raw, { raw: { width: 15, height: 11, channels: 3 } }).jpeg().withMetadata({ orientation: 6 }).toFile(jpeg)
    assert.equal((await executeCommand(image, { input: jpeg, output: options.output, size: '8' })).ok, true)
    const metadata = await sharp(join(options.output, 'rotated@8.jpeg')).metadata()
    assert.equal(metadata.width, 6)
    assert.equal(metadata.height, 8)
    assert.equal(metadata.orientation, undefined)
  })
})

it('预览不写入，递归排除输出目录；坏文件按文件报告，合法文件继续处理', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = join(directory, 'out')
    await mkdir(join(directory, 'nested'))
    await fixture(join(directory, 'nested', 'good.png'))
    const preview = await executeCommand(image, { 'input': directory, output, 'recursive': true, 'dry-run': true, 'size': '40' })
    assert.equal(preview.ok, true)
    assert.equal(preview.summary.converted, 0)
    assert.match(preview.summary.results[0].message, /预览.*40×23/)
    await assert.rejects(access(output), { code: 'ENOENT' })
    await mkdir(output)
    await fixture(join(output, 'excluded.png'))
    await writeFile(join(directory, 'broken.png'), 'broken')
    const result = await executeCommand(image, { input: directory, output, recursive: true, size: '40' })
    assert.equal(result.ok, false)
    assert.equal(result.summary.total, 2)
    assert.equal(result.summary.failed, 1)
    assert.equal(result.summary.converted, 1)
    assert.equal((await sharp(join(output, 'nested', 'good@40.png')).metadata()).width, 40)
  })
})

it('拒绝非法尺寸、无法裁切的小图及带后缀的输出冲突', async () => {
  await withTemporaryDirectory(async (directory) => {
    const source = join(directory, 'sample.png')
    await fixture(source)
    const output = join(directory, 'out')
    for (const size of ['0', '2.5', '12abc', '65537'])
      assert.equal((await executeCommand(image, { input: source, output, size })).ok, false)
    await fixture(join(directory, 'tiny.png'), 1, 1)
    const tiny = await executeCommand(image, { 'input': join(directory, 'tiny.png'), output, 'crop-multiple': true })
    assert.equal(tiny.summary.failed, 1)
    await fixture(join(directory, 'sample@40.png'), 40, 23)
    const collision = await executeCommand(image, { input: directory, output, size: '40', overwrite: true })
    assert.equal(collision.ok, false)
    assert.match(collision.error.detail, /同名结果/)
    await assert.rejects(access(output), { code: 'ENOENT' })
  })
})
