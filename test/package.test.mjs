import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { it } from 'node:test'
import { verifyConversions } from '../scripts/conversion-smoke.mjs'
import { createPackage } from '../scripts/package.mjs'
import { checkReleaseState } from '../scripts/release-check.mjs'
import { projectDirectory, withTemporaryDirectory } from '../scripts/release-utils.mjs'
import { inspectPackage, verifyRelease } from '../scripts/verify-release.mjs'

it('生产构建仅包含项目代码、入口与插件描述，运行依赖保持外置', async () => {
  assert.deepEqual((await readdir(join(projectDirectory, 'dist'))).sort(), ['cli.mjs', 'core.mjs', 'plugins', 'tui.mjs'])
  const cli = await readFile(join(projectDirectory, 'dist/cli.mjs'), 'utf8')
  assert.ok(cli.startsWith('#!/usr/bin/env node\n'))
  assert.match(cli, /from["']commander["']/)
  assert.doesNotMatch(cli, /@antfu\/eslint-config|devDependencies|sourceMappingURL=|yoga-layout|react-reconciler/)
  const tui = await readFile(join(projectDirectory, 'dist/tui.mjs'), 'utf8')
  assert.match(tui, /from["']ink["']/)
  assert.match(tui, /from["']react(?:\/jsx-runtime)?["']/)
  const image = await readFile(join(projectDirectory, 'dist/plugins/image/index.mjs'), 'utf8')
  assert.match(image, /import\(["'`]sharp["'`]\)/)
  const excel = await readFile(join(projectDirectory, 'dist/plugins/excel/index.mjs'), 'utf8')
  assert.match(excel, /from["']read-excel-file\/node["']/)
})

it('标准 npm TGZ 保留依赖且可在仓库外安装、启动和真实转换', { timeout: 240000 }, async () => {
  await withTemporaryDirectory(async (directory) => {
    const tarball = await createPackage(directory)
    const { manifest } = await verifyRelease(tarball)
    assert.equal(manifest.bin.aboom, './dist/cli.mjs')
    assert.equal(manifest.dependencies.sharp, JSON.parse(await readFile(join(projectDirectory, 'package.json'), 'utf8')).dependencies.sharp)
  })
})

it('npm files 白名单排除构建目录中的依赖、日志和调试摘要', async () => {
  const probe = join(projectDirectory, 'dist/build-info.json')
  try {
    await writeFile(probe, '{}\n')
    await withTemporaryDirectory(async (directory) => {
      const { entries } = await inspectPackage(await createPackage(directory))
      assert.ok(entries.every(entry => !/build-info|node_modules|\.map$/.test(entry.path)))
    })
  }
  finally {
    const { unlink } = await import('node:fs/promises')
    await unlink(probe)
  }
})

it('转换验收遵循实际插件目录，空目录不要求默认模块存在', async () => {
  await withTemporaryDirectory(async (directory) => {
    await verifyConversions(join(projectDirectory, 'dist/cli.mjs'), directory, { ABOOM_PLUGIN_DIR: directory })
    assert.deepEqual(await readdir(directory), [])
  })
})

it('本地发布检查验证工作区与可选标签提交', () => {
  const state = { version: '1.2.3', dirty: false, tag: 'v1.2.3', head: 'abc', tagCommit: 'abc' }
  assert.doesNotThrow(() => checkReleaseState(state))
  assert.doesNotThrow(() => checkReleaseState({ ...state, tag: undefined, tagCommit: undefined }))
  assert.throws(() => checkReleaseState({ ...state, dirty: true }), /工作区/)
  assert.throws(() => checkReleaseState({ ...state, tag: 'v1.2.2' }), /标签/)
  assert.throws(() => checkReleaseState({ ...state, tagCommit: 'def' }), /提交/)
})
