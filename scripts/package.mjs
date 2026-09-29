import { join } from 'node:path'
import spawn from 'cross-spawn'
import { projectDirectory, readMetadata } from './release-utils.mjs'

// 测试已先构建，跳过 prepack，避免重复检查或递归调用测试。
export async function createPackage(directory) {
  const metadata = await readMetadata()
  const result = spawn.sync('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', directory], {
    cwd: projectDirectory,
    encoding: 'utf8',
    timeout: 30000,
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`npm 包生成失败：${result.stderr || result.stdout}`)
  return join(directory, `${metadata.name}-${metadata.version}.tgz`)
}
