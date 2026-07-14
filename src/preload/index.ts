import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppState, UpdateInfo } from '../shared/types'

// Some identity providers (e.g. Google) block sign-in from user agents that
// advertise an embedded browser, so the Electron token is stripped before the
// UA string is handed to the webviews.
const userAgent = navigator.userAgent
  .replace(/\sElectron\/\S+/i, '')
  .replace(/\scontextworkspace\/\S+/i, '')

const api: Api = {
  loadState: () => ipcRenderer.invoke('state:load') as Promise<AppState | null>,
  saveState: (state) => ipcRenderer.invoke('state:save', state) as Promise<void>,
  clearPartition: (partition) => ipcRenderer.invoke('partition:clear', partition) as Promise<void>,
  createDockApp: (request) => ipcRenderer.invoke('dockapp:create', request),
  fetchFavicon: (url) => ipcRenderer.invoke('favicon:fetch', url) as Promise<string | null>,
  getMemoryUsage: (items) => ipcRenderer.invoke('metrics:get', items),
  onStateExternalChange: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('state:external-change', listener)
    return () => ipcRenderer.removeListener('state:external-change', listener)
  },
  onPaletteToggle: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('palette:toggle', listener)
    return () => ipcRenderer.removeListener('palette:toggle', listener)
  },
  onUpdateAvailable: (callback) => {
    const listener = (_e: unknown, info: UpdateInfo): void => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  clientContextId: process.env['CW_CONTEXT_ID'] ?? null,
  testDockApp: process.env['CW_TEST_DOCKAPP'] === '1',
  platform: process.platform,
  userAgent
}

contextBridge.exposeInMainWorld('api', api)
