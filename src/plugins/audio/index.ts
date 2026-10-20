import type { ToolCommand } from '../../core/types.js'
import type { AudioFormat } from './core.js'
import { exists, runConversion } from '../../core/index.js'
import { checkFfmpeg, resolveFfmpeg, runFfmpeg } from './adapter.js'
import { audioArguments } from './core.js'

const audioPlugin: Pick<ToolCommand, 'run' | 'check'> = {
  check: options => checkFfmpeg(String(options?.ffmpeg ?? '')),
  async run(options, context) {
    const target = options.to as AudioFormat
    let executable: string | undefined
    return runConversion(options, context, {
      sourceExtension: `.${String(options.from).toLowerCase()}`,
      targetExtension: `.${target.toLowerCase()}`,
      async preview(job) {
        return `预览 ${job.source}：${options.from} → ${target} → ${job.output}${await exists(job.output) && options.overwrite !== true ? '（已有结果，将跳过）' : ''}（仅文件计划，未验证音频内容或 FFmpeg）`
      },
      async beforeRun(jobs, _context, paths) {
        if (paths.automatic || options.overwrite === true || (await Promise.all(jobs.map(job => exists(job.output)))).some(value => !value))
          executable = await resolveFfmpeg(String(options.ffmpeg ?? ''), context.signal)
      },
      async write(job, temporary) {
        await runFfmpeg(executable!, audioArguments(job.source, temporary, target), context.signal)
      },
    })
  },
}

export default audioPlugin
