import { BrowserWindow, screen } from 'electron'
import type { Session, Cookie } from 'electron'

// A dedicated, HONEST Google sign-in window — built to match the standalone
// tester (login-test/) as closely as possible, since that is the configuration
// Google accepted on a real machine:
//   • the Google page loads in the window's OWN top-level webContents (a plain
//     BrowserWindow surface — NOT an embedded WebContentsView/webview guest),
//   • it presents an honest user agent that keeps the app token and strips only
//     the Electron token (passed in as `userAgent`),
//   • it shares the app's own session so the login cookie lands in the right
//     partition.
// The real address is shown in the window's title bar (like the tester). We never
// inject into or read the Google page; completion is detected only from the
// session's auth cookie and the top-level URL. On success the window closes and
// the caller reloads the app, now authenticated.

/** The Google session cookies that only exist once a user is actually signed in. */
function isGoogleAuthCookie(c: Cookie): boolean {
  const domain = (c.domain ?? '').replace(/^\./, '')
  if (!/(^|\.)google\.com$/.test(domain)) return false
  return !!c.value && (c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID')
}

/** A Google URL that is NOT the sign-in host — i.e. Google forwarding us on, post-login. */
function isPostLoginUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return /(^|\.)google\.com$/.test(h) && h !== 'accounts.google.com' && h !== 'accounts.youtube.com'
  } catch {
    return false
  }
}

/** "accounts.google.com/v3/signin" from a full URL, for the title bar. */
function hostPath(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

interface LoginWindowOptions {
  /** The window to center over (the main app window), if any. */
  parent: BrowserWindow | null
  /** The exact session of the app that needs to sign in — so the cookie lands there. */
  session: Session
  /** The HONEST user agent (app token kept, only the Electron token stripped). */
  userAgent: string
  /** The Google sign-in URL the app was heading to (keeps its `continue=` target). */
  startUrl: string
  /** Called once, when sign-in has completed successfully. */
  onSuccess: () => void
}

/** Open the honest Google sign-in window. Returns the window (closes itself on success). */
export function openHonestLoginWindow(opts: LoginWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...centeredBounds(opts.parent),
    parent: opts.parent ?? undefined,
    title: 'Sign in to Google',
    backgroundColor: '#ffffff',
    minWidth: 400,
    minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: {
      // Share the app's own session so the login cookie lands in its partition.
      session: opts.session,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const wc = win.webContents

  // Honest identity, set before the first navigation so header and
  // navigator.userAgent agree from the very first request.
  wc.setUserAgent(opts.userAgent)

  // Keep the whole sign-in flow inside this one window (so it always uses this
  // window's honest identity) rather than spawning further popups.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void wc.loadURL(url)
    return { action: 'deny' }
  })

  let done = false
  const onCookieChanged = (_e: unknown, cookie: Cookie): void => {
    if (isGoogleAuthCookie(cookie)) finish(true)
  }
  const finish = (success: boolean): void => {
    if (done) return
    done = true
    try {
      opts.session.cookies.removeListener('changed', onCookieChanged)
    } catch {
      // session gone — nothing to clean up
    }
    if (success) opts.onSuccess()
    if (!win.isDestroyed()) win.close()
  }

  // Completion signal #1: the auth cookie lands in the shared session.
  opts.session.cookies.on('changed', onCookieChanged)

  // Completion signal #2: Google forwards us off the sign-in host to the app
  // (e.g. mail.google.com) — that only happens once signed in. Also keep the
  // title bar's address current. URL only; the page itself is never read.
  const onNavigate = (_e: unknown, url: string): void => {
    if (!win.isDestroyed()) win.setTitle('🔒 ' + hostPath(url) + '  —  Secure Google sign-in')
    if (isPostLoginUrl(url)) finish(true)
  }
  wc.on('did-navigate', onNavigate)
  wc.on('did-navigate-in-page', onNavigate)

  // Closing the window (including a user cancelling) tears down the listener.
  win.on('closed', () => {
    if (!done) {
      done = true
      try {
        opts.session.cookies.removeListener('changed', onCookieChanged)
      } catch {
        // ignore
      }
    }
  })

  void wc.loadURL(opts.startUrl)
  return win
}

/** A login-window rectangle centered over the parent (or the primary display). */
function centeredBounds(parent: BrowserWindow | null): {
  width: number
  height: number
  x?: number
  y?: number
} {
  const width = 520
  const height = 680
  const area =
    parent && !parent.isDestroyed()
      ? screen.getDisplayMatching(parent.getBounds()).workArea
      : screen.getPrimaryDisplay().workArea
  const base = parent && !parent.isDestroyed() ? parent.getBounds() : area
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
  const x = clamp(Math.round(base.x + (base.width - width) / 2), area.x, area.x + area.width - width)
  const y = clamp(Math.round(base.y + (base.height - height) / 2), area.y, area.y + area.height - height)
  return { width, height, x, y }
}
