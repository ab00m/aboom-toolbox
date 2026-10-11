import assert from 'node:assert/strict'
import { it } from 'node:test'
import { githubReleaseInfo } from '../scripts/github-release.mjs'

const metadata = { name: 'aboom-toolbox', version: '0.1.0', repository: { url: 'git+https://github.com/ab00m/aboom-toolbox.git' } }

it('GitHub Release 固定附件名使 latest 地址跨版本不变，固定版本地址独立', () => {
  const current = githubReleaseInfo(metadata)
  const next = githubReleaseInfo({ ...metadata, version: '0.2.0' })
  assert.equal(current.repository, 'ab00m/aboom-toolbox')
  assert.equal(current.asset, 'aboom-toolbox.tgz')
  assert.equal(current.latestUrl, 'https://github.com/ab00m/aboom-toolbox/releases/latest/download/aboom-toolbox.tgz')
  assert.equal(current.latestUrl, next.latestUrl)
  assert.equal(current.downloadUrl, 'https://github.com/ab00m/aboom-toolbox/releases/download/v0.1.0/aboom-toolbox.tgz')
  assert.notEqual(current.downloadUrl, next.downloadUrl)
})

it('预发布版本不会被识别为最新稳定版，其他站点不能作为 GitHub 发布目标', () => {
  assert.equal(githubReleaseInfo(metadata).isPrerelease, false)
  assert.equal(githubReleaseInfo({ ...metadata, version: '0.2.0-rc.1' }).isPrerelease, true)
  for (const url of ['https://example.com/ab00m/aboom-toolbox.git', 'https://github.com/ab00m', 'http://github.com/ab00m/aboom-toolbox.git'])
    assert.throws(() => githubReleaseInfo({ ...metadata, repository: { url } }), /GitHub HTTPS/)
})
