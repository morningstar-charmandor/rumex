export interface WebApp {
  id: string
  name: string
  url: string
  /** Name was derived from the URL; replace it with the page title once loaded. */
  autoNamed?: boolean
}

export interface WorkContext {
  id: string
  name: string
  color: string
  /** Emoji chosen for this context's Dock app; shown in the sidebar too. */
  icon?: string
  apps: WebApp[]
}

export interface ActiveApp {
  contextId: string
  appId: string
}

export interface AppState {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  expanded: string[]
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
  /** Fires when another process (main app or a client app) changed the shared state file. */
  onStateExternalChange(callback: () => void): () => void
  /** Set when this process is a per-context Dock app; the UI shows only that context. */
  clientContextId: string | null
  /** Dev/test hook: auto-create a Dock app for the first context on launch. */
  testDockApp: boolean
  platform: string
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
 * Every app instance gets its own persistent Electron session partition.
 * Two apps never share a partition, so cookies, localStorage, indexedDB
 * and cache are fully isolated between contexts (and between apps).
 */
export function partitionFor(contextId: string, appId: string): string {
  return `persist:ctx-${contextId}-app-${appId}`
}
