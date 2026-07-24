import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  screen,
  shell,
  nativeTheme,
  webContents
} from 'electron'
import type { Rectangle } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, watchFile, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { join } from 'path'
import { readJson, readJsonFile, writeJson, writeJsonFile } from './store'
import { createDockApp } from './dockapp'
import { resolveFavicon } from './faviconService'
import { findAvailableUpdate } from './updateService'
import { FIREFOX_UA, isGoogleUrl, isGoogleSignInUrl } from '../shared/types'
import { partitionFor } from '../shared/types'
import type { ActiveApp, AppState, DockAppRequest, NotchCompatibility } from '../shared/types'
import { normalizeAppState } from '../shared/state'
import { IPC } from '../shared/ipc'
import { openHonestLoginWindow } from './loginWindow'

const APP_STATE_FILE = 'app-state.json'
const CLIENT_STATE_FILE = 'client-state.json'
const WINDOW_STATE_FILE = 'window-state.json'

/** owner/repo whose GitHub Releases feed the update-available notice. */
const UPDATE_REPO = 'morningstar-charmandor/rumex'
const GITHUB_USER_AGENT = `Rumex/${app.getVersion()} (${UPDATE_REPO})`

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
    join(app.getPath('appData'), 'Rumex-Clients', clientContextId)
  )
}

// Default UA for windows without an explicit identity: Chrome with the
// Electron/app tokens stripped. The honest Google login window explicitly
// keeps the app token; third-party OAuth popups may briefly use Firefox.
const RAW_UA = app.userAgentFallback
const CHROME_UA = RAW_UA.replace(/\sElectron\/\S+/i, '').replace(/\srumex\/\S+/i, '')
// Honest sign-in UA: strip ONLY the Electron token, KEEPING the app token. This
// matches the standalone tester that Google accepted (login-test/FINDINGS.md) —
// the fully-cleaned CHROME_UA (a "pure Chrome" claim) is what Google rejects.
const LOGIN_HONEST_UA = RAW_UA.replace(/\sElectron\/\S+/i, '')
app.userAgentFallback = CHROME_UA

// One-time data migration for the rename to the internal name "rumex". The app's
// data folder and its saved-login encryption key are named after the app, so a
// first launch under the new name would otherwise look empty. Copy the old
// "contextworkspace" data folder across (contexts, app list and settings carry
// over; saved logins are locked to the old name and are re-entered once). We
// COPY, never move, so the original folder stays intact as a fallback. Main app
// only — Dock/client apps have their own per-context folders.
if (!clientContextId) {
  try {
    const newUserData = app.getPath('userData')
    const legacyUserData = join(app.getPath('appData'), 'contextworkspace')
    if (!existsSync(newUserData) && existsSync(legacyUserData)) {
      cpSync(legacyUserData, newUserData, { recursive: true })
    }
  } catch {
    // If the copy fails the app just starts fresh; the old folder is untouched.
  }
}

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
let notchHelper: ChildProcess | null = null
let isQuitting = false

/**
 * Electron does not expose NSScreen.safeAreaInsets. A tall built-in menu bar is
 * nevertheless a reliable no-native-module signal on current notched MacBooks:
 * normal Macs reserve roughly 24px, while notched panels reserve ~32–38px.
 */
function notchCompatibility(): NotchCompatibility {
  if (process.platform !== 'darwin') return { supported: false, reason: 'not-macos' }
  const builtIn = screen
    .getAllDisplays()
    .find((display) => display.internal || /built-?in/i.test(display.label))
  if (!builtIn) return { supported: false, reason: 'no-built-in-display' }
  const topInset = builtIn.workArea.y - builtIn.bounds.y
  if (topInset < 30) return { supported: false, reason: 'no-notch-detected' }
  return { supported: true, reason: 'supported' }
}

function notchCommandPath(): string {
  return join(app.getPath('userData'), 'notch-command.json')
}

function closeNotchHelper(): void {
  if (notchHelper && !notchHelper.killed) notchHelper.kill()
  notchHelper = null
}

function syncNotchHelper(state: AppState | null): void {
  if (isQuitting) return
  const enabled = !clientContextId && state?.settings?.notchSwitcher === true
  if (!enabled || !notchCompatibility().supported || !state) {
    closeNotchHelper()
    return
  }
  if (notchHelper && !notchHelper.killed) return
  const binary = app.isPackaged
    ? join(process.resourcesPath, 'native', 'RumexNotchHelper')
    : join(app.getAppPath(), 'native', 'bin', 'RumexNotchHelper')
  const logo = app.isPackaged
    ? join(process.resourcesPath, 'icon.icns')
    : join(app.getAppPath(), 'build', 'icon.png')
  if (!existsSync(binary)) {
    console.warn('Native notch helper is missing; run npm run build:notch-helper')
    return
  }
  const child = spawn(binary, [sharedStatePath(), notchCommandPath(), logo], {
    stdio: 'ignore',
    detached: false
  })
  notchHelper = child
  child.once('exit', () => {
    if (notchHelper === child) {
      notchHelper = null
      setTimeout(() => syncNotchHelper(loadState()), 500)
    }
  })
}

