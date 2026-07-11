import { app, BrowserWindow, ipcMain, session, screen, shell } from 'electron'
import type { Rectangle } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, watchFile } from 'fs'
import { join } from 'path'
import { readJson, readJsonFile, writeJson, writeJsonFile } from './store'
import { createDockApp } from './dockapp'
import type { ActiveApp, AppState, DockAppRequest } from '../shared/types'

const APP_STATE_FILE = 'app-state.json'
const CLIENT_STATE_FILE = 'client-state.json'
const WINDOW_STATE_FILE = 'window-state.json'

// Per-context Dock apps launch this same entry with CW_* env vars set by
// their stub. Client mode gets its own userData directory (two Chromium
// processes must never share one), while the app name — and therefore the
// Keychain cookie-encryption key — stays identical to the main app's.
const clientContextId = process.env['CW_CONTEXT_ID'] ?? null
const clientContextName = process.env['CW_CONTEXT_NAME'] ?? 'Workspace'
const mainAppUserData = process.env['CW_MAIN_USERDATA'] ?? null

if (clientContextId) {
  app.setPath(
    'userData',
    join(app.getPath('appData'), 'ContextWorkspace-Clients', clientContextId)
  )
}

// Google (and others) refuse sign-in from browsers that identify as embedded.
// Strip the Electron and app tokens from the default UA so every window —
// including OAuth popups, which don't go through the webview's useragent
// attribute — presents as plain Chrome.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/i, '')
  .replace(/\scontextworkspace\/\S+/i, '')

/** The state file every process reads contexts/apps from (main app's copy). */
function sharedStatePath(): string {
  return clientContextId && mainAppUserData
    ? join(mainAppUserData, APP_STATE_FILE)
    : join(app.getPath('userData'), APP_STATE_FILE)
}

/**
 * First launch of a client app: copy this context's session partitions from
 * the main app's storage so existing logins carry over. Copies only; the main
 * app's data is never touched. From then on the two stores are independent.
 */
function ensureClientPartitions(): void {
  if (!clientContextId || !mainAppUserData) return
  const destRoot = join(app.getPath('userData'), 'Partitions')
  if (existsSync(destRoot)) return
  const srcRoot = join(mainAppUserData, 'Partitions')
  if (!existsSync(srcRoot)) return
  mkdirSync(destRoot, { recursive: true })
  for (const dir of readdirSync(srcRoot)) {
    if (dir.includes(`ctx-${clientContextId}`)) {
      try {
        cpSync(join(srcRoot, dir), join(destRoot, dir), { recursive: true })
      } catch {
        // A partially copied partition just means that app asks to log in again.
      }
    }
  }
}

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

// Google refuses sign-in from anything it can identify as an embedded
// browser. A cleaned Chrome UA is not enough: Google cross-checks the claimed
// Chrome against real-Chrome-only signals (client-hint consistency,
// window.chrome, …). The reliable approach — used by Ferdium/Rambox alike —
// is to present as Firefox on Google's login pages only: Firefox claims none
// of those signals, so there is nothing to cross-check.
const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0'
const GOOGLE_LOGIN_HOSTS = /(^|\.)accounts\.(google|youtube)\.com$/

function isGoogleLoginUrl(url: string): boolean {
  try {
    return GOOGLE_LOGIN_HOSTS.test(new URL(url).hostname)
  } catch {
    return false
  }
}

const uaPatchedSessions = new WeakSet<Electron.Session>()

/** Rewrites request headers on login pages (covers the very first request,
 * before setUserAgent can kick in) and drops Chrome client-hint headers,
 * which Firefox would never send. */
function patchSessionForGoogleLogin(ses: Electron.Session): void {
  if (uaPatchedSessions.has(ses)) return
  uaPatchedSessions.add(ses)
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://accounts.google.com/*', 'https://accounts.youtube.com/*'] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      requestHeaders['User-Agent'] = FIREFOX_UA
      for (const key of Object.keys(requestHeaders)) {
        if (key.toLowerCase().startsWith('sec-ch-ua')) delete requestHeaders[key]
      }
      callback({ requestHeaders })
    }
  )
}

