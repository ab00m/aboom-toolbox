import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { build } from 'tsdown'
import { projectDirectory, readMetadata } from './release-utils.mjs'

const outDir = resolve(projectDirectory, 'dist')
if (dirname(outDir) !== resolve(projectDirectory) || basename(outDir) !== 'dist')
  throw new Error('构建输出路径不在项目内。')
// 保留 dist 本身，避免 Windows 上终端将其作为工作目录时 EBUSY。
await mkdir(outDir, { recursive: true })
if ((await lstat(outDir)).isSymbolicLink())
  throw new Error('dist 不能是目录链接。')
for (const entry of await readdir(outDir))
  await rm(join(outDir, entry), { recursive: true, force: true })
const metadata = await readMetadata()

async function nodeBundle(entry, directory, name) {
  const shared = new Map([
    [join(projectDirectory, 'src/core/index.ts'), join(outDir, 'core.mjs')],
    [join(projectDirectory, 'src/tui/entry.ts'), join(outDir, 'tui.mjs')],
  ])
  await build({
    config: false,
    cwd: projectDirectory,
    entry: { [basename(name, '.mjs')]: resolve(projectDirectory, entry) },
    outDir: directory,
    clean: false,
    dts: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: true,
    sourcemap: false,
    fixedExtension: true,
    deps: { neverBundle: true, onlyBundle: [], onlyImport: Object.keys(metadata.dependencies) },
    plugins: [
      {
        name: 'toolbox-shared-entries',
        resolveId(id, importer) {
          if (!importer || !id.startsWith('.'))
            return
          const source = resolve(dirname(importer), id).replace(/\.js$/, '.ts')
          const target = shared.get(source)
          if (target)
            return { id: `./${relative(directory, target).replaceAll('\\', '/')}`, external: true }
        },
      },
      {
        name: 'toolbox-version',
        load(id) {
          if (resolve(id) === join(projectDirectory, 'package.json'))
            return JSON.stringify({ version: metadata.version })
        },
      },
    ],
    define: { 'process.env.NODE_ENV': '"production"', '__ABOOM_BUNDLED__': 'true' },
    outputOptions: { entryFileNames: name, codeSplitting: false, comments: { legal: true } },
  })
}

await nodeBundle('src/core/index.ts', outDir, 'core.mjs')
await nodeBundle('src/cli/index.ts', outDir, 'cli.mjs')
await nodeBundle('src/tui/entry.ts', outDir, 'tui.mjs')
const { validateManifest } = await import('../src/core/discovery.ts')
for (const folder of await readdir(join(projectDirectory, 'src/plugins'), { withFileTypes: true })) {
  if (!folder.isDirectory())
    continue
  const directory = join(projectDirectory, 'src/plugins', folder.name)
  const text = await readFile(join(directory, 'plugin.json'), 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!text)
    continue
  const parsed = JSON.parse(text)
  if (parsed.enabled === false)
    continue
  const manifest = validateManifest(parsed)
  const entry = await realpath(resolve(directory, manifest.entry))
  const root = await realpath(directory)
  if (!entry.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`))
    throw new Error(`插件入口越界：${manifest.name}`)
  const destination = join(outDir, 'plugins', folder.name)
  await mkdir(destination, { recursive: true })
  await nodeBundle(entry, destination, 'index.mjs')
  const { run: _run, ...description } = manifest
  await writeFile(join(destination, 'plugin.json'), `${JSON.stringify({ schemaVersion: 1, ...description, entry: 'index.mjs' }, null, 2)}\n`)
}
await chmod(join(outDir, 'cli.mjs'), 0o755)
console.log('tsdown 构建完成：Core、CLI、TUI 及目录插件；运行依赖由 npm 安装。')
