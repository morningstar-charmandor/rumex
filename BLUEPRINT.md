# ContextWorkspace — Full Rebuild Blueprint

A complete, decision-level spec to recreate this macOS desktop app from scratch. Read this top to bottom before writing code; the **⚠️ Gotchas** are non-obvious and each cost real debugging time.

---

## 1. What it is

ContextWorkspace is a **macOS desktop app** that runs **multiple isolated instances of the same web apps** (Figma, Slack, Gmail, Notion, …) grouped by **Context** (a client/project). Every app instance has its own cookies/storage — you can be logged into three Figma accounts at once. Positioned not as a browser but as a **“Context OS”**: a Context is a work identity (its apps, sessions, and eventually its downloads/network/AI memory).

Primary object is the **Context**; apps are attributes of a context. Never organize around apps/tabs.

---

## 2. Tech stack (exact, with rationale)

- **Electron** (v43) + **TypeScript** (strict) + **React 19** + **Tailwind CSS v4**.
- Build: **electron-vite** (v5) wrapping Vite. Package: **electron-builder** (v26).
- **Why Electron, not Tauri:** we need `session.fromPartition('persist:…')` for hard, per-instance session isolation with zero shared cookies — Electron gives this natively per `<webview>`.

⚠️ **Dependency pinning (Vite ecosystem):** at build time, `electron-vite@5` peers on Vite ≤7, but `vite@8` and `@vitejs/plugin-react@6` had shipped. Pin **`vite@^7`** and **`@vitejs/plugin-react@^5`** or `npm install` fails with ERESOLVE. Do not let these float.

Runtime deps: `react`, `react-dom`. Dev deps: `electron`, `electron-vite`, `electron-builder`, `vite@^7`, `@vitejs/plugin-react@^5`, `typescript`, `tailwindcss`, `@tailwindcss/vite`, `@types/{react,react-dom,node}`.

---

## 3. Project structure

```
src/
  main/        Electron main process (Node): windows, IPC, isolation, dock apps, updates
    index.ts
    store.ts   JSON read/write helpers over userData
    dockapp.ts .app bundle generator for per-context Dock apps
  preload/
    index.ts   contextBridge — the ONLY renderer↔main surface
  shared/
    types.ts   types + partition naming + UA constants (imported by all 3 processes)
  renderer/
    index.html CSP meta, root div, module script
    src/
      main.tsx  React entry
      App.tsx    top-level state container + all handlers
      env.d.ts   window.api typing + vite client types
      index.css  Tailwind import + @custom-variant dark + webview css
      catalog.ts app catalog, name/badge/title parsing helpers
      dockIcon.ts canvas → PNG icon renderer (emoji/letter/image)
      components/ Sidebar, Workspace, CommandPalette, Settings, UpdateToast
```

Config files at root: `package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig.node.json` (main/preload/shared), `tsconfig.web.json` (renderer/shared). Two tsconfigs because Node vs DOM libs differ; both `include` `shared`.

`package.json` `main` = `./out/main/index.js`. Scripts: `dev` (`electron-vite dev`), `build` (`electron-vite build`), `typecheck` (both tsconfigs `--noEmit`), `dist:mac`/`dist:win` (`electron-vite build && electron-builder --mac/--win`).

`electron.vite.config.ts`: `main` + `preload` use `externalizeDepsPlugin()`; `renderer` uses `react()` + `tailwindcss()` (the `@tailwindcss/vite` plugin — Tailwind v4 has no config file, styles come from `@import 'tailwindcss'`).

---

## 4. Core architecture

### 4.1 Process model & window
- One `BrowserWindow` (frameless-ish): `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: {x:14,y:13}`, min 900×600.
- `webPreferences`: `preload`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, **`webviewTag: true`**.
- `backgroundColor` computed from persisted theme at launch (see Theme) to avoid a flash.
- Renderer loads `ELECTRON_RENDERER_URL` (dev) or `out/renderer/index.html` (prod).

### 4.2 Isolation model (the heart)
- Each app instance renders in a `<webview>` whose `partition` is **`persist:ctx-<contextId>-app-<appId>`** (see `partitionFor()` in `shared/types.ts`). No two instances ever share a partition → cookies/localStorage/IndexedDB/cache fully isolated.
- Deleting an app/context wipes its partition: `session.fromPartition(p).clearStorageData()` + `clearCache()` + `clearAuthCache()` via IPC `partition:clear` (guard: partition must start with `persist:`).

