# Project notes for Claude

Read `BLUEPRINT.md` first — it is the authoritative architecture + gotcha guide.

## Google / Gmail sign-in — remember this

- **The WORKING login is the embedded Firefox webview** (BLUEPRINT §5.13):
  Google web-app webviews present `FIREFOX_UA`, and sign-in works this way in the
  real app. Do not remove or bypass it.
- **A dedicated "honest" top-level login window was tried and REJECTED by Google**
  in the real app (`accounts.google.com/v3/signin/rejected`, "browser or app may
  not be secure"). It was reverted. The code (`src/main/loginWindow.ts`,
  `isGoogleSignInUrl`) is left in the tree but is **NOT wired in**.
- **Why the earlier standalone test (`login-test/`) was misleading:** it reported
  "honest UA works 5/5", but it was NOT equivalent to the app — it sent a
  different UA string (its app-name token survived the strip regex, so it was not
  the clean-Chrome UA the app actually sends) and used a top-level `BrowserWindow`
  rather than a `WebContentsView`. See `login-test/FINDINGS.md` → "CORRECTION".
- **Lesson:** before trusting any sign-in test, confirm it sends the *identical*
  UA string the real app would send, on the *same* kind of surface. Google
  rejects a clean-Chrome UA (the Chrome cross-check); that is the whole reason the
  Firefox disguise exists.
- **This environment cannot test Google login:** datacenter IP is blocked by
  Google, browser egress is proxied/blocked, and the Electron binary download is
  blocked. Real verification must happen on a home machine.
