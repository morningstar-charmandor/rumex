import { BrowserWindow, WebContentsView, screen } from 'electron'
import type { Session, Cookie } from 'electron'

// A dedicated, HONEST Google sign-in window.
//
// Background: Google refuses sign-in from anything it can tell is an embedded
// browser, which is why the app otherwise presents a Firefox user-agent on
// Google surfaces (see BLUEPRINT §5.13). But testing (see login-test/FINDINGS.md)
// showed that a *real top-level browser window* presenting our HONEST identity
// (plain Chrome UA, no disguise) signs in reliably — including Google Workspace
// / custom-domain accounts, where the Firefox disguise actually FAILS.
//
// So for Google sign-in we open this window: the Google login page runs in a
// top-level WebContentsView (not an embedded <webview> guest — that top-level
// nature is what the test validated), presenting the honest Chrome UA, sharing
// the app's own session so the login cookie lands in the right place. A slim
// read-only bar above it shows the real address and a lock, so the user can see
// they are on the genuine Google page. We never inject into or read the Google
// page itself — completion is detected only from the session's cookie store and
// the top-level URL. Once signed in, the window closes and the app is reloaded,
// already authenticated.

const CHROME_HEIGHT = 52

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

/** The read-only address bar shown above the Google page. Trusted, local, no network. */
function chromeHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html,body { margin:0; height:100%; }
    body {
      display:flex; align-items:center; gap:8px; padding:0 12px; height:100%;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background:#f3f3f4; color:#3c4043; border-bottom:1px solid #dadce0; user-select:none;
    }
    @media (prefers-color-scheme: dark) {
      body { background:#202124; color:#e8eaed; border-bottom-color:#3c4043; }
    }
    #lock { flex:none; opacity:.75; }
    #addr { flex:1; min-width:0; display:flex; align-items:baseline; gap:1px; overflow:hidden; white-space:nowrap; }
    #host { font-weight:600; }
    #rest { opacity:.55; overflow:hidden; text-overflow:ellipsis; }
    #tag { flex:none; font-size:11px; opacity:.55; }
  </style></head><body>
    <svg id="lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
    </svg>
    <div id="addr"><span id="host"></span><span id="rest"></span></div>
    <span id="tag">Secure Google sign-in</span>
    <script>
      window.__setBar = function (s) {
        try {
          var u = new URL(s.url);
          document.getElementById('host').textContent = u.hostname;
          document.getElementById('rest').textContent = u.pathname === '/' ? '' : u.pathname;
          document.getElementById('lock').style.opacity = s.secure ? '0.75' : '0.2';
        } catch (e) {
          document.getElementById('host').textContent = s.url || '';
          document.getElementById('rest').textContent = '';
        }
      };
    </script>
  </body></html>`
}

interface LoginWindowOptions {
  /** The window to center over (the main app window), if any. */
  parent: BrowserWindow | null
  /** The exact session of the app that needs to sign in — so the cookie lands there. */
  session: Session
  /** The HONEST user agent (plain Chrome, no disguise). */
  userAgent: string
  /** The Google sign-in URL the app was heading to (keeps its `continue=` target). */
  startUrl: string
  /** Called once, when sign-in has completed successfully. */
  onSuccess: () => void
}

/** Open the honest Google sign-in window. Returns the window (closes itself on success). */
export function openHonestLoginWindow(opts: LoginWindowOptions): BrowserWindow {
  const bounds = centeredBounds(opts.parent)
  const win = new BrowserWindow({
    ...bounds,
    parent: opts.parent ?? undefined,
    title: 'Sign in to Google',
    backgroundColor: '#ffffff',
    minWidth: 400,
    minHeight: 480,
    autoHideMenuBar: true
  })

  // The trusted local address bar. No preload / node access needed: main pushes
  // updates into it via executeJavaScript; it has no privileged work to do.
  const chromeView = new WebContentsView()
  // The real Google page: a top-level surface, honest UA, the app's own session,
  // and deliberately hands-off — no preload, so nothing can touch the page.
  const googleView = new WebContentsView({
    webPreferences: {
      session: opts.session,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.contentView.addChildView(chromeView)
  win.contentView.addChildView(googleView)

  const layout = (): void => {
    if (win.isDestroyed()) return
    const { width, height } = win.getContentBounds()
    chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT })
    googleView.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) })
  }
  layout()
  win.on('resize', layout)

  // Push address-bar updates only once the local bar page is ready; keep the
  // latest state so an early navigation isn't lost.
  let chromeReady = false
  let lastBar = { url: opts.startUrl, secure: opts.startUrl.startsWith('https:') }
  const pushBar = (): void => {
    if (!chromeReady || chromeView.webContents.isDestroyed()) return
    void chromeView.webContents.executeJavaScript(`window.__setBar(${JSON.stringify(lastBar)})`)
  }
  chromeView.webContents.on('did-finish-load', () => {
    chromeReady = true
    pushBar()
  })
  void chromeView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(chromeHtml()))

  // Honest identity, set before the first navigation so header and
  // navigator.userAgent agree from the very first request.
  googleView.webContents.setUserAgent(opts.userAgent)

  // Keep the whole sign-in flow inside this one window (so it always uses this
  // window's honest identity) rather than spawning further popups.
  googleView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void googleView.webContents.loadURL(url)
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
  // address bar current. URL only; the page itself is never read.
  const onNavigate = (_e: unknown, url: string): void => {
    lastBar = { url, secure: url.startsWith('https:') }
    pushBar()
    if (isPostLoginUrl(url)) finish(true)
  }
  googleView.webContents.on('did-navigate', onNavigate)
  googleView.webContents.on('did-navigate-in-page', onNavigate)

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

  void googleView.webContents.loadURL(opts.startUrl)
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
