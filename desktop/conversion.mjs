/** Keeps selected paths in the privileged process, not in renderer requests. */
export function createImageConversion(command, executeCommand) {
  let input = ''
  let output = ''
  let running
  return {
    setPath(kind, value) {
      if (running)
        throw new Error('请等待当前操作完成。')
      if (kind === 'output')
        output = value
      else
        input = value
    },
    cancel() {
      running?.abort()
    },
    async run(payload, onProgress) {
      if (running)
        throw new Error('已有任务正在进行。')
      if (!input)
        throw new Error('请先选择图片或输入文件夹。')
      const { size, dryRun, recursive } = payload ?? {}
      if (typeof size !== 'string' || !/^[1-9]\d{0,4}$/.test(size) || Number(size) > 16384
        || typeof dryRun !== 'boolean' || typeof recursive !== 'boolean') {
        throw new Error('最长边必须是 1–16384 的整数。')
      }
      running = new AbortController()
      try {
        return await executeCommand(command, { input, output, size, recursive, 'dry-run': dryRun, 'overwrite': false }, { signal: running.signal, onProgress })
      }
      finally {
        running = undefined
      }
    },
  }
}
