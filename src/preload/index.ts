import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppState } from '../shared/types'

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
  platform: process.platform,
  userAgent
}

contextBridge.exposeInMainWorld('api', api)
