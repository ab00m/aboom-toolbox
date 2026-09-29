import type { ConversionPaths } from './files.js'
import type { CommandResult, ExecutionContext, Job, ToolOptions } from './types.js'
import { readdir, rmdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { runBatch } from './batch.js'
import { atomicOutput, collectJobs, reserveOutputDirectory, resolveConversionPaths, validateJobs } from './files.js'

export interface PreparedJob<T> extends Job {
  data: T
}

export interface ConversionSpec<T = undefined> {
  sourceExtension: string | readonly string[]
  targetExtension: string
  ignoreOfficeTemporary?: boolean
  prepare?: (job: Job) => Promise<{ name?: string, data: T }>
  beforeRun?: (jobs: readonly Job[], context: ExecutionContext, paths: ConversionPaths) => Promise<void>
  write: (job: PreparedJob<T>, temporary: string) => Promise<string | void>
  preview?: (job: PreparedJob<T>) => string | Promise<string>
}

/** 仅移除空目录；已完成文件和其他进程生成的文件保留。 */
async function removeEmptyDirectories(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT')
      throw error
    return []
  })) {
    if (entry.isDirectory())
      await removeEmptyDirectories(join(directory, entry.name))
  }
  await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code ?? ''))
      throw error
  })
}

/** 插件提供规则和写入，Core 统一负责批次生命周期。 */
export async function runConversion<T = undefined>(options: ToolOptions, context: ExecutionContext, spec: ConversionSpec<T>): Promise<CommandResult> {
  context.signal?.throwIfAborted()
  context.onProgress?.({ phase: 'scan', completed: 0, total: 0, message: '正在扫描输入文件…' })
  const paths = await resolveConversionPaths(options)
  const jobs = await collectJobs(paths.input, paths.output, {
    sourceExtension: spec.sourceExtension,
    targetExtension: spec.targetExtension,
    recursive: options.recursive === true,
    ignoreOfficeTemporary: spec.ignoreOfficeTemporary ?? false,
    validate: false,
    ...(context.signal ? { signal: context.signal } : {}),
  })
  if (!jobs.length)
    return runBatch(jobs, paths.output, context, async () => { throw new Error('没有可执行的文件') })
  const prepared = new Map<string, T | Error>()
  for (const [index, job] of jobs.entries()) {
    context.signal?.throwIfAborted()
    context.onProgress?.({ phase: 'prepare', completed: index, total: jobs.length, source: job.source, message: '正在准备文件计划…' })
    try {
      const plan = spec.prepare ? await spec.prepare({ ...job }) : { data: undefined as T }
      if (plan.name !== undefined) {
        if (!plan.name || basename(plan.name) !== plan.name || plan.name === '.' || plan.name === '..')
          throw new Error('文件计划需要有效的输出文件名。')
        job.output = join(dirname(job.output), plan.name)
      }
      prepared.set(job.source, plan.data)
    }
    catch (error) {
      context.signal?.throwIfAborted()
      prepared.set(job.source, error instanceof Error ? error : new Error(String(error)))
    }
  }
  await validateJobs(jobs)
  const preview = options['dry-run'] === true && spec.preview !== undefined
  const ready = jobs.filter(job => !(prepared.get(job.source) instanceof Error))
  if (!preview && ready.length)
    await spec.beforeRun?.(ready, context, paths)
  context.signal?.throwIfAborted()
  let output = paths.output
  let reserved = false
  try {
    if (paths.automatic && !preview && ready.length) {
      output = await reserveOutputDirectory(paths.root, context.signal, paths.outputGrowO)
      reserved = true
      for (const job of jobs)
        job.output = join(output, relative(paths.output, job.output))
    }
    return await runBatch(jobs, output, context, async (job) => {
      const data = prepared.get(job.source)
      if (data instanceof Error)
        throw data
      const file = { ...job, data: data as T }
      if (preview)
        return { ...job, status: 'skipped', message: await spec.preview!(file) }
      let detail = ''
      const status = await atomicOutput(job, options.overwrite === true, context.signal, async (temporary) => {
        detail = await spec.write(file, temporary) ?? ''
      })
      return { ...job, status, message: status === 'skipped' ? `跳过已有文件：${job.output}` : `已生成 ${job.output}${detail ? `（${detail}）` : ''}` }
    })
  }
  finally {
    if (reserved)
      await removeEmptyDirectories(output)
  }
}