### 4.3 Security hardening
- `will-attach-webview` on the window’s webContents: `delete webPreferences.preload`, force `nodeIntegration=false`, `contextIsolation=true`, and **`event.preventDefault()` if `params.partition` doesn’t start with `persist:`** (refuses non-persistent/unpartitioned webviews).
- CSP meta in `index.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. ⚠️ This blocks remote images — so favicons are fetched in main and passed as data URIs (see Favicons).

### 4.4 IPC surface (`preload` → `window.api`)
Expose via `contextBridge.exposeInMainWorld('api', …)`. Full surface:
- `loadState(): Promise<AppState|null>`, `saveState(state): Promise<void>`
- `clearPartition(partition): Promise<void>`
- `createDockApp(req): Promise<DockAppResult>`
- `fetchFavicon(appUrl): Promise<string|null>` (returns data URI)
- `getMemoryUsage(items): Promise<Record<appKey, MB>>`
- `onStateExternalChange(cb)`, `onPaletteToggle(cb)`, `onSettingsToggle(cb)`, `onOpenUrlInContext(cb)`, `onUpdateAvailable(cb)` — all return an unsubscribe fn
- `openExternal(url)`, `setLoginItem(open)`, `checkForUpdate()`
- constants: `clientContextId: string|null`, `testDockApp: boolean`, `platform`, `userAgent`, `appVersion`
- `userAgent` in preload strips the `Electron/…` and `contextworkspace/…` tokens from `navigator.userAgent` (some IdPs block embedded-browser UAs).

### 4.5 State model (`AppState`, persisted as JSON)
```ts
WebApp   = { id, name, url, autoNamed?, favicon?(dataURI), neverSleep?, badge?(number) }
WorkContext = { id, name, color, icon?(emoji), iconImage?(dataURI), lastVisited?, apps: WebApp[] }
Settings = { sleepAfterMinutes?, openAtLogin? }
AppState = { contexts, activeApp: {contextId,appId}|null, expanded: string[], theme?, settings? }
Theme = 'light'|'dark'|'system'
```
- IDs are `crypto.randomUUID()`. `appKey(ctx,app) = "ctx:app"`.
- Persistence: main writes `app-state.json` and `window-state.json` to `app.getPath('userData')`. Debounced save (~300ms) from renderer. Reads are fault-tolerant (return fallback on parse error).
- App.tsx keeps a `stateRef` mirror for callbacks that must read latest state without re-subscribing.

### 4.6 Window memory
- Persist `{bounds, isMaximized}`; on restore, **validate bounds intersect a connected display** (`screen.getAllDisplays()`), else drop bounds so the window never opens off-screen. Save debounced on `resize`/`move` + on `close`.

---

## 5. Features (spec + ⚠️ gotchas)

### 5.1 Layout
- Left **Sidebar** (240px, `w-60`): title strip (doubles as drag region, `-webkit-app-region: drag`; on mac add `pl-20` for traffic lights), a “Go to… ⌘K” search button, per-active-app nav row (back/fwd/reload), context tree, footer (New Context + Settings gear).
- **Workspace** (rest of viewport): the active app’s webview at 100%, chromeless.
- Contexts expand/collapse; apps listed under them. Colors cycle through a fixed palette.

### 5.2 Webview rendering ⚠️
- One `<webview>` per **opened** app, kept mounted whole session (switching is instant, sessions stay warm). Only apps in `openedKeys` are mounted.
- `allowpopups` **must be a string**: `allowpopups={'true' as unknown as boolean}`. ⚠️ React drops unknown boolean-valued attributes, so `allowpopups={true}` renders nothing and every `window.open` (all sign-in popups) is silently blocked.
- **Cropping bug fix:** Electron’s `<webview>` hosts the page in a shadow-DOM iframe that can get stuck at a stale size (content renders in a top band, rest is webview bg). Fix: pin the shadow iframe to `width/height:100%`, re-assert on `dom-ready` and via a `ResizeObserver` on the webview element. AND hide inactive webviews with `opacity:0` + z-index — **not** `visibility:hidden` (that triggers the stale-size bug).
- Capture `page-title-updated` (raw title → App derives auto-name + unread badge). ⚠️ `page-favicon-updated` is unreliable (often never fires) — don’t depend on it (see Favicons).

### 5.3 Chromeless navigation
- No URL bar/buttons in the webview. Keyboard: Cmd/Ctrl+R reload, +Shift hard reload, Cmd+[ back, Cmd+] forward. Sidebar shows back/fwd/reload buttons whose enabled state tracks `canGoBack/canGoForward` (updated on `did-navigate`/`did-navigate-in-page`/`did-stop-loading`; wrap calls in try/catch — they throw before attach).

### 5.4 Add app (searchable) + auto-naming
- Single input: fuzzy-matches a built-in catalog (~25 popular apps), accepts pasted URLs, guesses `<word>.com` for bare words. Name derived from URL (`nameFromUrl`), `autoNamed:true` so it adopts the cleaned page title on first load (once), then stops.
- `cleanTitle` picks the shortest `|·•–—-`-separated segment (usually the product name). `parseBadge` extracts an unread count from `(\d+)`/`[\d+]` in the title.

### 5.5 Rename & icons
- Double-click a context/app name to rename inline; a manual rename disables auto-naming.
- **Context icon picker** (click the context’s leading icon): custom emoji (clamped to 1 grapheme via `Intl.Segmenter`), or pick any favicon from the context’s apps, or reset. Emoji and image are mutually exclusive. The chosen icon shows in the sidebar and is reused as the Dock-app icon.

### 5.6 Favicons ⚠️
- Resolved in **main** (not renderer — CSP blocks remote images) from the app’s URL: fetch the page HTML, parse `<link rel="…icon…">` (prefer apple-touch-icon / larger `sizes`), else `/favicon.ico`, else `https://www.google.com/s2/favicons?domain=<host>`. Return a data URI (≤512KB, `content-type` must be `image/*`). Store on `WebApp.favicon`.
- Resolve for all apps on load (bootstrap) and on each app’s `dom-ready`; dedupe per app. Sidebar shows `<img>` favicon, falling back to a colored letter tile.