function activateContextFromShortcut(contextId: string): void {
  const state = loadState()
  if (!state?.contexts.some((context) => context.id === contextId)) return
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const win = mainWindow
  if (!win) return
  const deliver = (): void => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(IPC.contextActivate, contextId)
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', deliver)
  else deliver()
}

function activateAppFromShortcut(contextId: string, appId: string): void {
  const state = loadState()
  const context = state?.contexts.find((candidate) => candidate.id === contextId)
  if (!context?.apps.some((candidate) => candidate.id === appId)) return
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const win = mainWindow
  if (!win) return
  const deliver = (): void => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(IPC.appActivate, contextId, appId)
  }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', deliver)
  else deliver()
}

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
    backgroundColor: initialBackgroundColor(),
    title: 'Rumex',
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

  // Keyboard shortcuts don't bubble out of a focused webview to our renderer,
  // so intercept ⌘K (palette) and ⌘, (settings) here and forward them.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control)) return
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (input.key.toLowerCase() === 'k') {
      event.preventDefault()
      win.webContents.send(IPC.paletteToggle)
    } else if (input.key === ',') {
      event.preventDefault()
      win.webContents.send(IPC.settingsToggle)
    }
  })

  // Validated honest Google sign-in. When a Google web-app's webview is about
  // to load a Google *sign-in* page, cancel that navigation and complete it in a real
  // top-level window with our honest identity (LOGIN_HONEST_UA), sharing this
  // webview's own session; on success, send the app to Google's post-login
  // destination, now authenticated. For this experiment the Firefox disguise is
  // switched off (the Google webview uses the cleaned renderer UA).
  let honestLoginOpen = false
  // After a login window closes, briefly ignore further sign-in navigations so a
  // page that bounces back to sign-in can't reopen the window in a flicker loop.
  let suppressUntil = 0
  // The app's real URL, so we can return the panel there after login instead of
  // stranding it on a blank page. Captured from the first/main navigation that
  // isn't itself a sign-in URL (a redirect to sign-in never overwrites it).
  let appUrl = ''
  contents.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && /^https?:\/\//i.test(url) && !isGoogleSignInUrl(url)) appUrl = url
  })
  const startHonestLogin = (signInUrl: string): void => {
    if (honestLoginOpen || Date.now() < suppressUntil) return
    honestLoginOpen = true
    let dest: string | null = null
    try {
      dest = new URL(signInUrl).searchParams.get('continue')
    } catch {
      dest = null
    }
    const loginWin = openHonestLoginWindow({
      parent: mainWindow,
      session: contents.session,
      userAgent: LOGIN_HONEST_UA,
      startUrl: signInUrl,
      onSuccess: () => {
        if (contents.isDestroyed()) return
        const back = appUrl || dest
        if (back) void contents.loadURL(back)
        else contents.reload()
      }
    })
    loginWin.on('closed', () => {
      honestLoginOpen = false
      suppressUntil = Date.now() + 12000
    })
  }
  const cancelSignInNav = (event: Electron.Event, url: string): void => {
    if (!isGoogleSignInUrl(url) || honestLoginOpen || Date.now() < suppressUntil) return
    event.preventDefault()
    startHonestLogin(url)
  }
  contents.on('will-redirect', cancelSignInNav)
  contents.on('will-navigate', cancelSignInNav)
  contents.on('did-navigate', (_event, url) => {
    if (!honestLoginOpen && Date.now() >= suppressUntil && isGoogleSignInUrl(url)) {
      startHonestLogin(url)
    }
  })

  // Popups (OAuth sign-in flows etc.) are allowed and automatically inherit
  // the opener webview's isolated session partition. Anything non-http(s) is
  // denied. A popup's navigator.userAgent is fixed at birth from the global
  // userAgentFallback and cannot be rewritten afterwards, so for Google-bound
  // popups we swap the fallback to Firefox for exactly the synchronous window
  // in which the popup is created, then restore it. Google rejects sign-in
  // from anything it detects as an embedded browser; Firefox has none of the
  // Chrome-only signals it cross-checks. (Header + navigator both come from
  // this single UA, so they stay consistent — the mismatch itself was a tell.)
  contents.setWindowOpenHandler(({ url, disposition }) => {
    // "Open in new tab" actions (target=_blank / plain window.open) arrive as
    // foreground/background-tab. Rather than spawn a detached OS window, open
    // them inside the workspace as a new app in the current context. Sign-in
    // dialogs arrive as 'new-window' (with size features) and stay popups.
    if (
      /^https?:\/\//i.test(url) &&
      (disposition === 'foreground-tab' || disposition === 'background-tab')
    ) {
      const win = mainWindow
      if (win && !win.isDestroyed()) win.webContents.send(IPC.contextOpenUrl, url)
      return { action: 'deny' }
    }
    if (/^https?:\/\//i.test(url)) {
      if (isGoogleUrl(url)) {
        // A popup takes its UA from the global fallback when its first
        // navigation commits — not at construction — and it can't be
        // rewritten afterwards. Set Firefox now and restore Chrome only once
        // that first navigation has committed, so the restore can't revert
        // the popup to Chrome mid-flight.
        app.userAgentFallback = FIREFOX_UA
        contents.once('did-create-window', (popup) => {
          popup.webContents.once('did-navigate', () => {
            app.userAgentFallback = CHROME_UA
          })
        })
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          // Center the popup over the app's own window so it opens on the same
          // display, not wherever the OS would place it (e.g. another monitor).
          ...centeredPopupBounds()
        }
      }
    }
    if (/^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
})

