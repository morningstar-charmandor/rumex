# Project notes for Claude

Read `BLUEPRINT.md` first — it is the authoritative architecture + gotcha guide.

## Google / Gmail sign-in — current approach (VALIDATED 2026-07-17)

Google sign-in for embedded Google apps is done in a dedicated **honest top-level
window** (`src/main/loginWindow.ts`, wired from `src/main/index.ts` via
`isGoogleSignInUrl`), NOT inside the app's `<webview>`, and the Firefox disguise
is switched off for Google webviews.

**Verified on the owner's real machine:** every tested account signed in —
personal `@gmail.com` AND Google **Workspace / custom-domain** accounts (the ones
the old Firefox disguise could NOT do). Fresh logins load the inbox; waking an
existing app prompts a single re-login (identity changed) then works.

Two things had to be exactly right (both learned the hard way — see
`login-test/FINDINGS.md`):

1. **UA = strip ONLY the Electron token, KEEP the app token** (`LOGIN_HONEST_UA`
   in `src/main/index.ts`). The fully-cleaned "pure Chrome" UA (`CHROME_UA`) is
   what Google **rejects** (`/signin/rejected`, "browser may not be secure").
2. **Top-level `BrowserWindow` webContents**, not an embedded `WebContentsView`
   or `<webview>`. The Google page must be a genuine top-level surface.

Plus two bug fixes that made it usable: return the panel to its real URL after
login (don't strand it on `about:blank`), and a 12s cooldown after the login
window closes so a re-challenge can't reopen it in a flicker loop.

### Still open / be careful

- `FIREFOX_UA` is still used for third-party OAuth popups (`setWindowOpenHandler`)
  — left as a fallback; not exercised by the Google web-app login path.
- The running Google webview uses the renderer's UA (`window.api.userAgent`, which
  strips the app token) while the login window keeps the app token — a slight
  mismatch that tested fine but could be unified later.
- Not yet tested across many machines/networks or every account type; validated
  for the owner's accounts.
- **This environment cannot test Google login:** datacenter IP is blocked by
  Google, browser egress is proxied/blocked, and the Electron binary download is
  blocked. Real verification must happen on a home machine.
