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
import { cpSync, existsSync, mkdirSync, readdirSync, watchFile } from 'fs'
import { join } from 'path'
import { readJson, readJsonFile, writeJson, writeJsonFile } from './store'
import { createDockApp } from './dockapp'
import { FIREFOX_UA, isGoogleUrl, isGoogleSignInUrl } from '../shared/types'
import type { ActiveApp, AppState, DockAppRequest } from '../shared/types'
import { openHonestLoginWindow } from './loginWindow'

const APP_STATE_FILE = 'app-state.json'
const CLIENT_STATE_FILE = 'client-state.json'
const WINDOW_STATE_FILE = 'window-state.json'

/** owner/repo whose GitHub Releases feed the update-available notice. */
const UPDATE_REPO = 'morningstar-charmandor/rumex'
const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_USER_AGENT = `Rumex/${app.getVersion()} (${UPDATE_REPO})`

/** True if `remote` is a higher dotted version than `local` (e.g. 0.2.0 > 0.1.0). */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split('.').map((n) => parseInt(n, 10) || 0)
  const l = local.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0
    const b = l[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}

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

// Default UA for any window without an explicit one: plain Chrome with the
// Electron/app tokens stripped. Webviews override this per-element (Chrome
// normally, Firefox for Google apps); popups inherit it at birth — which is
// the only point a popup's navigator.userAgent can be set (see the
// window-open handler, where it is briefly swapped to Firefox for Google).
const RAW_UA = app.userAgentFallback
const CHROME_UA = RAW_UA.replace(/\sElectron\/\S+/i, '').replace(/\scontextworkspace\/\S+/i, '')
// Honest sign-in UA: strip ONLY the Electron token, KEEPING the app token. This
// matches the standalone tester that Google accepted (login-test/FINDINGS.md) —
// the fully-cleaned CHROME_UA (a "pure Chrome" claim) is what Google rejects.
const LOGIN_HONEST_UA = RAW_UA.replace(/\sElectron\/\S+/i, '')
app.userAgentFallback = CHROME_UA

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
      win.webContents.send('palette:toggle')
    } else if (input.key === ',') {
      event.preventDefault()
      win.webContents.send('settings:toggle')
    }
  })

  // Honest Google sign-in (EXPERIMENT — matches the standalone tester that
  // Google accepted). When a Google web-app's webview is about to load a Google
  // *sign-in* page, cancel that navigation and complete sign-in in a real
  // top-level window with our honest identity (LOGIN_HONEST_UA), sharing this
  // webview's own session; on success, send the app to Google's post-login
  // destination, now authenticated. For this experiment the Firefox disguise is
  // switched off (the Google webview uses the honest UA — see Workspace.tsx).
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
      if (win && !win.isDestroyed()) win.webContents.send('context:open-url', url)
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

/** Downloads a URL and returns it as an image data URI, or null. */
async function toImageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'follow' })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/png'
    if (!type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 512 * 1024) return null
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** Picks the best <link rel="...icon..."> href from page HTML, absolute-resolved. */
function iconLinksFromHtml(html: string, baseUrl: string): string[] {
  const links: { href: string; weight: number }[] = []
  const linkTag = /<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = linkTag.exec(html)) !== null) {
    const tag = m[0]
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (!rel || !rel.includes('icon')) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    // Prefer higher-resolution icons: apple-touch-icon, then large sizes.
    const sizes = /\bsizes\s*=\s*["'](\d+)/i.exec(tag)?.[1]
    const weight =
      (rel.includes('apple-touch') ? 1000 : 0) + (sizes ? parseInt(sizes, 10) : 0)
    try {
      links.push({ href: new URL(href, baseUrl).toString(), weight })
    } catch {
      // ignore malformed href
    }
  }
  return links.sort((a, b) => b.weight - a.weight).map((l) => l.href)
}

async function resolveFavicon(pageUrl: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(pageUrl)) return null
  let origin: string
  let host: string
  try {
    const u = new URL(pageUrl)
    origin = u.origin
    host = u.host
  } catch {
    return null
  }

  // 1. Parse the page's declared icon links (best quality, matches the browser).
  try {
    const res = await fetch(pageUrl, { signal: AbortSignal.timeout(6000), redirect: 'follow' })
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000)
      for (const href of iconLinksFromHtml(html, res.url || pageUrl).slice(0, 4)) {
        const data = await toImageDataUri(href)
        if (data) return data
      }
    }
  } catch {
    // fall through
  }

  // 2. The conventional /favicon.ico.
  const ico = await toImageDataUri(`${origin}/favicon.ico`)
  if (ico) return ico

  // 3. Last resort: a favicon service (returns the site's real icon).
  return toImageDataUri(`https://www.google.com/s2/favicons?domain=${host}&sz=64`)
}

/** Window background matching the persisted theme, to avoid a flash on launch. */
function initialBackgroundColor(): string {
  const state = readJsonFile<AppState | null>(sharedStatePath(), null)
  const theme = state?.theme ?? 'system'
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#09090b' : '#ffffff'
}

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

    // Favicons are resolved here (not in the renderer) so the strict renderer
    // CSP can keep blocking remote images; the chosen icon comes back as a
    // data URI. Given an app's page URL, try the page's declared icon links,
    // then /favicon.ico, then a favicon service — first success wins.
    ipcMain.handle('favicon:fetch', (_event, url: string) => resolveFavicon(url))

    ipcMain.on('open-external', (_event, url: string) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url)
    })

    ipcMain.on('set-login-item', (_event, open: boolean) => {
      app.setLoginItemSettings({ openAtLogin: open })
    })

    ipcMain.on('get-app-version', (event) => {
      event.returnValue = app.getVersion()
    })

    // Free "update available" check: no code signing needed. Poll the repo's
    // latest GitHub Release; if its tag is newer than this build, notify the
    // renderer, which shows a non-blocking notice linking to the release page.
    // (Only the main app checks — client Dock apps stay quiet.)
    if (!clientContextId) {
      const checkForUpdate = async (): Promise<void> => {
        try {
          const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
            headers: {
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': GITHUB_API_VERSION,
              'User-Agent': GITHUB_USER_AGENT
            },
            signal: AbortSignal.timeout(8000)
          })
          if (!res.ok) {
            console.warn(`Update check failed: GitHub returned ${res.status} ${res.statusText}`)
            return
          }
          const data = (await res.json()) as { tag_name?: string; html_url?: string }
          const latest = (data.tag_name ?? '').replace(/^v/, '')
          if (latest && isNewerVersion(latest, app.getVersion()) && data.html_url) {
            const win = mainWindow
            if (win && !win.isDestroyed()) {
              win.webContents.send('update:available', { version: latest, url: data.html_url })
            }
          }
        } catch {
          // offline, no releases yet, or rate-limited — stay silent
        }
      }
      setTimeout(checkForUpdate, 5000)
      setInterval(checkForUpdate, 6 * 60 * 60 * 1000)
      ipcMain.on('update:check', () => void checkForUpdate())
    }

    // Per-app resident memory: map each webview's webContents to its OS pid,
    // then look that pid up in the process metrics (workingSetSize is in KB).
    ipcMain.handle(
      'metrics:get',
      (_event, items: { key: string; webContentsId: number }[]) => {
        const byPid = new Map<number, number>()
        for (const m of app.getAppMetrics()) byPid.set(m.pid, m.memory.workingSetSize)
        const usage: Record<string, number> = {}
        for (const { key, webContentsId } of items) {
          try {
            const wc = webContents.fromId(webContentsId)
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