### 5.7 Theme ⚠️
- Tailwind v4: in `index.css`, `@custom-variant dark (&:where(.dark, .dark *));` so the `dark:` variant follows a **`.dark` class** on `<html>`, not the OS media query. Toggle the class from `state.theme` (System follows `matchMedia('(prefers-color-scheme: dark)')` live).
- All chrome is styled light-default + `dark:` variants. Web content keeps its own theme.
- Set `html { background:#fff }` / `html.dark { background:#09090b }` and compute the window `backgroundColor` from the persisted theme (using `nativeTheme.shouldUseDarkColors` for System) to avoid a flash.

### 5.8 Memory Saver
- Auto-sleep: a 15s ticker; any **opened** app idle past a threshold (`settings.sleepAfterMinutes`, default 15; 0=off) is **slept** = removed from `openedKeys` → its `<webview>` unmounts → the renderer process exits → memory freed. The `persist:` partition keeps the login on disk; re-selecting reloads. The **active app never sleeps**; `neverSleep` apps are exempt.
- Track `lastActive` per appKey (refreshed for the active app each tick). Manual “Sleep now” (moon) and “Keep awake / never sleep” (☕ coffee-cup icon — chosen over a star so it doesn’t read as “favorite”) per app on hover.
- **Memory meter:** IPC `metrics:get` maps each webview’s `webContents.getOSProcessId()` to `app.getAppMetrics()` (`memory.workingSetSize` is KB → MB). Polled ~3s; shown at rest on each app row (💤 when asleep).

### 5.9 Command palette (⌘K)
- Spotlight-style centered overlay, blurred backdrop, fuzzy search over contexts + apps (subsequence match). Enter on an app opens it; Enter on a context “enters” it (shows its Context Brief). Keyboard nav; also reachable from the sidebar “Go to…” button.
- ⚠️ Keyboard shortcuts don’t bubble out of a focused `<webview>`. In main, add `contents.on('before-input-event', …)` on each webview to intercept **⌘K** and **⌘,** and `webContents.send('palette:toggle' / 'settings:toggle')` to the host window. The renderer also has a window `keydown` listener for when its own UI is focused.

