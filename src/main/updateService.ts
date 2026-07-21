import type { UpdateInfo } from '../shared/types'

const GITHUB_API_VERSION = '2022-11-28'

export function isNewerVersion(remote: string, local: string): boolean {
  const remoteParts = remote.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const localParts = local.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(remoteParts.length, localParts.length); i++) {
    const remotePart = remoteParts[i] ?? 0
    const localPart = localParts[i] ?? 0
    if (remotePart !== localPart) return remotePart > localPart
  }
  return false
}

export async function findAvailableUpdate(options: {
  repository: string
  currentVersion: string
  userAgent: string
}): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${options.repository}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': options.userAgent
        },
        signal: AbortSignal.timeout(8000)
      }
    )
    if (!response.ok) {
      console.warn(`Update check failed: GitHub returned ${response.status} ${response.statusText}`)
      return null
    }
    const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    const version = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : ''
    const url = typeof data.html_url === 'string' ? data.html_url : ''
    return version && url && isNewerVersion(version, options.currentVersion)
      ? { version, url }
      : null
  } catch {
    return null
  }
}
