import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { minVersion, satisfies, valid } from 'semver'

export const projectDirectory = fileURLToPath(new URL('../', import.meta.url))

export async function readMetadata() {
  const metadata = JSON.parse(await readFile(join(projectDirectory, 'package.json'), 'utf8'))
  if (valid(metadata.version) !== metadata.version)
    throw new Error('package.json 必须包含有效的 SemVer 版本号')
  if (!/^[a-z0-9-]+$/.test(metadata.name))
    throw new Error('当前单包工具的名称必须是小写字母、数字或连字符')
  if (!minVersion(metadata.engines.node) || !satisfies(process.versions.node, metadata.engines.node))
    throw new Error(`需要 Node.js ${metadata.engines.node}，当前为 ${process.version}`)
  return metadata
}

export async function withTemporaryDirectory(action) {
  const directory = await mkdtemp(join(tmpdir(), 'aboom-release-'))
  if (dirname(directory) !== resolve(tmpdir()))
    throw new Error('临时目录不在系统临时目录内')
  try {
    return await action(directory)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}
