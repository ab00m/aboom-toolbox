import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'src/cli/index.ts')
const build = join(root, 'scripts/build.mjs')

async function exists(path) {
  return access(path).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))
}

const [hasSource, hasBuild] = await Promise.all([exists(source), exists(build)])
if (hasSource !== hasBuild)
  throw new Error('源码或构建入口缺失，无法准备 Git 安装。')
if (hasSource)
  await import(pathToFileURL(build).href)