app.on('web-contents-created', (_event, contents) => {
  const type = contents.getType()
  if (type !== 'webview' && type !== 'window') return

  patchSessionForGoogleLogin(contents.session)

  // Keep navigator.userAgent consistent with the headers: Firefox while on a
  // Google login page, the normal cleaned Chrome UA everywhere else.
  contents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || !/^https?:/.test(details.url)) return
    const wantsFirefox = isGoogleLoginUrl(details.url)
    const current = contents.getUserAgent()
    if (wantsFirefox && current !== FIREFOX_UA) {
      contents.setUserAgent(FIREFOX_UA)
    } else if (!wantsFirefox && current === FIREFOX_UA) {
      contents.setUserAgent(app.userAgentFallback)
    }
  })

  if (type !== 'webview') return
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

function loadState(): AppState | null {
  if (!clientContextId) return readJson<AppState | null>(APP_STATE_FILE, null)

  // Client mode: contexts/apps come from the main app's state file (read
  // only); only the active app selection is remembered per client.
  const shared = mainAppUserData
    ? readJsonFile<AppState | null>(join(mainAppUserData, APP_STATE_FILE), null)
    : null
  const context = shared?.contexts.find((c) => c.id === clientContextId) ?? {
    id: clientContextId,
    name: clientContextName,
    color: '#60a5fa',
    apps: []
  }
  const own = readJson<{ activeApp?: ActiveApp | null }>(CLIENT_STATE_FILE, {})
  const activeApp =
    own.activeApp &&
    own.activeApp.contextId === clientContextId &&
    context.apps.some((a) => a.id === own.activeApp?.appId)
      ? own.activeApp
      : null
  return { contexts: [context], activeApp, expanded: [clientContextId] }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    ensureClientPartitions()

    ipcMain.handle('state:load', (): AppState | null => loadState())

    ipcMain.handle('state:save', (_event, state: AppState): void => {
      if (clientContextId) {
        writeJson(CLIENT_STATE_FILE, { activeApp: state.activeApp })
        // Merge this context's apps back into the shared state file so
        // changes made in a client app appear in the main app too.
        const shared = readJsonFile<AppState | null>(sharedStatePath(), null)
        const mine = state.contexts.find((c) => c.id === clientContextId)
        if (shared && mine) {
          const contexts = shared.contexts.some((c) => c.id === clientContextId)
            ? shared.contexts.map((c) => (c.id === clientContextId ? mine : c))
            : [...shared.contexts, mine]
          writeJsonFile(sharedStatePath(), { ...shared, contexts })
        }
      } else {
        writeJson(APP_STATE_FILE, state)
      }
    })

    // Wipe every trace of an app instance's session when it is removed.
    ipcMain.handle('partition:clear', async (_event, partition: string): Promise<void> => {
      if (!partition.startsWith('persist:')) return
      const ses = session.fromPartition(partition)
      await ses.clearStorageData()
      await ses.clearCache()
      await ses.clearAuthCache()
    })

    ipcMain.handle('dockapp:create', (_event, request: DockAppRequest) => {
      const result = createDockApp(request)
      if (result.ok && result.path) shell.showItemInFolder(result.path)
      return result
    })

    createWindow()

    // Other processes (main app ↔ client apps) write the shared state file
    // too; poll it and let the renderer refresh. The renderer ignores events
    // caused by its own saves (content comparison).
    watchFile(sharedStatePath(), { interval: 1500 }, () => {
      const win = mainWindow
      if (win && !win.isDestroyed()) win.webContents.send('state:external-change')
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // A client Dock app behaves like a document app: closing its window quits it.
  if (clientContextId || process.platform !== 'darwin') app.quit()
})
