export const zeroheightPages = {
  settings:
    'https://rumex.zeroheight.com/styleguide/s/144241/p/800be4-room-design-system'
} as const

export function zeroheightParameters(pageUrl: string | undefined): Record<string, unknown> {
  if (!pageUrl) return {}

  return {
    zeroheight: {
      pageUrl
    }
  }
}
