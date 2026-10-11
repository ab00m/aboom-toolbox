import type { ScreenshotPlan } from './core.js'
import { copyFile } from 'node:fs/promises'
import { extname } from 'node:path'

export type ScreenshotFormat = 'webp' | 'jpeg' | 'png' | 'original'

export async function readScreenshot(source: string) {
  const { default: sharp } = await import('sharp')
  const metadata = await sharp(source, { failOn: 'warning' }).metadata()
  const swap = (metadata.orientation ?? 0) >= 5
  return {
    width: (swap ? metadata.height : metadata.width) ?? 0,
    height: (swap ? metadata.width : metadata.height) ?? 0,
    orientation: metadata.orientation,
  }
}

export async function compressScreenshot(
  source: string,
  output: string,
  plan: ScreenshotPlan,
  format: ScreenshotFormat,
  quality: number,
  orientation?: number,
): Promise<void> {
  if (format === 'original' && !plan.resized && (!orientation || orientation === 1)) {
    await copyFile(source, output)
    return
  }

  const { default: sharp } = await import('sharp')
  let pipeline = sharp(source, { failOn: 'warning' }).rotate()
  if (plan.resized)
    pipeline = pipeline.resize(plan.width, plan.height, { fit: 'fill', kernel: 'lanczos3' })

  const sourceExtension = extname(source).toLowerCase()
  const outputFormat = format === 'original'
    ? sourceExtension === '.png' ? 'png' : sourceExtension === '.webp' ? 'webp' : 'jpeg'
    : format
  pipeline = outputFormat === 'png'
    ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
    : outputFormat === 'webp'
      ? pipeline.webp({ quality, effort: 5 })
      : pipeline.flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true })
  await pipeline.toFile(output)
}
