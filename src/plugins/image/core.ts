export interface ImagePlan {
  width: number
  height: number
  crop: { left: number, top: number, width: number, height: number }
  resized: boolean
  cropped: boolean
}

export function positiveInteger(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > 65536)
    throw new Error(`${label}需要为 1～65536 的整数。`)
  return number
}

export function planImage(width: number, height: number, size: number, upscale: boolean, multiple?: number): ImagePlan {
  if (width < 1 || height < 1)
    throw new Error('无法读取图片尺寸。')
  const scale = upscale ? size / Math.max(width, height) : Math.min(1, size / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const finalWidth = multiple ? targetWidth - targetWidth % multiple : targetWidth
  const finalHeight = multiple ? targetHeight - targetHeight % multiple : targetHeight
  if (finalWidth < 1 || finalHeight < 1)
    throw new Error(`${targetWidth}×${targetHeight} 无法裁切到 ${multiple} 的正整数倍。`)
  return {
    width: targetWidth,
    height: targetHeight,
    crop: { left: Math.floor((targetWidth - finalWidth) / 2), top: Math.floor((targetHeight - finalHeight) / 2), width: finalWidth, height: finalHeight },
    resized: targetWidth !== width || targetHeight !== height,
    cropped: finalWidth !== targetWidth || finalHeight !== targetHeight,
  }
}
