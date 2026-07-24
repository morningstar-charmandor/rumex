import { Avatar, Style } from '@dicebear/core'
import thumbs from '@dicebear/styles/thumbs.json'

const thumbsStyle = new Style(thumbs)

export function thumbAvatarDataUri(seed: string): string {
  return new Avatar(thumbsStyle, { seed, size: 128 }).toDataUri()
}

/**
 * Context icons also feed the native notch helper and macOS Dock icon builder.
 * Persist a decoded PNG instead of SVG so every surface uses the same bitmap.
 */
export async function thumbAvatarPngDataUri(seed: string): Promise<string> {
  const image = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Could not render the selected avatar'))
  })
  image.src = new Avatar(thumbsStyle, { seed, size: 512 }).toDataUri()
  await loaded

  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, 512, 512)
  return canvas.toDataURL('image/png')
}
