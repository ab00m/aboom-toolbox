import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { access, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import { list } from 'tar'
import { verifyConversions } from './conversion-smoke.mjs'
import { projectDirectory, readMetadata, withTemporaryDirectory } from './release-utils.mjs'

function run(command, args, directory, environment = {}, timeout = 30000) {
  const result = spawn.sync(command, args, {
    cwd: directory,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', ABOOM_PLUGIN_DIR: '', ...environment },
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
  })
  if (result.error)
    throw result.error
  return result
}

function expectResult(result, status, text) {
  if (result.status !== status || !`${result.stdout}${result.stderr}`.includes(text))
    throw new Error(`安装运行验收失败：${(result.stderr || result.stdout).slice(0, 4000)}`)
}

export async function inspectPackage(tarball, metadata) {
  metadata ??= await readMetadata()
  const entries = []
  const contents = new Map()
  await list({
    file: tarball,
    strict: true,
    onReadEntry(entry) {
      entries.push({ path: entry.path, type: entry.type, mode: entry.mode })
      const chunks = []
      entry.on('data', chunk => chunks.push(chunk))
      entry.on('end', () => contents.set(entry.path, Buffer.concat(chunks)))
    },
  })
  const expected = ['package.json', 'README.md', 'LICENSE', 'dist/core.mjs', 'dist/cli.mjs', 'dist/tui.mjs']
  for (const folder of await readdir(join(projectDirectory, 'dist/plugins'))) {
    expected.push(`dist/plugins/${folder}/index.mjs`, `dist/plugins/${folder}/plugin.json`)
  }
  assert.deepEqual(entries.map(entry => entry.path).sort(), expected.map(name => `package/${name}`).sort(), 'npm 包文件白名单不一致')
  assert.ok(entries.every(entry => entry.type === 'File'), 'npm 包只能包含普通文件')
  assert.ok(entries.find(entry => entry.path === 'package/dist/cli.mjs').mode & 0o111, 'CLI 缺少 Unix 可执行权限')
  const manifest = JSON.parse(contents.get('package/package.json').toString('utf8'))
  assert.equal(manifest.name, metadata.name)
  assert.equal(manifest.version, metadata.version)
  assert.equal(manifest.private, undefined, 'npm 包不能标记为 private')
  assert.equal(manifest.type, 'module')
  assert.deepEqual(manifest.engines, metadata.engines)
  assert.deepEqual(manifest.bin, metadata.bin)
  assert.deepEqual(manifest.dependencies, metadata.dependencies, 'npm 安装所需的运行依赖必须保留')
  assert.equal(manifest.bundleDependencies, undefined)
  assert.equal(manifest.bundledDependencies, undefined)
  for (const name of expected.filter(name => name.startsWith('dist/')))
    assert.deepEqual(contents.get(`package/${name}`), await readFile(join(projectDirectory, name)), `npm 包与当前构建不一致：${name}`)
  return { manifest, entries }
}

export async function verifyRelease(tarball) {
  const metadata = await readMetadata()
  tarball = resolve(tarball ?? join(projectDirectory, 'release', `${metadata.name}-${metadata.version}.tgz`))
  const inspected = await inspectPackage(tarball, metadata)
  await withTemporaryDirectory(async (directory) => {
    const prefix = join(directory, 'install')
    const install = run('npm', ['install', '--global', '--no-audit', '--no-fund', '--prefix', prefix, '--cache', join(directory, 'npm-cache'), tarball], directory, {}, 180000)
    expectResult(install, 0, 'added')
    const packageDirectory = process.platform === 'win32' ? join(prefix, 'node_modules', metadata.name) : join(prefix, 'lib/node_modules', metadata.name)
    const cli = join(packageDirectory, 'dist/cli.mjs')
    const shim = process.platform === 'win32' ? join(prefix, 'aboom.cmd') : join(prefix, 'bin/aboom')
    await access(shim)
    for (const [args, text] of [['--version', metadata.version], ['--help', 'Aboom Toolbox']])
      expectResult(run(shim, [args], directory), 0, text)
    const discovered = run(process.execPath, [cli, 'plugins', '--json'], directory)
    expectResult(discovered, 0, 'tools')
    const expectedTools = await Promise.all(inspected.entries.filter(entry => /dist\/plugins\/[^/]+\/plugin\.json$/.test(entry.path)).map(async (entry) => {
      const manifest = JSON.parse(await readFile(join(packageDirectory, entry.path.slice('package/'.length)), 'utf8'))
      return manifest.name
    }))
    assert.deepEqual(JSON.parse(discovered.stdout).tools.map(tool => tool.name).sort(), expectedTools.sort())
    for (const [args, status, text] of [
      [['tui'], 1, 'TUI 需要交互终端'],
      [['web'], 1, '未知命令'],
      [['config', 'show'], 0, 'effective'],
    ])
      expectResult(run(process.execPath, [cli, ...args], directory), status, text)
    expectResult(run(process.execPath, [join(dirname(cli), 'tui.mjs')], directory), 1, 'TUI 需要交互终端')
    const workspace = join(directory, 'work')
    await mkdir(workspace)
    await verifyConversions(cli, workspace, { ABOOM_PLUGIN_DIR: '' })
  })
  return inspected
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyRelease(process.argv[2])
  console.log('npm 包验收通过：文件白名单、运行依赖、隔离安装、命令启动及真实转换。')
}
