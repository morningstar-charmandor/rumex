import { app, BrowserWindow, ipcMain, session, screen, shell } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'path'
import { readJson, writeJson } from './store'
import type { AppState } from '../shared/types'

const APP_STATE_FILE = 'app-state.json'
const WINDOW_STATE_FILE = 'window-state.json'

interface WindowState {
  bounds?: Rectangle
  isMaximized?: boolean
}

let mainWindow: BrowserWindow | null = null

function intersects(a: Rectangle, b: Rectangle): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  )
}

/** Restore saved bounds only if they are still (partially) on a connected display. */
function restoreWindowState(): WindowState {
  const state = readJson<WindowState>(WINDOW_STATE_FILE, {})
  if (state.bounds) {
    const visible = screen.getAllDisplays().some((d) => intersects(d.workArea, state.bounds!))
    if (!visible) delete state.bounds
  }
  return state
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: NodeJS.Timeout | undefined
  return (...args: T): void => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function createWindow(): void {
  const state = restoreWindowState()

  mainWindow = new BrowserWindow({
    width: state.bounds?.width ?? 1280,
    height: state.bounds?.height ?? 800,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#09090b',
    title: 'ContextWorkspace',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  const win = mainWindow

  if (state.isMaximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  const saveWindowState = (): void => {
    if (win.isDestroyed()) return
    writeJson(WINDOW_STATE_FILE, {
      bounds: win.isMaximized() ? readJson<WindowState>(WINDOW_STATE_FILE, {}).bounds : win.getBounds(),
      isMaximized: win.isMaximized()
    } satisfies WindowState)
  }
  const saveWindowStateDebounced = debounce(saveWindowState, 400)

  win.on('resize', saveWindowStateDebounced)
  win.on('move', saveWindowStateDebounced)
  win.on('close', saveWindowState)
  win.on('closed', () => {
    mainWindow = null
  })

  // Harden every <webview> the renderer attaches: no node access, no preload
  // injection, and enforce that a persistent partition is always set.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!params.partition?.startsWith('persist:')) {
      event.preventDefault()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  // Popups (OAuth sign-in flows etc.) are allowed and automatically inherit
  // the webview's isolated session partition. Anything non-http(s) is denied.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff' }
      }
    }
    if (/^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.whenReady().then(() => {
  ipcMain.handle('state:load', (): AppState | null => readJson<AppState | null>(APP_STATE_FILE, null))

  ipcMain.handle('state:save', (_event, state: AppState): void => {
    writeJson(APP_STATE_FILE, state)
  })

  // Wipe every trace of an app instance's session when it is removed.
  ipcMain.handle('partition:clear', async (_event, partition: string): Promise<void> => {
    if (!partition.startsWith('persist:')) return
    const ses = session.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
    await ses.clearAuthCache()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