### 5.10 Context Brief
- Entering a context without picking an app shows a Brief in the workspace: context name/icon, “Last opened X ago” (`WorkContext.lastVisited`), and the apps with unread counts (from `WebApp.badge`), each clickable to enter. Deterministic only (no AI) — the honest base for the future “since your last visit”.

### 5.11 Per-context Dock apps (macOS) ⚠️⚠️ (the hardest feature)
Generate a wrapper `.app` per context in `~/Applications/ContextWorkspace Apps/<Name>.app` giving it its own Dock tile/name/icon. Launching it opens a window showing only that context (**client mode**). Critical decisions:
- **Clone, don’t symlink.** The wrapper is an **APFS copy-on-write clone** of the running app bundle: `cp -Rc <sourceBundle> <work>`. ⚠️ A symlinked `Contents/Frameworks` makes Electron **SIGTRAP** on startup (it must resolve inside the bundle). The clone shares disk blocks → near-zero cost.
- **Build in a temp bundle, then atomic swap.** Assemble at `.<Name>.building.app`, then `rmSync(bundle,{recursive,force})` + `renameSync(work,bundle)`. ⚠️ Cloning straight onto an existing (possibly running) bundle can merge into it and leave `app.asar` as a **directory** → non-recursive `rmSync` throws EISDIR. Remove `app.asar` and `app.asar.unpacked` **recursively**.
- **Do NOT rename the executable or `CFBundleName`.** ⚠️ In the packaged build, Electron derives Helper app names (`<ProductName> Helper.app`) from these; renaming → “Unable to find helper app” crash. Only change **`CFBundleDisplayName`**, **`CFBundleIdentifier`** (unique per context → distinct Dock tile), and **`CFBundleIconFile`**. Separate Dock tiles come from the unique bundle id, not the exec name. (Dev-mode Electron.app tolerated renaming because its helper is the default “Electron Helper” — packaged builds don’t.)
- **Remove `app.asar` so the stub loads.** Electron prefers `Resources/app.asar` over `Resources/app`. Replace the payload with a stub `Resources/app/{package.json,index.js}`. The stub sets `process.env.CW_CONTEXT_ID/CW_CONTEXT_NAME/CW_MAIN_USERDATA` and `require()`s the real main entry at `join(app.getAppPath(),'out/main/index.js')` (works via asar in packaged builds).
- **Stub `package.json` name must equal the main app’s** (`contextworkspace`) so Chromium’s cookie-encryption Keychain item `"<name> Safe Storage"` matches — otherwise copied sessions can’t be decrypted.
- **Ad-hoc codesign** the finished bundle: `codesign --force --sign - <bundle>` (mandatory on Apple Silicon).
- Icon: `dockIcon.ts` draws a 1024px rounded-rect (emoji / letter / favicon image) on a canvas → base64 PNG → main converts to `.icns` via stock `sips` + `iconutil`.

### 5.12 Client mode (a Dock app running) ⚠️
- Detect via `process.env.CW_CONTEXT_ID`. If set: `app.setPath('userData', appData/ContextWorkspace-Clients/<contextId>)` — ⚠️ two Chromium processes must never share one userData dir.
- On first launch, **copy** (not move) the context’s partition dirs from the main app’s `Partitions/` so existing logins carry over; main app data is never touched.
- Contexts/apps are read from the main app’s `app-state.json`; the client persists only its own `activeApp` and merges its context back into the shared state file on save (two-way sync). Both main and client `watchFile` the shared state and refresh (renderer ignores no-op changes by content compare).
- `app.requestSingleInstanceLock()` for all modes (lock is per userData dir → main and each client can coexist). Client apps quit on window close (`window-all-closed`).
- Sidebar in client mode is read-only-ish and shows only that context; footer hidden.

