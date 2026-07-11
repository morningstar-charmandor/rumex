function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
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
      // Contain the favicon centered at ~56% of the tile.
      const target = rect * 0.56
      const scale = Math.min(target / img.width, target / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
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
