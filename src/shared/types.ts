export interface WebApp {
  id: string
  name: string
  url: string
  /** Name was derived from the URL; replace it with the page title once loaded. */
  autoNamed?: boolean
  /** The site's favicon as a data URI, captured from the live page. */
  favicon?: string
  /** Exempt this app from auto-sleep (e.g. an app that must keep notifying). */
  neverSleep?: boolean
  /** Unread count parsed from the page title (e.g. "Inbox (397)"); 0/undefined = none. */
  badge?: number
}

export interface WorkContext {
  id: string
  name: string
  color: string
  /** Emoji chosen for this context; shown in the sidebar and Dock app. */
  icon?: string
  /** A favicon (data URI) chosen as this context's icon; takes precedence over `icon`. */
  iconImage?: string
  /** Epoch ms when the user last entered this context; drives the Context Brief. */
  lastVisited?: number
  apps: WebApp[]
}

export interface ActiveApp {
  contextId: string
  appId: string
}

export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  /** Minutes of inactivity before an app auto-sleeps; 0 disables auto-sleep. */
  sleepAfterMinutes?: number
  /** Launch Rumex automatically at macOS login. */
  openAtLogin?: boolean
  /** Show compact context shortcuts beside the notch on compatible MacBooks. */
  notchSwitcher?: boolean
}

export interface NotchCompatibility {
  supported: boolean
  reason: 'supported' | 'not-macos' | 'no-built-in-display' | 'no-notch-detected'
}

export interface AppState {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  expanded: string[]
  theme?: Theme
  settings?: Settings
}

/** appKey → resident memory in MB for awake apps. */
export type MemoryUsage = Record<string, number>

export interface UpdateInfo {
  /** The newer version's tag, e.g. "0.2.0". */
  version: string
  /** The release page to download from. */
  url: string
}

export interface DockAppRequest {
  contextId: string
  contextName: string
  /** 1024x1024 PNG, base64 (no data: prefix) */
  iconPngBase64: string
}

export interface DockAppResult {
  ok: boolean
  path?: string
  error?: string
}

export interface Api {
  loadState(): Promise<AppState | null>
  saveState(state: AppState): Promise<void>
  clearPartition(partition: string): Promise<void>
  createDockApp(request: DockAppRequest): Promise<DockAppResult>
  /** Downloads a favicon URL in the main process and returns it as a data URI. */
  fetchFavicon(url: string): Promise<string | null>
  /** Resident memory (MB) for each awake app, keyed by appKey. */
  getMemoryUsage(items: { key: string; webContentsId: number }[]): Promise<MemoryUsage>
  /** Fires when another process (main app or a client app) changed the shared state file. */
  onStateExternalChange(callback: () => void): () => void
  /** Fires when ⌘K is pressed while a web app (webview) has focus. */
  onPaletteToggle(callback: () => void): () => void
  /** Fires when a web app opens a new tab; the URL should open in the current context. */
  onOpenUrlInContext(callback: (url: string) => void): () => void
  /** Fires when a newer published version is found. */
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  /** Open an https URL in the user's default browser. */
  openExternal(url: string): void
  /** Toggle launch-at-login for the app. */
  setLoginItem(open: boolean): void
  /** Manually trigger an update check (Settings → Updates). */
  checkForUpdate(): void
  /** Fires when ⌘, is pressed (open Settings). */
  onSettingsToggle(callback: () => void): () => void
  /** Ask the main Rumex window to enter a context selected from the notch surface. */
  activateContext(contextId: string): void
  /** Fires in the main renderer when an external shortcut selects a context. */
  onContextActivate(callback: (contextId: string) => void): () => void
  /** Fires in the main renderer when an external shortcut selects an app. */
  onAppActivate(callback: (contextId: string, appId: string) => void): () => void
  /** This build's version string, e.g. "0.1.0". */
  appVersion: string
  /** Set when this process is a per-context Dock app; the UI shows only that context. */
  clientContextId: string | null
  /** Dev/test hook: auto-create a Dock app for the first context on launch. */
  testDockApp: boolean
  platform: string
  notchCompatibility: NotchCompatibility
  userAgent: string
}

/**
 * Google rejects sign-in from browsers it can identify as embedded, and
 * cross-checks a claimed Chrome against real-Chrome-only signals. Presenting
 * as Firefox — which claims none of those signals — is the approach proven by
 * Ferdium/Rambox. Google-domain apps use this UA wholesale so headers and
 * navigator.userAgent agree from the very first document.
 */
export const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0'

const GOOGLE_HOSTS = /(^|\.)(google|youtube)\.com$/

export function isGoogleUrl(url: string): boolean {
  try {
    return GOOGLE_HOSTS.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * A Google *sign-in* URL specifically (the accounts host on a login path), as
 * opposed to any Google URL. Used to hand embedded-app logins off to the honest
 * top-level sign-in window instead of letting the disguised webview attempt them.
 */
export function isGoogleSignInUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.hostname !== 'accounts.google.com' && u.hostname !== 'accounts.youtube.com') return false
    return /\/(signin|servicelogin|v3\/signin|o\/oauth2|accountchooser)/i.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * Every app instance gets its own persistent Electron session partition.
 * Two apps never share a partition, so cookies, localStorage, indexedDB
 * and cache are fully isolated between contexts (and between apps).
 */
export function partitionFor(contextId: string, appId: string): string {
  return `persist:ctx-${contextId}-app-${appId}`
}
