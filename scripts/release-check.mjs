import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { projectDirectory, readMetadata } from './release-utils.mjs'

export function checkReleaseState({ version, dirty, tag, head, tagCommit }) {
  if (dirty)
    throw new Error('发布前必须提交或妥善处理工作区改动；本命令不会自动提交')
  if (tag && tag !== `v${version}`)
    throw new Error(`发布标签必须与 package.json 版本一致: v${version}`)
  if (tag && head !== tagCommit)
    throw new Error('发布标签未指向当前构建提交')
}

function git(args) {
  const result = spawnSync('git', args, { cwd: projectDirectory, encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error('无法读取 Git 发布状态，请检查当前提交与标签')
  return result.stdout.trim()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const program = new Command().option('--tag <tag>', '校验已存在的发布标签').parse()
  const { tag } = program.opts()
  const { version } = await readMetadata()
  if (tag && tag !== `v${version}`)
    throw new Error(`发布标签必须与 package.json 版本一致: v${version}`)
  checkReleaseState({
    version,
    dirty: Boolean(git(['status', '--porcelain'])),
    tag,
    head: git(['rev-parse', 'HEAD']),
    tagCommit: tag ? git(['rev-parse', `${tag}^{commit}`]) : undefined,
  })
  console.log(`发布状态检查通过: ${tag ?? version}`)
}
