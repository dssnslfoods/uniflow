// Shrink a photo in the browser before upload: longest side ≤ maxSide, JPEG.
// Photos are for reference only, so ~1600 px is plenty and keeps uploads small on shop Wi-Fi.
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.8): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.fillStyle = '#fff'   // transparent PNGs become white, not black
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('image encode failed')
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}
