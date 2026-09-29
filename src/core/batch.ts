import type { CommandResult, ExecutionContext, Job, JobResult } from './types.js'
import { setImmediate } from 'node:timers/promises'

export async function runBatch(jobs: readonly Job[], outputDirectory: string, context: ExecutionContext, convert: (job: Job) => Promise<JobResult>): Promise<CommandResult> {
  const summary = { total: jobs.length, converted: 0, skipped: 0, failed: 0, cancelled: false, outputDirectory, results: [] as JobResult[] }
  if (!jobs.length)
    return { ok: false, error: { code: 'NO_FILES', message: '没有找到符合条件的文件。' } }
  context.onProgress?.({ phase: 'convert', completed: 0, total: jobs.length, message: '正在准备转换…' })
  for (const job of jobs) {
    await setImmediate()
    if (context.signal?.aborted)
      break
    context.onProgress?.({ phase: 'convert', completed: summary.results.length, total: jobs.length, source: job.source, message: `正在处理 ${job.source}` })
    let result: JobResult
    try {
      result = await convert(job)
    }
    catch (error) {
      if (context.signal?.aborted)
        break
      result = { ...job, status: 'failed', message: `失败 ${job.source}：${error instanceof Error ? error.message : String(error)}` }
    }
    summary[result.status]++
    summary.results.push(result)
    context.onProgress?.({ phase: 'convert', completed: summary.results.length, total: jobs.length, message: result.message, result })
  }
  summary.cancelled = context.signal?.aborted ?? false
  const message = `${summary.cancelled ? '已停止' : '已完成'}：成功 ${summary.converted}，跳过 ${summary.skipped}，失败 ${summary.failed}`
  if (summary.cancelled || summary.failed)
    return { ok: false, error: { code: summary.cancelled ? 'CANCELLED' : 'BATCH_FAILED', message }, summary }
  return { ok: true, message, summary }
}
