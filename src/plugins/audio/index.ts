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
