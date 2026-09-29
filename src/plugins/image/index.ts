import type { ToolCommand } from '../../core/types.js'
import type { ImagePlan } from './core.js'
import { basename, extname } from 'node:path'
import { exists, runConversion } from '../../core/index.js'
import { readImage, writeImage } from './adapter.js'
import { planImage, positiveInteger } from './core.js'

const imagePlugin: Pick<ToolCommand, 'run' | 'check'> = {
  async check() {
    try {
      await import('sharp')
      return { available: true, message: '图片处理引擎已就绪。' }
    }
    catch {
      return { available: false, message: '图片处理引擎不可用，请重新安装 npm 运行依赖。' }
    }
  },
  async run(options, context) {
    const size = positiveInteger(options.size, '最长边')
    const multiple = positiveInteger(options.multiple, '裁切倍数')
    return runConversion<{ metadata: Awaited<ReturnType<typeof readImage>>, plan: ImagePlan }>(options, context, {
      sourceExtension: ['.png', '.jpg', '.jpeg'],
      targetExtension: '',
      async prepare(job) {
        const metadata = await readImage(job.source)
        const plan = planImage(metadata.width, metadata.height, size, options['allow-upscale'] === true, options['crop-multiple'] === true ? multiple : undefined)
        const extension = extname(job.output)
        const suffix = `${plan.resized ? `@${size}` : ''}${plan.cropped ? '@clip' : ''}`
        return { name: `${basename(job.output, extension)}${suffix}${extension}`, data: { metadata, plan } }
      },
      async preview(job) {
        const { metadata, plan } = job.data
        return `预览 ${job.source}：${metadata.width}×${metadata.height} → ${plan.crop.width}×${plan.crop.height} → ${job.output}${await exists(job.output) && options.overwrite !== true ? '（已有结果，将跳过）' : ''}`
      },
      async write(job, temporary) {
        const { metadata, plan } = job.data
        await writeImage(job.source, temporary, plan, metadata.orientation)
        return `${metadata.width}×${metadata.height} → ${plan.crop.width}×${plan.crop.height}`
      },
    })
  },
}

export default imagePlugin
