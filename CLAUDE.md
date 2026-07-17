# Project notes for Claude

Read `BLUEPRINT.md` first — it is the authoritative architecture + gotcha guide.

## Google / Gmail sign-in — remember this

- **Honest top-level login window (2026-07).** Google sign-in for embedded Google
  apps is done in a dedicated **honest** top-level window (`src/main/loginWindow.ts`,
  wired from `src/main/index.ts` via `isGoogleSignInUrl`), NOT inside the app's
  `<webview>`. It presents our real Chrome UA (no disguise), shares the app's
  session, and reloads the app once signed in.
- **Why:** empirical A/B testing (`login-test/`, results in
  `login-test/FINDINGS.md`) showed the honest identity signs in reliably —
  including Google **Workspace / custom-domain** accounts, where the old Firefox
  disguise **fails outright**. Honest was 5/5; Firefox failed on every non-Gmail
  business account.
- **Do NOT** remove the `FIREFOX_UA` disguise from the running app webview or the
  OAuth popups — those surfaces are untested and the embedded webview was the
  original failing case. The honest win is specific to the top-level login window.
- **Still to verify by running the real app on a home machine:** the wired-in
  end-to-end flow (honest window → cookie in the app's partition → embedded app
  loads signed in). The cloud/datacenter environment cannot test Google login
  (datacenter IP is blocked by Google for unrelated reasons).

## The standalone test harness

`login-test/` is a self-contained two-window A/B tester (honest UA vs Firefox UA)
with plain-English run instructions in `login-test/HOW-TO-RUN.md`. Keep it; it's
how the sign-in behaviour is verified on a real machine.
