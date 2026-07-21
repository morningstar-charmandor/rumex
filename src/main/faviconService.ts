const MAX_IMAGE_BYTES = 512 * 1024
const MAX_HTML_CHARS = 200_000

async function toImageDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      redirect: 'follow'
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? 'image/png'
    if (!contentType.startsWith('image/')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Return declared icons in descending quality order. */
export function iconLinksFromHtml(html: string, baseUrl: string): string[] {
  const links: { href: string; weight: number }[] = []
  const linkTag = /<link\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = linkTag.exec(html)) !== null) {
    const tag = match[0]
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (!rel?.includes('icon')) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const sizes = /\bsizes\s*=\s*["'](\d+)/i.exec(tag)?.[1]
    const weight = (rel.includes('apple-touch') ? 1000 : 0) + (sizes ? Number(sizes) : 0)
    try {
      links.push({ href: new URL(href, baseUrl).toString(), weight })
    } catch {
      // Ignore malformed icon URLs while considering the remaining candidates.
    }
  }
  return links.sort((a, b) => b.weight - a.weight).map(({ href }) => href)
}

export async function resolveFavicon(pageUrl: string): Promise<string | null> {
  let page: URL
  try {
    page = new URL(pageUrl)
    if (page.protocol !== 'http:' && page.protocol !== 'https:') return null
  } catch {
    return null
  }

  try {
    const response = await fetch(page, {
      signal: AbortSignal.timeout(6000),
      redirect: 'follow'
    })
    if (response.ok) {
      const html = (await response.text()).slice(0, MAX_HTML_CHARS)
      for (const href of iconLinksFromHtml(html, response.url || page.href).slice(0, 4)) {
        const data = await toImageDataUri(href)
        if (data) return data
      }
    }
  } catch {
    // Fall through to conventional and service-backed icon locations.
  }

  const conventional = await toImageDataUri(new URL('/favicon.ico', page.origin).href)
  if (conventional) return conventional
  return toImageDataUri(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(page.host)}&sz=64`
  )
}
