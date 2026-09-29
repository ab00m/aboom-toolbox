import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createProgress } from '../src/cli/progress.ts'
import { executeCommand } from '../src/core/index.ts'

it('CLI 进度：TTY 原地刷新，管道普通文本，关闭/静默/JSON，取消不补 100%', () => {
  for (const mode of ['tty', 'pipe', 'off', 'quiet', 'json']) {
    let output = ''
    const stream = { isTTY: mode === 'tty', columns: 80, write(text) {
      output += text
    } }
    const progress = createProgress({ stream, term: 'xterm', enabled: mode !== 'off', quiet: mode === 'quiet', json: mode === 'json', now: () => 1000 })
    progress.start()
    progress.update({ completed: 0, total: 2, message: '准备' })
    progress.update({ completed: 0, total: 2, message: '正在处理', source: '/a.xlsx' })
    progress.update({ completed: 1, total: 2, message: '成功\u001B[31m', result: { source: '/a.xlsx', output: '/a.json', status: 'converted', message: '成功' } })
    progress.finish()
    progress.finish()
    assert.doesNotMatch(output, /100%/)
    assert.equal(output.includes('\u001B[31m'), false)
    if (mode === 'json' || mode === 'quiet')
      assert.equal(output, '')
    else if (mode === 'off')
      assert.doesNotMatch(output, /处理文件:/)
    else
      assert.match(output, /50% \(1\/2\)/)
    if (mode === 'pipe')
      assert.equal(output.includes('\u001B') || output.includes('\r'), false)
    if (mode === 'tty')
      assert.equal(output.includes('\r\u001B[2K'), true)
  }
  let errors = ''
  const quiet = createProgress({ quiet: true, stream: { write(text) {
    errors += text
  } } })
  quiet.update({ completed: 1, total: 1, message: '失败', result: { source: '/bad', output: '/out', status: 'failed', message: '失败' } })
  quiet.finish()
  assert.equal(errors, '失败\n')
})

it('共享执行入口支持异步成功结果', async () => {
  const result = await executeCommand({
    name: 'example',
    description: '测试工具',
    async run() {
      return { ok: true, message: '完成' }
    },
  })
  assert.deepEqual(result, { ok: true, message: '完成' })
})

it('共享执行入口将抛出和拒绝的异常转为结构化错误', async () => {
  for (const run of [
    () => { throw new Error('同步失败') },
    async () => { throw new Error('异步失败') },
  ]) {
    const result = await executeCommand({ name: 'example', description: '测试工具', run })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'COMMAND_FAILED')
    assert.match(result.error.detail, /失败/)
  }
})