### 5.13 Google / Gmail sign-in ⚠️⚠️ (a long saga — get this exactly right)
Google refuses sign-in from anything it detects as an embedded browser. What actually works:
- **⚠️ Tried & reverted (2026-07): an "honest" top-level login window.** A standalone tester (`login-test/`) suggested an honest Chrome UA in a top-level window signs in — but wired into the real app it was **rejected** by Google (`/signin/rejected`, "browser or app may not be secure"), while the embedded Firefox login kept working. The tester was **not equivalent** to the app (it sent a different UA string — its app-name token survived the strip — and used a `BrowserWindow` not a `WebContentsView`). Reverted; `src/main/loginWindow.ts` + `isGoogleSignInUrl` remain unused in the tree. Full write-up: `login-test/FINDINGS.md` → "CORRECTION". **Takeaway: the Firefox disguise below is the working path — keep it.**
- **Present as Firefox on Google surfaces.** A cleaned Chrome UA is NOT enough — Google cross-checks claimed-Chrome against Chrome-only signals; the mismatch is itself the tell.
  - `FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0'`.
  - Google-domain **webviews** set the Firefox UA via the `useragent` attribute at creation (`isGoogleUrl(url) ? FIREFOX_UA : cleanedChrome`).
- **The popup is the crux.** A popup’s `navigator.userAgent` is fixed **at first-navigation commit** from the **global `app.userAgentFallback`** — not settable per-webContents/per-session afterward (all such overrides are ignored/too late; the header/navigator mismatch = rejection).
  - Solution: in `setWindowOpenHandler`, when the popup URL is a Google login URL, **swap `app.userAgentFallback = FIREFOX_UA` for exactly the moment the popup is created, then restore `CHROME_UA` once the popup’s first navigation commits** (`contents.once('did-create-window', p => p.webContents.once('did-navigate', restore))`). This keeps non-Google popups on Chrome.
- Global default: `app.userAgentFallback = CHROME_UA` (navigator.userAgent minus `Electron/…` and `contextworkspace/…` tokens).
- `isGoogleUrl` matches `accounts.google.com` / `accounts.youtube.com` (and google login hosts). Verify by driving the real flow — it should reach `accounts.google.com/v3/signin/identifier`, not `/signin/rejected`.
- **Passkey/Touch ID does not work in Electron** (no platform WebAuthn authenticator). Tell users to use “Try another way” → password/phone. USB security keys may work (CTAP over USB is Chromium-level); the phone-QR (hybrid) path is uncertain. Documented limitation, not fixable in-app.

### 5.14 Popups: placement & “open in new tab” ⚠️
- **Center popups over the app’s own window** (`overrideBrowserWindowOptions` with computed x/y from `mainWindow.getBounds()` clamped to `screen.getDisplayMatching(...).workArea`), else macOS may open them on another monitor.
- **Distinguish tab-opens from dialogs by `disposition`:**
  - `foreground-tab`/`background-tab` (plain `window.open`/`target=_blank`, e.g. an app’s “open in new tab”): **deny the OS popup**; instead `webContents.send('context:open-url', url)` → the renderer adds it as a new app in the current context (active app’s context, else focused/first), sharing that partition, auto-named from the page title.
  - `new-window` (window.open with size features — OAuth dialogs): allow as a popup window (needed for sign-in).
- Non-http(s) `window.open` is denied; `mailto:` → `shell.openExternal`.

### 5.15 Update notifier (free, no signing) ⚠️
- On launch (5s) + every 6h, main fetches `https://api.github.com/repos/<owner/repo>/releases/latest` (unauthenticated → repo must be **public**), compares `tag_name` (strip leading `v`) to `app.getVersion()` with a numeric dotted compare, and if newer `webContents.send('update:available', {version,url})`. Renderer shows a non-blocking toast (Download opens the release page via `openExternal`; Later dismisses). Only the main app checks (not client apps).
- ⚠️ **Silent auto-update (Squirrel.Mac / electron-updater) requires a valid Developer ID signature** — impossible unsigned. This notifier is the free substitute (manual re-download).

### 5.16 Settings modal (⌘,)
- Centered, theme-aware modal (warm-dark in dark mode, clean light otherwise) styled from a reference. Grouped left nav (Workspace: General, Memory Saver, Downloads, Network; Account: Account, Updates, About). Opens via ⌘, (forwarded from webviews) and a footer gear.
- Working: **General** (Appearance/theme, **Start at login** via `app.setLoginItemSettings({openAtLogin})` — persisted, applied on launch), **Memory Saver** (sleep threshold), **Updates** (version + Check now → `checkForUpdate`), **About** (version + GitHub link). **Downloads/Network/Account** are “coming soon” placeholders.
- Theme switcher and sleep control were **moved out of the sidebar footer** into here.

