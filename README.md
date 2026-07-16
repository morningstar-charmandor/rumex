# Rumex

A lightweight desktop app for running **multiple isolated instances of the same web apps** (Figma, Slack, Jira, Notion, …), grouped by project or client **Contexts** — with zero cookie leakage between them.

Log into Figma as *Client A* and Figma as *Client B* side by side. Each app instance runs in its own persistent Electron session partition, so cookies, localStorage, IndexedDB, and cache are never shared.

## How isolation works

Every app instance gets a unique partition:

```
persist:ctx-<contextId>-app-<appId>
```

Electron's `session.fromPartition` guarantees each partition is a fully separate storage universe. The main process enforces this in `will-attach-webview` — a webview without a `persist:` partition is refused. Removing an app (or a whole context) wipes its partition via `clearStorageData()` + `clearCache()`.

Pages opened from an app with “open in new tab” deliberately reuse that app's partition, so they retain its authenticated session; independently added apps always receive their own partition.

OAuth popups opened by a web app inherit that app's partition, so sign-in flows work while staying inside the sandbox.

## Layout

- **Sidebar (left, 240px)** — your Contexts and the apps under them. Create contexts, add apps by name + URL, delete either (deleting wipes session data).
- **Workspace (everything else)** — the active web app, rendered chromeless: no URL bar, no navigation buttons. Opened apps stay mounted in the background, so switching is instant.

Keyboard shortcuts (since there is no browser chrome):

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + R` | Reload active app |
| `Cmd/Ctrl + Shift + R` | Hard reload (ignore cache) |
| `Cmd/Ctrl + [` | Back |
| `Cmd/Ctrl + ]` | Forward |

## Icons

Apps show their **real favicon** (the icon they use in a normal browser), resolved in the main process from the app's URL (page `<link rel=icon>` → `/favicon.ico` → favicon service) and cached as a data URI, so the strict renderer CSP still blocks remote images.

Click a context's leading icon to open the **icon picker**: set a custom emoji, or pick any favicon from the apps inside that context, or reset to the color dot. The chosen icon shows in the sidebar and is reused as the context's Dock-app icon (emoji rendered, or the favicon drawn onto the tile).

## Per-context Dock apps (macOS)

Hover a context in the sidebar and click the **Add to Dock** icon: Rumex generates a real Mac app for that context in `~/Applications/ContextWorkspace Apps/` — own Dock tile, own name, own icon (pick an emoji, or keep the letter tile in the context color). Opening it shows a window with only that context's apps.

How it works: the wrapper is an APFS copy-on-write clone of the app bundle (near-zero disk cost) whose app payload is a stub that pins `CW_CONTEXT_ID` and delegates to the real main entry. Client apps run with their own data directory (`~/Library/Application Support/ContextWorkspace-Clients/<contextId>`); on first launch the context's session partitions are **copied** from the main app so logins carry over. From then on the two stores are independent. (A symlinked `Contents/Frameworks` does not work — Electron SIGTRAPs on startup — hence the clone.)

## Command palette (⌘K)

Press **⌘K** anywhere — including while a web app is focused — to open a Spotlight-style palette. Fuzzy-search across every context and app; Enter on an app opens it, Enter on a context enters it (showing its Context Brief). Also reachable via the "Go to…" bar at the top of the sidebar. The shortcut works inside webviews because the main process intercepts it (`before-input-event`) and forwards it to the UI.

## Context Brief

Entering a context without picking a specific app shows a Brief in the workspace: the context, when it was last opened, and its apps with any unread counts, each clickable to enter. Unread counts are parsed deterministically from webview page titles (e.g. "Inbox (397)", "(3) Slack"). AI summaries are a future additive layer — this is the honest, deterministic base.

## Memory Saver

Apps you haven't looked at for a while are automatically put to sleep — their `<webview>` is unmounted so the renderer process exits and frees its memory. The persistent partition keeps cookies/login on disk, so re-selecting a sleeping app just reloads the page (you stay signed in). The active app never sleeps.

- **Threshold**: a control in the sidebar footer (Off / 5 / 15 / 30 min / 1 hour), default 15 min.
- **Sleep now**: hover an app → the moon button sleeps it immediately.
- **Never sleep**: hover an app → the star button pins it awake (for apps that must keep notifying, e.g. Slack). Pinned apps show a small star.
- **Memory readout**: each awake app shows its resident memory (MB) at rest; sleeping apps show 💤.

## Persistence

- `app-state.json` — contexts, apps, last active app (in Electron's `userData` dir)
- `window-state.json` — window bounds + maximized state, validated against connected displays on launch so the window never restores off-screen

## Development

```bash
npm install
npm run dev        # hot-reloading dev build
npm run typecheck  # strict TS across main / preload / renderer
```

## Packaging

```bash
npm run dist:mac   # DMG + zip
npm run dist:win   # NSIS installer
npm run dist       # current platform
```

Binaries land in `dist/`.

## Stack

Electron + TypeScript (strict) · React 19 · Tailwind CSS v4 · electron-vite · electron-builder

## Project structure

```
src/
  main/       Electron main process (window state, IPC, partition wiping, webview hardening)
  preload/    contextBridge API surface (the only bridge between renderer and main)
  shared/     Types + partition naming shared by all processes
  renderer/   React UI (sidebar, workspace, webview host)
```
