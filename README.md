# ContextWorkspace

A lightweight desktop app for running **multiple isolated instances of the same web apps** (Figma, Slack, Jira, Notion, …), grouped by project or client **Contexts** — with zero cookie leakage between them.

Log into Figma as *Client A* and Figma as *Client B* side by side. Each app instance runs in its own persistent Electron session partition, so cookies, localStorage, IndexedDB, and cache are never shared.

## How isolation works

Every app instance gets a unique partition:

```
persist:ctx-<contextId>-app-<appId>
```

Electron's `session.fromPartition` guarantees each partition is a fully separate storage universe. The main process enforces this in `will-attach-webview` — a webview without a `persist:` partition is refused. Removing an app (or a whole context) wipes its partition via `clearStorageData()` + `clearCache()`.

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