function centeredPopupBounds(): { width: number; height: number; x?: number; y?: number } {
  const width = 600
  const height = 720
  const parent = mainWindow
  if (!parent || parent.isDestroyed()) return { width, height }
  const p = parent.getBounds()
  const area = screen.getDisplayMatching(p).workArea
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
  const x = clamp(Math.round(p.x + (p.width - width) / 2), area.x, area.x + area.width - width)
  const y = clamp(Math.round(p.y + (p.height - height) / 2), area.y, area.y + area.height - height)
  return { width, height, x, y }
}

/** Window background matching the persisted theme, to avoid a flash on launch. */
function initialBackgroundColor(): string {
  const state = readJsonFile<AppState | null>(sharedStatePath(), null)
  const theme = state?.theme ?? 'system'
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#09090b' : '#ffffff'
}

function loadState(): AppState | null {
  if (!clientContextId) return normalizeAppState(readJson<unknown>(APP_STATE_FILE, null))

  // Client mode: contexts/apps come from the main app's state file (read
  // only); only the active app selection is remembered per client.
  const shared = mainAppUserData
    ? normalizeAppState(readJsonFile<unknown>(join(mainAppUserData, APP_STATE_FILE), null))
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
  // Client apps follow the theme chosen in the main app.
  return { contexts: [context], activeApp, expanded: [clientContextId], theme: shared?.theme }
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

    ipcMain.on(IPC.notchCompatibility, (event) => {
      event.returnValue = notchCompatibility()
    })

    ipcMain.on(IPC.contextActivate, (_event, contextId: string) => {
      if (typeof contextId === 'string') activateContextFromShortcut(contextId)
    })

    ipcMain.handle(IPC.stateLoad, (): AppState | null => loadState())

    ipcMain.handle(IPC.stateSave, (_event, candidate: unknown): void => {
      const state = normalizeAppState(candidate)
      if (!state) throw new TypeError('Invalid application state')
      if (clientContextId) {
        writeJson(CLIENT_STATE_FILE, { activeApp: state.activeApp })
        // Merge this context's apps back into the shared state file so
        // changes made in a client app appear in the main app too.
        const shared = normalizeAppState(readJsonFile<unknown>(sharedStatePath(), null))
        const mine = state.contexts.find((c) => c.id === clientContextId)
        if (shared && mine) {
          const contexts = shared.contexts.some((c) => c.id === clientContextId)
            ? shared.contexts.map((c) => (c.id === clientContextId ? mine : c))
            : [...shared.contexts, mine]
          writeJsonFile(sharedStatePath(), { ...shared, contexts })
        }
      } else {
        writeJson(APP_STATE_FILE, state)
        syncNotchHelper(state)
      }
    })

    // Wipe every trace of an app instance's session when it is removed.
    ipcMain.handle(IPC.partitionClear, async (_event, partition: unknown): Promise<void> => {
      if (typeof partition !== 'string') throw new TypeError('Invalid partition')
      const state = loadState()
      const isKnownPartition = state?.contexts.some((context) =>
        context.apps.some((webApp) => partitionFor(context.id, webApp.id) === partition)
      )
      if (!isKnownPartition) throw new TypeError('Unknown application partition')
      const ses = session.fromPartition(partition)
      await ses.clearStorageData()
      await ses.clearCache()
      await ses.clearAuthCache()
    })

    // Favicons are resolved here (not in the renderer) so the strict renderer
    // CSP can keep blocking remote images; the chosen icon comes back as a
    // data URI. Given an app's page URL, try the page's declared icon links,
    // then /favicon.ico, then a favicon service — first success wins.
    ipcMain.handle(IPC.faviconFetch, (_event, url: unknown) =>
      typeof url === 'string' && url.length <= 4096 ? resolveFavicon(url) : null
    )

    ipcMain.on(IPC.openExternal, (_event, url: string) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url)
    })

    ipcMain.on(IPC.setLoginItem, (_event, open: unknown) => {
      if (typeof open === 'boolean') app.setLoginItemSettings({ openAtLogin: open })
    })

    ipcMain.on(IPC.getAppVersion, (event) => {
      event.returnValue = app.getVersion()
    })

    // Free "update available" check: no code signing needed. Poll the repo's
    // latest GitHub Release; if its tag is newer than this build, notify the
    // renderer, which shows a non-blocking notice linking to the release page.
    // (Only the main app checks — client Dock apps stay quiet.)
    if (!clientContextId) {
      const checkForUpdate = async (): Promise<void> => {
        const update = await findAvailableUpdate({
          repository: UPDATE_REPO,
          currentVersion: app.getVersion(),
          userAgent: GITHUB_USER_AGENT
        })
        const win = mainWindow
        if (update && win && !win.isDestroyed()) {
          win.webContents.send(IPC.updateAvailable, update)
        }
      }
      setTimeout(checkForUpdate, 5000)
      setInterval(checkForUpdate, 6 * 60 * 60 * 1000)
      ipcMain.on(IPC.updateCheck, () => void checkForUpdate())
    }

    // Per-app resident memory: map each webview's webContents to its OS pid,
    // then look that pid up in the process metrics (workingSetSize is in KB).
    ipcMain.handle(
      IPC.metricsGet,
      (_event, candidate: unknown) => {
        const items = Array.isArray(candidate)
          ? candidate
              .filter(
                (item): item is { key: string; webContentsId: number } =>
                  typeof item === 'object' &&
                  item !== null &&
                  typeof (item as { key?: unknown }).key === 'string' &&
                  typeof (item as { webContentsId?: unknown }).webContentsId === 'number'
              )
              .slice(0, 100)
          : []
        const byPid = new Map<number, number>()
        for (const m of app.getAppMetrics()) byPid.set(m.pid, m.memory.workingSetSize)
        const usage: Record<string, number> = {}
        for (const { key, webContentsId } of items) {
          try {
            const wc = webContents.fromId(webContentsId)
            if (wc?.hostWebContents?.id !== mainWindow?.webContents.id) continue
            const pid = wc?.getOSProcessId()
            const kb = pid ? byPid.get(pid) : undefined
            if (kb) usage[key] = Math.round(kb / 1024)
          } catch {
            // webContents gone (app sleeping) — omit it
          }
        }
        return usage
      }
    )

    ipcMain.handle(IPC.dockAppCreate, (_event, request: DockAppRequest) => {
      if (
        !request ||
        typeof request.contextId !== 'string' ||
        typeof request.contextName !== 'string' ||
        typeof request.iconPngBase64 !== 'string' ||
        request.iconPngBase64.length > 8_000_000 ||
        !loadState()?.contexts.some((context) => context.id === request.contextId)
      ) {
        return { ok: false, error: 'Invalid Dock app request' }
      }
      const result = createDockApp(request)
      if (result.ok && result.path) shell.showItemInFolder(result.path)
      return result
    })

    createWindow()
    const commandPath = notchCommandPath()
    if (!existsSync(commandPath)) writeFileSync(commandPath, '{}')
    let lastNotchCommand = ''
    watchFile(commandPath, { interval: 200 }, () => {
      try {
        const raw = readFileSync(commandPath, 'utf8')
        if (raw === lastNotchCommand) return
        lastNotchCommand = raw
        const command = JSON.parse(raw) as { kind?: unknown; contextId?: unknown; appId?: unknown }
        if (typeof command.contextId !== 'string') return
        if (command.kind === 'app' && typeof command.appId === 'string') {
          activateAppFromShortcut(command.contextId, command.appId)
        } else {
          activateContextFromShortcut(command.contextId)
        }
      } catch {
        // The helper writes atomically; ignore an incomplete/missing poll.
      }
    })
    syncNotchHelper(loadState())

    // Other processes (main app ↔ client apps) write the shared state file
    // too; poll it and let the renderer refresh. The renderer ignores events
    // caused by its own saves (content comparison).
    watchFile(sharedStatePath(), { interval: 1500 }, () => {
      const win = mainWindow
      if (win && !win.isDestroyed()) win.webContents.send(IPC.stateExternalChange)
      syncNotchHelper(loadState())
    })

    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // A client Dock app behaves like a document app: closing its window quits it.
  if (clientContextId || process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  closeNotchHelper()
})
