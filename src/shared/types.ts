export interface WebApp {
  id: string
  name: string
  url: string
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

export interface Api {
  loadState(): Promise<AppState | null>
  saveState(state: AppState): Promise<void>
  clearPartition(partition: string): Promise<void>
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