---

## 6. Consolidated gotcha cheat-sheet
1. Pin `vite@^7` + `@vitejs/plugin-react@^5` (Vite 8 breaks electron-vite).
2. `allowpopups` must be a **string** attribute or all popups are silently blocked.
3. Hide inactive webviews with `opacity:0`, never `visibility:hidden`; pin the shadow iframe to 100% + ResizeObserver (cropping bug).
4. Dock apps: **clone (cp -Rc), don’t symlink Frameworks** (SIGTRAP); build in temp + atomic swap; recursive-remove `app.asar`; **don’t rename exec/CFBundleName** (helper-lookup crash); ad-hoc codesign; stub package name must match main.
5. Client apps: separate userData per context; **copy** partitions on first launch; single-instance lock is per-dir.
6. Google sign-in: present **Firefox** UA; the popup takes its UA from the **global `userAgentFallback` at creation** — swap just-in-time and restore on `did-navigate`.
7. Favicons: resolve in **main** from the URL (page-favicon-updated is unreliable; CSP blocks remote images).
8. Tailwind v4 dark mode: `@custom-variant dark` + a `.dark` class (not the media query).
9. ⌘K/⌘, must be forwarded from focused webviews via `before-input-event`.
10. Center popups over the app window; route `foreground-tab` opens in-context, keep `new-window` as popups.
11. Sleep = unmount the webview (frees the renderer); active app never sleeps.
12. Passkeys don’t work in Electron; silent auto-update needs a $99 Apple Developer signature.

---

## 7. Build & distribution
- `electron-builder.yml`: `appId: com.contextworkspace.app`, `productName: ContextWorkspace`, `asar: true`, `npmRebuild: false`, files `out/**` + `package.json`, mac targets `dmg`+`zip`, win `nsis`, linux `AppImage`.
- Dev-mode Dock-app cloning uses the Electron.app in `node_modules`; packaged it clones the installed `/Applications/ContextWorkspace.app`. Reinstall the packaged app after each build to test Dock apps + notifier against the real bundle.
- **Signing/notarization ($99 Apple Developer)** unlocks warning-free installs AND silent auto-update — deferred. Free path: unsigned DMG on public GitHub Releases; users open via System Settings → Privacy & Security → “Open Anyway” (recent macOS removed the right-click→Open shortcut); the update notifier handles “stay current”. Windows: unsigned runs with a SmartScreen “Run anyway”, and electron-updater auto-update works **without** signing.

---

## 8. Roadmap / backlog (not built)
- Per-context **downloads folder** (`will-download` → per-context save path). Low risk.
- Per-context **proxy** (`session.setProxy` per partition) — network identity; NOT a full VPN. Auth-proxy + PAC are the hard bits.
- **Optional auth** (Apple + Google, contextual, never gates): sync **only metadata** (names, urls, icons, order) — **never** session secrets. Owner model (`local` vs account). Seamless local→cloud, no migration. Build in phases: architecture → backend → UI → sync.
- **Onboarding** (first-run, 3–4 steps, an `onboarded` flag) — after the Figma UI lands.
- **AI Memory / Context Intelligence** (future epic; deterministic Context Brief is the base; no chat sidebar).
- **Rendering migration** `<webview>` → `WebContentsView` (only if webview keeps causing display/popup quirks).
- **Keychain-backed saved logins** (`safeStorage`) — iCloud Keychain can’t be read by third-party apps; this is an in-app vault alternative.
- Dock-app follow-ups: site-favicon icons, Windows shortcuts, cleanup on delete/rename/move, pin guidance.

---

## 9. Conventions
- Strict TS, `noUnused*` on. Match surrounding style; comment the *why* of non-obvious code.
- Reuse the row/toggle/control patterns; theme every surface for light AND dark.
- Verify UI changes by driving the real app (Chrome DevTools Protocol over `--remote-debugging-port`) — screenshots + DOM assertions — not just typecheck.
- Keep the renderer↔main boundary in `preload` only; never expose Node to webviews.
```
