export interface ScreenshotPlan {
  width: number
  height: number
  resized: boolean
}

export function screenshotPlan(width: number, height: number): ScreenshotPlan {
  if (width < 1 || height < 1)
    throw new Error('无法读取图片尺寸。')

  const scale = Math.min(1, 1080 / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  return { width: targetWidth, height: targetHeight, resized: targetWidth !== width || targetHeight !== height }
}
