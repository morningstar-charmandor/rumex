import type { ActiveApp, AppState, Settings, Theme, WebApp, WorkContext } from './types'

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function normalizeApp(value: unknown): WebApp | null {
  const input = record(value)
  if (!input) return null
  const id = optionalString(input.id)
  const name = optionalString(input.name)
  const url = optionalString(input.url)
  if (!id || !name || !url) return null
  return {
    id,
    name,
    url,
    ...(typeof input.autoNamed === 'boolean' ? { autoNamed: input.autoNamed } : {}),
    ...(optionalString(input.favicon) ? { favicon: input.favicon as string } : {}),
    ...(typeof input.neverSleep === 'boolean' ? { neverSleep: input.neverSleep } : {}),
    ...(typeof input.badge === 'number' && Number.isFinite(input.badge) && input.badge > 0
      ? { badge: Math.floor(input.badge) }
      : {})
  }
}

function normalizeContext(value: unknown): WorkContext | null {
  const input = record(value)
  if (!input) return null
  const id = optionalString(input.id)
  const name = optionalString(input.name)
  const color = optionalString(input.color)
  if (!id || !name || !color || !Array.isArray(input.apps)) return null
  const apps = input.apps.map(normalizeApp).filter((app): app is WebApp => app !== null)
  const uniqueApps = uniqueById(apps)
  const icon = optionalString(input.icon)
  return {
    id,
    name,
    color,
    apps: uniqueApps,
    // Repair icons persisted before the one-grapheme clamp existed.
    ...(icon && [...icon].length <= 2 ? { icon } : {}),
    ...(optionalString(input.iconImage) ? { iconImage: input.iconImage as string } : {}),
    ...(typeof input.lastVisited === 'number' && Number.isFinite(input.lastVisited)
      ? { lastVisited: input.lastVisited }
      : {})
  }
}

function normalizeSettings(value: unknown): Settings | undefined {
  const input = record(value)
  if (!input) return undefined
  const sleepAfterMinutes =
    typeof input.sleepAfterMinutes === 'number' && Number.isFinite(input.sleepAfterMinutes)
      ? Math.max(0, input.sleepAfterMinutes)
      : undefined
  return {
    ...(sleepAfterMinutes !== undefined ? { sleepAfterMinutes } : {}),
    ...(typeof input.openAtLogin === 'boolean' ? { openAtLogin: input.openAtLogin } : {}),
    ...(typeof input.notchSwitcher === 'boolean' ? { notchSwitcher: input.notchSwitcher } : {})
  }
}

/** Validate persisted/untrusted state and repair dangling references. */
export function normalizeAppState(value: unknown): AppState | null {
  const input = record(value)
  if (!input || !Array.isArray(input.contexts)) return null
  const contexts = input.contexts
    .map(normalizeContext)
    .filter((context): context is WorkContext => context !== null)
  const uniqueContexts = uniqueById(contexts)
  const contextIds = new Set(uniqueContexts.map((context) => context.id))

  let activeApp: ActiveApp | null = null
  const active = record(input.activeApp)
  if (active && typeof active.contextId === 'string' && typeof active.appId === 'string') {
    const context = uniqueContexts.find((candidate) => candidate.id === active.contextId)
    if (context?.apps.some((app) => app.id === active.appId)) {
      activeApp = { contextId: active.contextId, appId: active.appId }
    }
  }

  const expanded = Array.isArray(input.expanded)
    ? [...new Set(input.expanded.filter((id): id is string => typeof id === 'string'))].filter((id) =>
        contextIds.has(id)
      )
    : []
  const theme: Theme | undefined =
    input.theme === 'light' || input.theme === 'dark' || input.theme === 'system'
      ? input.theme
      : undefined
  const settings = normalizeSettings(input.settings)

  return {
    contexts: uniqueContexts,
    activeApp,
    expanded,
    ...(theme ? { theme } : {}),
    ...(settings ? { settings } : {})
  }
}
