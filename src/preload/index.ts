import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppState, NotchCompatibility, UpdateInfo } from '../shared/types'
import { IPC } from '../shared/ipc'

// Some identity providers (e.g. Google) block sign-in from user agents that
// advertise an embedded browser, so the Electron token is stripped before the
// UA string is handed to the webviews.
const userAgent = navigator.userAgent
  .replace(/\sElectron\/\S+/i, '')
  .replace(/\srumex\/\S+/i, '')

const api: Api = {
  loadState: () => ipcRenderer.invoke(IPC.stateLoad) as Promise<AppState | null>,
  saveState: (state) => ipcRenderer.invoke(IPC.stateSave, state) as Promise<void>,
  clearPartition: (partition) => ipcRenderer.invoke(IPC.partitionClear, partition) as Promise<void>,
  createDockApp: (request) => ipcRenderer.invoke(IPC.dockAppCreate, request),
  fetchFavicon: (url) => ipcRenderer.invoke(IPC.faviconFetch, url) as Promise<string | null>,
  getMemoryUsage: (items) => ipcRenderer.invoke(IPC.metricsGet, items),
  onStateExternalChange: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.stateExternalChange, listener)
    return () => ipcRenderer.removeListener(IPC.stateExternalChange, listener)
  },
  onPaletteToggle: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.paletteToggle, listener)
    return () => ipcRenderer.removeListener(IPC.paletteToggle, listener)
  },
  onOpenUrlInContext: (callback) => {
    const listener = (_e: unknown, url: string): void => callback(url)
    ipcRenderer.on(IPC.contextOpenUrl, listener)
    return () => ipcRenderer.removeListener(IPC.contextOpenUrl, listener)
  },
  onUpdateAvailable: (callback) => {
    const listener = (_e: unknown, info: UpdateInfo): void => callback(info)
    ipcRenderer.on(IPC.updateAvailable, listener)
    return () => ipcRenderer.removeListener(IPC.updateAvailable, listener)
  },
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  setLoginItem: (open) => ipcRenderer.send(IPC.setLoginItem, open),
  checkForUpdate: () => ipcRenderer.send(IPC.updateCheck),
  onSettingsToggle: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.settingsToggle, listener)
    return () => ipcRenderer.removeListener(IPC.settingsToggle, listener)
  },
  activateContext: (contextId) => ipcRenderer.send(IPC.contextActivate, contextId),
  onContextActivate: (callback) => {
    const listener = (_e: unknown, contextId: string): void => callback(contextId)
    ipcRenderer.on(IPC.contextActivate, listener)
    return () => ipcRenderer.removeListener(IPC.contextActivate, listener)
  },
  onAppActivate: (callback) => {
    const listener = (_e: unknown, contextId: string, appId: string): void =>
      callback(contextId, appId)
    ipcRenderer.on(IPC.appActivate, listener)
    return () => ipcRenderer.removeListener(IPC.appActivate, listener)
  },
  appVersion: ipcRenderer.sendSync(IPC.getAppVersion) as string,
  clientContextId: process.env['CW_CONTEXT_ID'] ?? null,
  testDockApp: process.env['CW_TEST_DOCKAPP'] === '1',
  platform: process.platform,
  notchCompatibility: ipcRenderer.sendSync(IPC.notchCompatibility) as NotchCompatibility,
  userAgent
}

contextBridge.exposeInMainWorld('api', api)
