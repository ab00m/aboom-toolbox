import type { ImagePlan } from './core.js'
import { copyFile } from 'node:fs/promises'
import { extname } from 'node:path'

export async function readImage(source: string) {
  const { default: sharp } = await import('sharp')
  const metadata = await sharp(source, { failOn: 'warning' }).metadata()
  // EXIF 方向为横竖交换时，以自动校正后的尺寸计算。
  const swap = (metadata.orientation ?? 0) >= 5
  return { width: (swap ? metadata.height : metadata.width) ?? 0, height: (swap ? metadata.width : metadata.height) ?? 0, orientation: metadata.orientation }
}

export async function writeImage(source: string, output: string, plan: ImagePlan, orientation?: number): Promise<void> {
  if (!plan.resized && !plan.cropped && (!orientation || orientation === 1)) {
    await copyFile(source, output)
    return
  }
  const { default: sharp } = await import('sharp')
  let pipeline = sharp(source, { failOn: 'warning' }).rotate()
  if (plan.resized)
    pipeline = pipeline.resize(plan.width, plan.height, { fit: 'fill', kernel: 'lanczos3' })
  if (plan.cropped)
    pipeline = pipeline.extract(plan.crop)
  pipeline = extname(source).toLowerCase() === '.png'
    ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
    : pipeline.jpeg({ quality: 92, mozjpeg: true })
  await pipeline.toFile(output)
}
