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
  /** Set when this process is a per-context Dock app; the UI shows only that context. */
  clientContextId: string | null
  /** Dev/test hook: auto-create a Dock app for the first context on launch. */
  testDockApp: boolean
  platform: string
  userAgent: string
}

/**
 * Every app instance gets its own persistent Electron session partition.
 * Two apps never share a partition, so cookies, localStorage, indexedDB
 * and cache are fully isolated between contexts (and between apps).
 */
export function partitionFor(contextId: string, appId: string): string {
  return `persist:ctx-${contextId}-app-${appId}`
}
