import type { Job, ToolOptions } from './types.js'
import { randomUUID } from 'node:crypto'
import { access, link, lstat, mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

export function normalizePath(value: string): string {
  let path = value.trim().replace(/^"(.*)"$/s, '$1')
  if (!path.trim())
    throw new Error('路径不能为空。')
  if (path === '~')
    path = homedir()
  else if (/^~[/\\]/.test(path))
    path = join(homedir(), path.slice(2))
  return resolve(path)
}

export function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
    const parent = dirname(path)
    if (parent === path)
      throw error
    return join(await canonical(parent), basename(path))
  }
}

export const conversionPathDefaults = { 'input': '.', 'output': '', 'output-grow-o': true } as const

export interface ConversionPaths {
  input: string
  root: string
  output: string
  automatic: boolean
  outputGrowO: boolean
}

async function occupied(path: string): Promise<boolean> {
  return lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT')
      throw error
    return false
  })
}

function automaticName(root: string, index: number, growO: boolean): string {
  return join(root, growO ? `ab${'o'.repeat(index + 2)}m_output` : `aboom_output${index || ''}`)
}

export async function resolveConversionPaths(options: ToolOptions): Promise<ConversionPaths> {
  const clean = (value: unknown) => String(value ?? '').trim().replace(/^"(.*)"$/s, '$1').trim()
  const input = await realpath(normalizePath(clean(options.input) || conversionPathDefaults.input)).catch(() => {
    throw new Error(`输入路径不存在：${options.input || '.'}`)
  })
  const info = await stat(input)
  if (!info.isFile() && !info.isDirectory())
    throw new Error('输入路径不是文件或文件夹。')
  const root = info.isFile() ? dirname(input) : input
  const explicit = clean(options.output)
  const outputGrowO = (options['output-grow-o'] ?? conversionPathDefaults['output-grow-o']) !== false
  let output = explicit ? normalizePath(explicit) : automaticName(root, 0, outputGrowO)
  if (!explicit) {
    let index = 0
    while (await occupied(output))
      output = automaticName(root, ++index, outputGrowO)
  }
  return { input, root, output: await canonical(output), automatic: !explicit, outputGrowO }
}

/** mkdir 独占本次目录，避免并发任务复用同一路径。 */
export async function reserveOutputDirectory(root: string, signal?: AbortSignal, growO: boolean = conversionPathDefaults['output-grow-o']): Promise<string> {
  for (let index = 0; ; index++) {
    signal?.throwIfAborted()
    const output = automaticName(root, index, growO)
    try {
      await mkdir(output)
      return output
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error
    }
  }
}

export async function collectJobs(input: string, output: string, options: {
  sourceExtension: string | readonly string[]
  targetExtension: string
  recursive?: boolean
  ignoreOfficeTemporary?: boolean
  signal?: AbortSignal
  validate?: boolean
}): Promise<Job[]> {
  const source = await realpath(normalizePath(input)).catch(() => {
    throw new Error(`输入路径不存在：${input}`)
  })
  const destination = await canonical(normalizePath(output))
  const info = await stat(source)
  const root = info.isFile() ? dirname(source) : source
  const files: string[] = []
  const extensions = typeof options.sourceExtension === 'string' ? [options.sourceExtension] : options.sourceExtension
  const matches = (path: string) => extensions.includes(extname(path).toLowerCase())
    && (!options.ignoreOfficeTemporary || !basename(path).startsWith('~$'))

  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      options.signal?.throwIfAborted()
      const path = join(directory, entry.name)
      if (entry.isDirectory() && /^(?:abo{2,}m_output|aboom_output[1-9]\d*)$/i.test(entry.name))
        continue
      if (destination !== root && inside(root, destination) && inside(destination, path))
        continue
      // 不追踪链接目录；避免环路和扫描范围外文件。
      if (entry.isDirectory() && options.recursive)
        await scan(path)
      else if (entry.isFile() && matches(path))
        files.push(path)
    }
  }
  if (info.isFile()) {
    if (!matches(source))
      throw new Error(`文件格式不受支持：${basename(source)}`)
    files.push(source)
  }
  else if (info.isDirectory()) {
    await scan(source)
  }
  else {
    throw new Error('输入路径不是文件或文件夹。')
  }

  const jobs: Job[] = []
  for (const file of files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    const name = relative(root, file)
    const candidate = join(destination, name.slice(0, -extname(name).length) + (options.targetExtension || extname(name)))
    // 保留输出文件本身，避免把链接目标误当成被授权覆盖的文件。
    const outputPath = join(await canonical(dirname(candidate)), basename(candidate))
    jobs.push({ source: file, output: outputPath })
  }
  if (options.validate !== false)
    await validateJobs(jobs)
  return jobs
}

export async function validateJobs(jobs: readonly Job[]): Promise<void> {
  const sources = new Set(jobs.map(job => pathKey(job.source)))
  const destinations = new Set<string>()
  for (const job of jobs) {
    job.output = join(await canonical(dirname(job.output)), basename(job.output))
    if (sources.has(pathKey(await canonical(job.output))))
      throw new Error(`输出文件会覆盖输入文件：${job.source}`)
    const key = pathKey(job.output)
    if (destinations.has(key))
      throw new Error(`不同输入文件会生成同名结果：${job.output}`)
    destinations.add(key)
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
    return false
  }
}

/** 失败/取消保留旧结果；默认模式不会覆盖并发生成的文件。 */
export async function atomicOutput(job: Job, overwrite: boolean, signal: AbortSignal | undefined, write: (temporary: string) => Promise<void>): Promise<'converted' | 'skipped'> {
  if (!overwrite && await exists(job.output))
    return 'skipped'
  await mkdir(dirname(job.output), { recursive: true })
  const temporary = join(dirname(job.output), `.${basename(job.output, extname(job.output))}.${randomUUID()}.tmp${extname(job.output)}`)
  try {
    signal?.throwIfAborted()
    await write(temporary)
    signal?.throwIfAborted()
    const outputInfo = await lstat(job.output).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        throw error
      return null
    })
    if (outputInfo?.isSymbolicLink())
      throw new Error('输出位置为符号链接，无法写入。')
    const inputInfo = await stat(job.source)
    if (outputInfo && outputInfo.dev === inputInfo.dev && outputInfo.ino === inputInfo.ino)
      throw new Error('输出文件与输入文件指向同一文件。')
    if (overwrite) {
      await rename(temporary, job.output)
    }
    else {
      try {
        await link(temporary, job.output)
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          return 'skipped'
        throw error
      }
    }
    return 'converted'
  }
  finally {
    await rm(temporary, { force: true })
  }
}
