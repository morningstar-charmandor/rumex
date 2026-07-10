export interface Suggestion {
  name: string
  url: string
  hint: string
  /** True when the name is a guess from the URL and should be refined from the page title. */
  autoNamed: boolean
}

const CATALOG: { name: string; url: string }[] = [
  { name: 'Figma', url: 'https://www.figma.com' },
  { name: 'Slack', url: 'https://app.slack.com/client' },
  { name: 'Notion', url: 'https://www.notion.so' },
  { name: 'Jira', url: 'https://start.atlassian.com' },
  { name: 'Gmail', url: 'https://mail.google.com' },
  { name: 'Google Calendar', url: 'https://calendar.google.com' },
  { name: 'Google Drive', url: 'https://drive.google.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'GitLab', url: 'https://gitlab.com' },
  { name: 'Linear', url: 'https://linear.app' },
  { name: 'Trello', url: 'https://trello.com' },
  { name: 'Asana', url: 'https://app.asana.com' },
  { name: 'ClickUp', url: 'https://app.clickup.com' },
  { name: 'Miro', url: 'https://miro.com/app' },
  { name: 'Canva', url: 'https://www.canva.com' },
  { name: 'Airtable', url: 'https://airtable.com' },
  { name: 'Dropbox', url: 'https://www.dropbox.com' },
  { name: 'Mobbin', url: 'https://mobbin.com' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Claude', url: 'https://claude.ai' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com' },
  { name: 'Telegram', url: 'https://web.telegram.org' },
  { name: 'Discord', url: 'https://discord.com/app' },
  { name: 'Messenger', url: 'https://www.messenger.com' },
  { name: 'X', url: 'https://x.com' }
]

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** "web.whatsapp.com" → "Whatsapp", "mobbin.com" → "Mobbin" */
export function nameFromUrl(url: string): string {
  const host = hostnameOf(url).replace(/^(www|app|web|my|go)\./, '')
  const label = host.split('.')[0] || 'New app'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const DEFAULT_NAMES = ['Figma', 'Slack', 'Notion', 'Gmail', 'GitHub']

export function buildSuggestions(query: string): Suggestion[] {
  const q = query.trim().toLowerCase()

  if (!q) {
    return CATALOG.filter((c) => DEFAULT_NAMES.includes(c.name)).map((c) => ({
      name: c.name,
      url: c.url,
      hint: hostnameOf(c.url),
      autoNamed: false
    }))
  }

  const matches: Suggestion[] = CATALOG.filter(
    (c) => c.name.toLowerCase().includes(q) || hostnameOf(c.url).includes(q)
  )
    .slice(0, 5)
    .map((c) => ({ name: c.name, url: c.url, hint: hostnameOf(c.url), autoNamed: false }))

  // A direct URL (or something with a dot in it) is always offered as-is.
  if (q.includes('.') || /^https?:\/\//i.test(q)) {
    const url = normalizeUrl(query)
    matches.unshift({ name: nameFromUrl(url), url, hint: hostnameOf(url), autoNamed: true })
  } else if (/^[a-z0-9][a-z0-9-]*$/i.test(q)) {
    // Bare word with no catalog hit for the exact name: guess <word>.com.
    const exact = matches.some((m) => m.name.toLowerCase() === q)
    if (!exact) {
      const url = `https://${q}.com`
      matches.push({ name: nameFromUrl(url), url, hint: `${q}.com`, autoNamed: true })
    }
  }

  return matches.slice(0, 6)
}

/** First segment of a page title, e.g. "Inbox (3) - Gmail" → "Inbox (3)"… we
 * actually want the product part, so prefer the last short segment. */
export function cleanTitle(raw: string): string {
  const segments = raw
    .split(/\s+[|·•–—-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return ''
  // Sites usually format titles as "Page – Product"; the product name is the
  // shortest segment. Fall back to the first segment.
  const best = [...segments].sort((a, b) => a.length - b.length)[0] ?? segments[0]
  const title = best.length > 28 ? `${best.slice(0, 28).trimEnd()}…` : best
  return title
}
