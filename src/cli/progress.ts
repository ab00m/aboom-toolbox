import type { WriteStream } from 'node:tty'
import type { ProgressEvent } from '../core/types.js'
import { basename } from 'node:path'
import process from 'node:process'

interface ProgressOptions {
  stream?: Pick<WriteStream, 'write' | 'isTTY' | 'columns'>
  enabled?: boolean
  quiet?: boolean
  json?: boolean
  now?: () => number
  term?: string
}

/** stdout 留给结果；TTY 原地刷新，管道只输出完整行。 */
export function createProgress(options: ProgressOptions = {}) {
  const stream = options.stream ?? process.stderr
  const now = options.now ?? Date.now
  const started = now()
  const enabled = !options.json && !options.quiet && options.enabled !== false
  const interactive = enabled && stream.isTTY && (options.term ?? process.env.TERM) !== 'dumb'
  let latest: ProgressEvent | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let active = false
  let closed = false
  // eslint-disable-next-line no-control-regex -- 文件名和插件消息不能注入终端控制字符。
  const safe = (text: string) => text.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
  const clear = () => {
    if (active) {
      stream.write('\r\x1B[2K')
      active = false
    }
  }
  const line = (event?: ProgressEvent) => {
    const percent = event?.total ? Math.floor(event.completed / event.total * 100) : 0
    const elapsed = ((now() - started) / 1000).toFixed(1)
    const width = stream.columns ?? 80
    const barWidth = Math.max(0, Math.min(20, width - 42))
    const filled = Math.floor(barWidth * percent / 100)
    const bar = barWidth ? ` [${'='.repeat(filled)}${' '.repeat(barWidth - filled)}]` : ''
    const counts = !event || event.phase === 'scan' ? '扫描文件…' : event.phase === 'prepare' ? `准备计划 (${event.completed}/${event.total})` : `${percent}% (${event.completed}/${event.total})`
    return `处理文件:${bar} ${counts}, ${elapsed}s`
  }
  const draw = () => {
    if (!interactive || closed)
      return
    clear()
    // 进度条采用 ASCII；文件名在独立记录中显示，避免破坏刷新行。
    stream.write(line(latest))
    active = true
  }
  return {
    start() {
      if (interactive && !timer) {
        draw()
        timer = setInterval(draw, 100)
        timer.unref()
      }
    },
    update(event: ProgressEvent) {
      if (closed || options.json)
        return
      latest = event
      if (event.result && (!options.quiet || event.result.status === 'failed')) {
        clear()
        const prefix = enabled && !interactive ? `处理文件: ${Math.floor(event.completed / event.total * 100)}% (${event.completed}/${event.total}) ` : ''
        stream.write(`${prefix}${safe(event.message)}\n`)
      }
      else if (enabled && !interactive && event.completed === 0 && !event.source && (!event.phase || event.phase === 'convert')) {
        stream.write(`处理文件: 0% (0/${event.total}) ${safe(event.message)}\n`)
      }
      else if (interactive && event.source && (!event.phase || event.phase === 'convert')) {
        clear()
        stream.write(`开始处理: ${safe(basename(event.source))}\n`)
      }
      draw()
    },
    finish() {
      if (closed)
        return
      closed = true
      if (timer)
        clearInterval(timer)
      clear()
      if (enabled && latest)
        stream.write(`${line(latest)}\n`)
    },
  }
}
