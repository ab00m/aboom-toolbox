import type { ToolCommand } from '../../core/types.js'
import { basename, extname } from 'node:path'
import { exists, runConversion } from '../../core/index.js'
import { compressScreenshot, readScreenshot } from './adapter.js'
import { screenshotPlan } from './core.js'

const screenshotPlugin: Pick<ToolCommand, 'run' | 'check'> = {
  async check() {
    try {
      await import('sharp')
      return { available: true, message: '图片压缩引擎已就绪。' }
    }
    catch {
      return { available: false, message: '图片压缩引擎不可用，请重新安装 npm 运行依赖。' }
    }
  },
  async run(options, context) {
    const quality = Number(options.quality)
    if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100)
      throw new Error('压缩质量需要为 1～100 的整数。')

    const format = options.format as 'webp' | 'jpeg' | 'png' | 'original'
    const outputExtension = format === 'webp' ? '.webp' : format === 'jpeg' ? '.jpg' : format === 'png' ? '.png' : undefined
    return runConversion(options, context, {
      sourceExtension: ['.png', '.jpg', '.jpeg', '.webp'],
      targetExtension: '',
      async prepare(job) {
        const metadata = await readScreenshot(job.source)
        const plan = screenshotPlan(metadata.width, metadata.height)
        const sourceExtension = extname(job.output)
        const extension = outputExtension ?? sourceExtension
        return { name: `${basename(job.output, sourceExtension)}${extension}`, data: { metadata, plan } }
      },
      async preview(job) {
        const { metadata, plan } = job.data
        return `预览 ${job.source}：${metadata.width}×${metadata.height} → ${plan.width}×${plan.height}（不裁切）→ ${job.output}${await exists(job.output) && options.overwrite !== true ? '（已有结果，将跳过）' : ''}`
      },
      async write(job, temporary) {
        const { metadata, plan } = job.data
        await compressScreenshot(job.source, temporary, plan, format, quality, metadata.orientation)
        return `${metadata.width}×${metadata.height} → ${plan.width}×${plan.height}，${format} Q${quality}`
      },
    })
  },
}

export default screenshotPlugin
