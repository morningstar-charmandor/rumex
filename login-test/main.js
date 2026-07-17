// Two-way Google login test.
//
// When you run this, TWO windows open side by side, both showing Google's
// sign-in page:
//
//   • Left  window = "HONEST ID"  -> we tell Google we're a normal Chrome browser
//                                    (no disguise).
//   • Right window = "COSTUME"    -> we tell Google we're Firefox (the disguise
//                                    the product uses today).
//
// Sign in with a real Google account in BOTH windows and watch each window's
// TITLE BAR. It updates itself to say, in plain words, whether Google is
// letting you in or blocking you. Then compare the two.
//
// There is deliberately no fancy code here and nothing reaches into the Google
// page — we only read the web address the window lands on, which is all we need
// to see the verdict.

const { app, BrowserWindow, screen } = require('electron')

// The Google sign-in page (this is the same one the real product uses).
const LOGIN_URL =
  'https://accounts.google.com/v3/signin/identifier' +
  '?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F' +
  '&flowName=GlifWebSignIn&flowEntry=ServiceLogin'

// The "costume": claim to be Firefox. (Same string the product uses.)
const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0'

// The "honest ID": our real browser identity, with only the app's own private
// labels removed so it reads like a plain Chrome browser (no pretending to be
// something we're not).
function honestUA() {
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/i, '')
    .replace(/\srumex\/\S+/i, '')
    .replace(/\scontextworkspace\/\S+/i, '')
}

// Turn the web address a window has landed on into a plain-English verdict.
function verdict(url) {
  const u = url.toLowerCase()
  if (u.includes('rejected') || u.includes('deniedsigninrejected'))
    return '✗ BLOCKED by Google (this is the wall we are testing)'
  if (u.includes('/sorry/') || u.includes('checkcookie') || u.includes('/challenge/ipp'))
    return '⚠ Google is suspicious of this NETWORK (not the disguise) - try again on home wifi'
  if (u.includes('mail.google.com') || u.includes('myaccount.google.com'))
    return '✓ FULLY SIGNED IN - Google let this one all the way through'
  if (
    u.includes('/challenge/') ||
    u.includes('/signin/challenge') ||
    u.includes('/pwd') ||
    u.includes('/signin/v2') ||
    u.includes('/signin/identifier')
  )
    return '✓ proceeding normally (Google is NOT blocking - keep going)'
  return 'loading...'
}

function makeWindow(label, userAgent, x) {
  const win = new BrowserWindow({
    x,
    y: 60,
    width: 560,
    height: 820,
    title: label + ' - loading...',
    webPreferences: {
      // A separate, TEMPORARY private area per window: the two windows never
      // share anything, and every launch starts logged-out and clean (nothing
      // is remembered between runs). That makes each run a real, fair test.
      partition: 'test-' + label.toLowerCase().replace(/[^a-z]/g, ''),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  // Set who we claim to be BEFORE loading the page, so it's consistent from the
  // very first moment (this is the whole point of the test).
  win.webContents.setUserAgent(userAgent)

  // Keep the whole sign-in flow inside this one window (so it always uses this
  // window's identity), instead of letting Google pop open extra windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) win.webContents.loadURL(url)
    return { action: 'deny' }
  })

  const update = () => {
    if (!win.isDestroyed()) win.setTitle(label + '  |  ' + verdict(win.webContents.getURL()))
  }
  win.webContents.on('did-navigate', update)
  win.webContents.on('did-navigate-in-page', update)

  win.loadURL(LOGIN_URL)
  return win
}

app.whenReady().then(() => {
  const area = screen.getPrimaryDisplay().workArea
  makeWindow('HONEST ID (no disguise)', honestUA(), area.x + 20)
  makeWindow('COSTUME (Firefox)', FIREFOX_UA, area.x + 600)
})

app.on('window-all-closed', () => app.quit())
