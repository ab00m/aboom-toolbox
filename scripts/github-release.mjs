import { copyFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import spawn from 'cross-spawn'
import { prerelease } from 'semver'
import { checkReleaseState } from './release-check.mjs'
import { projectDirectory, readMetadata, withTemporaryDirectory } from './release-utils.mjs'
import { verifyRelease } from './verify-release.mjs'

export function githubReleaseInfo(metadata) {
  const repository = new URL(metadata.repository.url.replace(/^git\+/, ''))
  const path = repository.pathname.replace(/\.git$/, '').replace(/^\//, '')
  if (repository.protocol !== 'https:' || repository.hostname !== 'github.com' || !/^[\w.-]+\/[\w.-]+$/.test(path))
    throw new Error('GitHub 分发要求 repository.url 为 GitHub HTTPS 仓库地址')
  const tag = `v${metadata.version}`
  const asset = `${metadata.name}.tgz`
  const base = `https://github.com/${path}/releases`
  return {
    repository: path,
    tag,
    asset,
    tarball: join(projectDirectory, 'release', `${metadata.name}-${metadata.version}.tgz`),
    releaseUrl: `${base}/tag/${tag}`,
    downloadUrl: `${base}/download/${tag}/${asset}`,
    latestUrl: `${base}/latest/download/${asset}`,
    isPrerelease: prerelease(metadata.version) !== null,
  }
}

function run(command, args) {
  const result = spawn.sync(command, args, { cwd: projectDirectory, encoding: 'utf8', timeout: 180000 })
  if (result.error || result.status !== 0)
    throw new Error(`${command} 执行失败：${result.error?.message || result.stderr || result.stdout}`)
  return result.stdout.trim()
}

export async function publishGithubRelease({ dryRun = false } = {}) {
  const metadata = await readMetadata()
  const info = githubReleaseInfo(metadata)
  if (dryRun) {
    console.log(JSON.stringify(info, null, 2))
    return info
  }
  const head = run('git', ['rev-parse', 'HEAD'])
  checkReleaseState({ version: metadata.version, dirty: Boolean(run('git', ['status', '--porcelain'])), head })
  const remoteHead = run('git', ['ls-remote', `https://github.com/${info.repository}.git`, 'refs/heads/main']).split(/\s/)[0]
  if (remoteHead !== head)
    throw new Error('先将当前发布提交推送到 GitHub main；本命令不会自动提交或推送')
  const remoteTag = run('git', ['ls-remote', `https://github.com/${info.repository}.git`, `refs/tags/${info.tag}`, `refs/tags/${info.tag}^{}`])
  if (remoteTag) {
    const refs = remoteTag.split('\n').map(line => line.trim().split(/\s+/))
    const tagCommit = refs.find(([, ref]) => ref.endsWith('^{}'))?.[0] ?? refs[0][0]
    checkReleaseState({ version: metadata.version, dirty: false, tag: info.tag, head, tagCommit })
  }
  run('gh', ['auth', 'status'])
  await verifyRelease(info.tarball)
  await withTemporaryDirectory(async (directory) => {
    // 固定附件名使 latest 安装地址跨版本保持有效；仅复制已验收 TGZ，不重新打包。
    const asset = join(directory, info.asset)
    await copyFile(info.tarball, asset)
    const notes = join(directory, 'release-notes.md')
    await writeFile(notes, `安装此版本：\n\n\`\`\`console\nnpm install --global "${info.downloadUrl}"\naboom tui\n\`\`\`\n\n需要 Node.js ${metadata.engines.node} 及 npm；音频转换另需 FFmpeg。\n`)
    run('gh', ['release', 'create', info.tag, asset, '--repo', info.repository, '--target', head, '--title', `Aboom Toolbox ${metadata.version}`, '--notes-file', notes, ...(info.isPrerelease ? ['--prerelease', '--latest=false'] : ['--latest'])])
  })
  console.log(`GitHub Release 已发布：${info.releaseUrl}`)
  await verifyRelease(info.tarball, { installSource: info.downloadUrl })
  console.log(`远程安装验收通过：npm install --global "${info.downloadUrl}"`)
  if (!info.isPrerelease)
    console.log(`最新稳定版：npm install --global "${info.latestUrl}"`)
  return info
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const program = new Command().option('--dry-run', '仅显示发布计划，不构建、不上传').parse()
  await publishGithubRelease(program.opts())
}
