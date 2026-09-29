import type { ToolAvailability } from '../../core/types.js'
import { spawn } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import process from 'node:process'
import { normalizePath } from '../../core/files.js'

/** 仅执行参数数组；不经 shell，不要求 Python 或原项目存在。 */
export async function runFfmpeg(executable: string, args: readonly string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let stdout = ''
    const timer = args[0] === '-version' ? setTimeout(() => child.kill(), 3000) : undefined
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted)
      stop()
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8192)
    })
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + String(chunk)).slice(-8192)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', stop)
      clearTimeout(timer)
      if (signal?.aborted)
        reject(new Error('已取消转换。'))
      else if (code !== 0)
        reject(new Error(stderr.trim() || `FFmpeg 退出码 ${code}`))
      else if (args[0] === '-version' && !/ffmpeg version/i.test(`${stdout}\n${stderr}`))
        reject(new Error('程序未返回 FFmpeg 版本信息。'))
      else resolve()
    })
  })
}

export async function ffmpegCandidates(environment: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = (environment.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path.replace(/^"|"$/g, ''), executable))
  if (process.platform === 'win32') {
    const home = environment.USERPROFILE || homedir()
    candidates.push(
      join(home, 'scoop/apps/ffmpeg/current/bin/ffmpeg.exe'),
      join(home, 'scoop/apps/ffmpeg/current/ffmpeg.exe'),
      join(home, 'AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'),
      join(environment.ProgramFiles || 'C:/Program Files', 'ffmpeg/bin/ffmpeg.exe'),
      join(environment['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Duplicate Cleaner 5/ffmpeg.exe'),
      'C:/ffmpeg/bin/ffmpeg.exe',
    )
    // 只检查 WinGet 的 FFmpeg 包目录，不递归扫描用户磁盘。
    const winget = join(home, 'AppData/Local/Microsoft/WinGet/Packages')
    for (const entry of await readdir(winget, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/ffmpeg/i.test(entry.name))
        continue
      const root = join(winget, entry.name)
      candidates.push(join(root, 'bin/ffmpeg.exe'))
      for (const child of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (child.isDirectory())
          candidates.push(join(root, child.name, 'bin/ffmpeg.exe'))
      }
    }
  }
  else {
    candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg')
  }
  return [...new Set(candidates)]
}

export async function checkFfmpeg(explicit = '', signal?: AbortSignal): Promise<ToolAvailability> {
  const configured = explicit.trim() || process.env.ABOOM_FFMPEG?.trim()
  const clean = configured?.replace(/^"(.*)"$/s, '$1')
  const candidates = clean
    ? [isAbsolute(clean) || /[/\\]/.test(clean) ? normalizePath(clean) : clean]
    : await ffmpegCandidates()
  for (const executable of candidates) {
    signal?.throwIfAborted()
    try {
      if (isAbsolute(executable))
        await access(executable)
      await runFfmpeg(executable, ['-version'], signal)
      return { available: true, executable, message: `已找到 FFmpeg：${executable}` }
    }
    catch (error) {
      if (signal?.aborted)
        throw error
    }
  }
  return { available: false, message: configured ? `指定的 FFmpeg 无法运行：${clean}。请修正路径后重新检测。` : '音频转换不可用：未找到本地 FFmpeg。请安装 FFmpeg 或填写程序路径后重新检测。' }
}

export async function resolveFfmpeg(explicit: string, signal?: AbortSignal): Promise<string> {
  const status = await checkFfmpeg(explicit, signal)
  if (!status.available || !status.executable)
    throw new Error(`${status.message} 可通过 --ffmpeg、ABOOM_FFMPEG 或 PATH 指定。`)
  return status.executable
}
