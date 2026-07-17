# Google sign-in: does the "Firefox disguise" actually need to be a disguise?

_Investigation log and results. Written 2026-07-17._

## Background

The app embeds web apps (Gmail, etc.) in isolated `<webview>`s. Google refuses
sign-in from anything it detects as an embedded browser, so the app presents a
**Firefox user-agent** on Google surfaces to get past that check. See
`BLUEPRINT.md` §5.13. The long-standing assumption was: *a plain/honest Chrome
identity is NOT enough — Google cross-checks it and rejects, so we must disguise
as Firefox.*

We set out to test that assumption empirically.

## The idea under test

Instead of disguising, open a **dedicated, honest login window** at sign-in
time: a real top-level browser surface (visible address + lock), presenting our
**honest** identity (plain Chrome UA, no disguise), sharing the app's session so
the login cookie lands in the right place. Hypothesis: because a top-level window
is a genuine browser surface, Google may accept it with **no disguise at all**.

## Why we couldn't test it in the cloud session

The first attempts ran from the automated cloud environment. They were
inconclusive/invalid because:

- The HTTP-header check couldn't see the decision — Google throws the
  embedded-browser rejection via client-side JS, not in the headers.
- Headless Chromium couldn't reach Google through the session's egress proxy
  (all navigations reset), so the JS-level check couldn't run.
- Even if it had: that machine is a **datacenter IP** (Google blocks those for
  unrelated reasons) and the engine wasn't Electron, so any result would have
  been a false signal.

Conclusion: the test had to be run on a **real home machine, in a real Electron
window, with a real interactive Google login.** We built a tiny standalone
Electron harness (`login-test/`) that opens two windows side by side — one with
the honest Chrome UA, one with the Firefox UA — both pointed at Google sign-in,
each window's title bar reporting the verdict.

## Results (run by the product owner, on a home machine)

Each row is one Google account, signed in fresh in both windows.

| Account type            | Honest (plain Chrome, no disguise) | Firefox disguise (current approach) |
| ----------------------- | ---------------------------------- | ----------------------------------- |
| Personal `@gmail.com`   | ✓ signed in                        | ✓ signed in                         |
| Work / non-Gmail (A)    | ✓ signed in                        | ✗ only worked on a personal gmail   |
| Work / non-Gmail (B)    | ✓ signed in                        | ✗ "couldn't sign you in" at all     |
| Work / non-Gmail (C)    | ✓ signed in                        | ✗ "couldn't sign you in" at all     |

**Honest: 5 / 5 successful** (including earlier runs). **Firefox disguise: works
on personal Gmail, but FAILS on Google Workspace / custom-domain accounts.**

## Conclusions

1. **The honest approach works** — and was the *only* thing that worked for
   Workspace/business accounts. This overturns the old "honest Chrome isn't
   enough" assumption **for a top-level login window** (it may still hold for the
   embedded `<webview>` surface — that specific combination wasn't isolated).
2. **The current Firefox disguise has a real blind spot**: business customers on
   Google Workspace can't sign in through it. This was previously unknown.
3. Therefore: complete Google sign-in in a **dedicated honest top-level window**
   that shares the app's session, then let the seamless embedded view load
   already-authenticated.

### Important caveat

The 5/5 result is for a **standalone** top-level window. It has NOT yet been
verified end-to-end **wired inside the product** (honest window → cookie lands in
the app's partition → embedded app loads signed in). That final confirmation must
be done by running the app on a real machine. Do NOT simply delete the Firefox
UA from the embedded webview — that surface is the original failing case; the win
belongs to the new dedicated-window design only.

## What was built (this branch)

- `login-test/` — the standalone two-window A/B harness used to get the results
  above (`login-test/HOW-TO-RUN.md`).
- `src/main/loginWindow.ts` — the honest login window: a top-level window with a
  read-only address bar + lock, the honest Chrome UA, sharing the app's session,
  hands-off (no script injection into the Google page), auto-closing once sign-in
  completes.
- `src/main/index.ts` — when a Google app's webview heads to a Google **sign-in**
  URL, the login is handed to the honest window and the app is reloaded on
  success. The Firefox UA is kept as-is for the running app and for third-party
  OAuth popups (unchanged, as a fallback).

Still to verify by running the real app: the wired-in end-to-end flow, and
whether the honest window can eventually replace the Firefox disguise for the
running Gmail webview too (not attempted here — untested surface).

## ⚠️ CORRECTION (2026-07-17, after wiring it into the real app)

The wired-in honest window was tried in the real app and **Google REJECTED it**
(`accounts.google.com/v3/signin/rejected`, "This browser or app may not be
secure"). Meanwhile the owner confirmed the **existing embedded Firefox webview
login WORKS** in the real app. So in the real product the result is the *opposite*
of the standalone tester.

Root cause of the misleading test — the tester was **not equivalent** to the app:

1. **Different UA string.** The Electron UA carries an `<appName>/<version>` token.
   The tester's app name is `rumex-login-test`, and its strip rule `/\srumex\//`
   does NOT match `rumex-login-test/`, so that token **stayed** — the tester's
   "honest" UA was `…) rumex-login-test/1.0.0 Chrome/<v> Safari/537.36`. The real
   app (name `contextworkspace`) strips its token cleanly, sending a **pure Chrome
   UA** `…) Chrome/<v> Safari/537.36`. The clean-Chrome UA is exactly what Google
   cross-checks and rejects (the original BLUEPRINT §5.13 claim). **The tester
   never actually tested the UA the app sends.**
2. **Different surface.** The tester loaded Google in a top-level `BrowserWindow`
   webContents; the app loaded it in a `WebContentsView`. Also a candidate cause;
   could not be isolated from here (this datacenter box can't reach Google
   interactively and the Electron binary download is blocked).

**Action taken:** the login hijack in `src/main/index.ts` was **reverted** — the
app uses the working Firefox webview login again. `src/main/loginWindow.ts` and
`isGoogleSignInUrl` remain in the tree but are **not wired in**.

**If revisiting:** first make the tester a true apples-to-apples match for the app
(same clean-Chrome UA AND same surface), re-run the A/B, and only then wire
anything in. Do not trust a green tester result again until it sends the identical
UA string the app would send.
