function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function visibleImageBounds(img: HTMLImageElement): {
  x: number
  y: number
  width: number
  height: number
} {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  context.drawImage(img, 0, 0, canvas.width, canvas.height)

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width
  let top = canvas.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right >= left && bottom >= top
    ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
    : { x: 0, y: 0, width: canvas.width, height: canvas.height }
}

/**
 * Draws a 1024px macOS-style app icon: a rounded square in the context color,
 * with a chosen favicon image, an emoji, or the context's initial letter (in
 * that order of precedence). Returned as base64 PNG (no data: prefix) for the
 * main process to convert to .icns.
 */
export async function renderIconPngBase64(options: {
  image?: string | null
  emoji?: string | null
  letter: string
  color: string
}): Promise<string> {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // macOS Dock icons float inside a small transparent margin.
  const margin = size * 0.09
  const rect = size - margin * 2
  const radius = rect * 0.225

  ctx.beginPath()
  ctx.roundRect(margin, margin, rect, rect, radius)
  ctx.fillStyle = options.color
  ctx.fill()

  if (options.image) {
    try {
      const img = await loadImage(options.image)
      // Context images are already complete icon artwork (avatar or favicon).
      // Trim transparent source padding before scaling; otherwise an avatar's
      // invisible canvas fills the tile while its visible artwork stays small.
      const source = visibleImageBounds(img)
      const scale = Math.max(rect / source.width, rect / source.height)
      const w = source.width * scale
      const h = source.height * scale
      ctx.imageSmoothingQuality = 'high'
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(margin, margin, rect, rect, radius)
      ctx.clip()
      ctx.drawImage(
        img,
        source.x,
        source.y,
        source.width,
        source.height,
        (size - w) / 2,
        (size - h) / 2,
        w,
        h
      )
      ctx.restore()
      return canvas.toDataURL('image/png').split(',')[1]
    } catch {
      // Fall through to emoji/letter if the image fails to decode.
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (options.emoji) {
    ctx.font = `${Math.round(rect * 0.62)}px "Apple Color Emoji", system-ui`
    ctx.fillText(options.emoji, size / 2, size / 2 + rect * 0.04)
  } else {
    ctx.fillStyle = 'rgba(9, 9, 11, 0.85)'
    ctx.font = `700 ${Math.round(rect * 0.52)}px system-ui, -apple-system, sans-serif`
    ctx.fillText(options.letter.toUpperCase(), size / 2, size / 2 + rect * 0.02)
  }

  return canvas.toDataURL('image/png').split(',')[1]
}
