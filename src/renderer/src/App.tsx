import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ActiveApp, AppState, Theme, UpdateInfo } from '../../shared/types'
import { partitionFor } from '../../shared/types'
import type { WebviewElement } from './env'
import { renderIconPngBase64 } from './dockIcon'
import { cleanTitle, nameFromUrl, parseBadge } from './catalog'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import CommandPalette from './components/CommandPalette'
import UpdateToast from './components/UpdateToast'
import Settings from './components/Settings'

export const CONTEXT_COLORS = [
  '#60a5fa',
  '#34d399',
  '#f472b6',
  '#fbbf24',
  '#a78bfa',
  '#f87171',
  '#2dd4bf',
  '#fb923c'
]

export function appKey(contextId: string, appId: string): string {
  return `${contextId}:${appId}`
}

export const DEFAULT_SLEEP_MINUTES = 15

function seedState(): AppState {
  const id = crypto.randomUUID()
  return {
    contexts: [{ id, name: 'Personal', color: CONTEXT_COLORS[0], apps: [] }],
    activeApp: null,
    expanded: [id]
  }
}

function activeWebview(active: ActiveApp | null): WebviewElement | null {
  if (!active) return null
  const key = appKey(active.contextId, active.appId)
  return document.querySelector<HTMLElement>(
    `webview[data-appkey="${key}"]`
  ) as WebviewElement | null
}

export type NavAction = 'back' | 'forward' | 'reload'

export default function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [navState, setNavState] = useState({ canGoBack: false, canGoForward: false })
  // Keys of app instances that have been opened this session; their webviews
  // stay mounted (just hidden) so switching contexts is instant and sessions
  // stay warm.
  const [openedKeys, setOpenedKeys] = useState<Set<string>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Mirror of the latest state for callbacks that need it without re-subscribing.
  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const openedKeysRef = useRef(openedKeys)
  openedKeysRef.current = openedKeys
  // Last time each opened app was the active one; drives auto-sleep.
  const lastActive = useRef<Map<string, number>>(new Map())
  // Always points at the latest openUrlInContext so the IPC subscription can
  // stay a one-time effect.
  const openUrlRef = useRef<(url: string) => void>(() => {})
  // Resident memory (MB) per awake app, polled from the main process.
  const [memory, setMemory] = useState<Record<string, number>>({})
  // The context whose Brief is shown when no app is active.
  const [focusedContextId, setFocusedContextId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    window.api.loadState().then((saved) => {
      const next = saved ?? seedState()
      // Repair icons saved before the one-grapheme clamp existed.
      next.contexts = next.contexts.map((c) =>
        c.icon && [...c.icon].length > 2 ? { ...c, icon: undefined } : c
      )
      setState(next)
      if (next.activeApp) {
        setOpenedKeys(new Set([appKey(next.activeApp.contextId, next.activeApp.appId)]))
      }
    })
  }, [])

  useEffect(() => {
    if (!state) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.api.saveState(state), 300)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  // Another process (main app ↔ client Dock apps) changed the shared state:
  // adopt its contexts, keep the local selection when it still exists. Events
  // caused by our own saves are no-ops because the content matches.
  useEffect(() => {
    return window.api.onStateExternalChange(async () => {
      const fresh = await window.api.loadState()
      if (!fresh) return
      setState((current) => {
        if (!current) return fresh
        if (JSON.stringify(fresh.contexts) === JSON.stringify(current.contexts)) return current
        const activeStillExists =
          current.activeApp != null &&
          fresh.contexts.some(
            (c) =>
              c.id === current.activeApp?.contextId &&
              c.apps.some((a) => a.id === current.activeApp?.appId)
          )
        return {
          ...current,
          contexts: fresh.contexts,
          activeApp: activeStillExists ? current.activeApp : null
        }
      })
    })
  }, [])

  // Chromeless navigation: Cmd/Ctrl+R reload, +Shift hard reload, Cmd/Ctrl+[ ] history.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const view = activeWebview(state?.activeApp ?? null)
      if (!view) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        e.shiftKey ? view.reloadIgnoringCache() : view.reload()
      } else if (e.key === '[' && view.canGoBack()) {
        e.preventDefault()
        view.goBack()
      } else if (e.key === ']' && view.canGoForward()) {
        e.preventDefault()
        view.goForward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state?.activeApp])

  // Track whether the active app can navigate back/forward so the sidebar
  // buttons reflect real history state. canGoBack/canGoForward throw until
  // the webview is attached, hence the try/catch.
  useEffect(() => {
    const view = activeWebview(state?.activeApp ?? null)
    if (!view) {
      setNavState({ canGoBack: false, canGoForward: false })
      return
    }
    const update = (): void => {
      try {
        setNavState({ canGoBack: view.canGoBack(), canGoForward: view.canGoForward() })
      } catch {
        setNavState({ canGoBack: false, canGoForward: false })
      }
    }
    update()
    const events = ['dom-ready', 'did-navigate', 'did-navigate-in-page', 'did-stop-loading']
    events.forEach((name) => view.addEventListener(name, update))
    return () => events.forEach((name) => view.removeEventListener(name, update))
  }, [state?.activeApp])

  const navigate = useCallback(
    (action: NavAction) => {
      const view = activeWebview(state?.activeApp ?? null)
      if (!view) return
      try {
        if (action === 'back' && view.canGoBack()) view.goBack()
        else if (action === 'forward' && view.canGoForward()) view.goForward()
        else if (action === 'reload') view.reload()
      } catch {
        // webview not attached yet — nothing to navigate
      }
    },
    [state?.activeApp]
  )

  const selectApp = useCallback((contextId: string, appId: string) => {
    const key = appKey(contextId, appId)
    lastActive.current.set(key, Date.now())
    setFocusedContextId(null)
    setOpenedKeys((prev) => new Set(prev).add(key))
    setState((s) =>
      s
        ? {
            ...s,
            activeApp: { contextId, appId },
            contexts: s.contexts.map((c) =>
              c.id === contextId ? { ...c, lastVisited: Date.now() } : c
            )
          }
        : s
    )
  }, [])

  // ⌘K toggles the command palette — from our own UI (keydown) and from inside
  // a focused web app (forwarded by the main process).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    const off = window.api.onPaletteToggle(() => setPaletteOpen((v) => !v))
    const offSettings = window.api.onSettingsToggle(() => setSettingsOpen((v) => !v))
    const offUpdate = window.api.onUpdateAvailable((info) => setUpdate(info))
    const offOpenUrl = window.api.onOpenUrlInContext((url) => openUrlRef.current(url))
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
      offSettings()
      offUpdate()
      offOpenUrl()
    }
  }, [])

  // Sleep an app: unmount its webview so its renderer process exits and frees
  // memory. The persistent partition keeps its cookies/login on disk, so
  // re-selecting it later just reloads the page.
  const sleepApp = useCallback((contextId: string, appId: string) => {
    const key = appKey(contextId, appId)
    setOpenedKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setState((s) => {
      if (!s) return s
      const active =
        s.activeApp?.contextId === contextId && s.activeApp?.appId === appId ? null : s.activeApp
      return { ...s, activeApp: active }
    })
  }, [])

  const toggleNeverSleep = useCallback((contextId: string, appId: string) => {
    setState((s) => {
      if (!s) return s
      return {
        ...s,
        contexts: s.contexts.map((c) =>
          c.id === contextId
            ? {
                ...c,
                apps: c.apps.map((a) => (a.id === appId ? { ...a, neverSleep: !a.neverSleep } : a))
              }
            : c
        )
      }
    })
  }, [])

  const setSleepAfter = useCallback((minutes: number) => {
    setState((s) => (s ? { ...s, settings: { ...s.settings, sleepAfterMinutes: minutes } } : s))
  }, [])

  const setOpenAtLogin = useCallback((open: boolean) => {
    window.api.setLoginItem(open)
    setState((s) => (s ? { ...s, settings: { ...s.settings, openAtLogin: open } } : s))
  }, [])

  // Keep the OS login item in sync with the persisted setting on launch.
  const loginApplied = useRef(false)
  useEffect(() => {
    if (!state || loginApplied.current) return
    loginApplied.current = true
    window.api.setLoginItem(state.settings?.openAtLogin ?? false)
  }, [state])

  // Poll per-app memory from the main process (workingSetSize per renderer).
  useEffect(() => {
    const poll = async (): Promise<void> => {
      const items: { key: string; webContentsId: number }[] = []
      document.querySelectorAll<HTMLElement>('webview[data-appkey]').forEach((el) => {
        const key = el.getAttribute('data-appkey')
        try {
          const id = (el as unknown as { getWebContentsId(): number }).getWebContentsId()
          if (key && id) items.push({ key, webContentsId: id })
        } catch {
          // not attached yet
        }
      })
      if (items.length === 0) {
        setMemory({})
        return
      }
      setMemory(await window.api.getMemoryUsage(items))
    }
    void poll()
    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [])

  // Auto-sleep: every tick, keep the active app fresh and sleep any non-active,
  // non-pinned app idle past the threshold.
  useEffect(() => {
    const tick = (): void => {
      const s = stateRef.current
      if (!s) return
      const minutes = s.settings?.sleepAfterMinutes ?? DEFAULT_SLEEP_MINUTES
      const activeKey = s.activeApp
        ? appKey(s.activeApp.contextId, s.activeApp.appId)
        : null
      const now = Date.now()
      if (activeKey) lastActive.current.set(activeKey, now)
      if (minutes <= 0) return
      const cutoff = now - minutes * 60_000
      for (const key of openedKeysRef.current) {
        if (key === activeKey) continue
        const [contextId, appId] = key.split(':')
        const app = s.contexts.find((c) => c.id === contextId)?.apps.find((a) => a.id === appId)
        if (!app || app.neverSleep) continue
        const seen = lastActive.current.get(key) ?? now
        if (!lastActive.current.has(key)) lastActive.current.set(key, now)
        if (seen < cutoff) sleepApp(contextId, appId)
      }
    }
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [sleepApp])

  const toggleExpanded = useCallback((contextId: string) => {
    setState((s) => {
      if (!s) return s
      const expanded = s.expanded.includes(contextId)
        ? s.expanded.filter((id) => id !== contextId)
        : [...s.expanded, contextId]
      return { ...s, expanded }
    })
  }, [])

  const addContext = useCallback((name: string) => {
    setState((s) => {
      if (!s) return s
      const context = {
        id: crypto.randomUUID(),
        name: name.trim(),
        color: CONTEXT_COLORS[s.contexts.length % CONTEXT_COLORS.length],
        apps: []
      }
      return { ...s, contexts: [...s.contexts, context], expanded: [...s.expanded, context.id] }
    })
  }, [])

  const addApp = useCallback(
    (contextId: string, name: string, url: string, autoNamed: boolean) => {
      const application = { id: crypto.randomUUID(), name: name.trim(), url, autoNamed }
      setState((s) => {
        if (!s) return s
        return {
          ...s,
          contexts: s.contexts.map((c) =>
            c.id === contextId ? { ...c, apps: [...c.apps, application] } : c
          )
        }
      })
      selectApp(contextId, application.id)
    },
    [selectApp]
  )

  // A web app opened a new tab: add it as an app in the current context (the
  // active app's context, else the focused/first one), sharing that partition.
  const openUrlInContext = useCallback(
    (url: string) => {
      const s = stateRef.current
      if (!s) return
      const targetId =
        s.activeApp?.contextId ??
        (focusedContextId && s.contexts.some((c) => c.id === focusedContextId)
          ? focusedContextId
          : s.contexts[0]?.id)
      if (targetId) addApp(targetId, nameFromUrl(url), url, true)
    },
    [addApp, focusedContextId]
  )
  openUrlRef.current = openUrlInContext

  // Reorder an app within its context by moving it from one index to another.
  // Dragging never crosses contexts (a partition is tied to its context).
  const reorderApp = useCallback((contextId: string, from: number, to: number) => {
    setState((s) => {
      if (!s) return s
      return {
        ...s,
        contexts: s.contexts.map((c) => {
          if (c.id !== contextId) return c
          if (from === to || from < 0 || to < 0 || from >= c.apps.length || to >= c.apps.length)
            return c
          const apps = [...c.apps]
          const [moved] = apps.splice(from, 1)
          apps.splice(to, 0, moved)
          return { ...c, apps }
        })
      }
    })
  }, [])

  const renameContext = useCallback((contextId: string, name: string) => {
    setState((s) => {
      if (!s || !name.trim()) return s
      return {
        ...s,
        contexts: s.contexts.map((c) => (c.id === contextId ? { ...c, name: name.trim() } : c))
      }
    })
  }, [])

  const renameApp = useCallback((contextId: string, appId: string, name: string) => {
    setState((s) => {
      if (!s || !name.trim()) return s
      return {
        ...s,
        contexts: s.contexts.map((c) =>
          c.id === contextId
            ? {
                ...c,
                apps: c.apps.map((a) =>
                  // A manual rename always wins: stop auto-naming afterwards.
                  a.id === appId ? { ...a, name: name.trim(), autoNamed: false } : a
                )
              }
            : c
        )
      }
    })
  }, [])

  // Resolve and store each app's real favicon once its page is ready. The
  // main process derives the icon from the app's URL; a ref dedupes so we
  // resolve at most once per app per session.
  const faviconResolved = useRef<Set<string>>(new Set())
  const captureFavicon = useCallback((contextId: string, appId: string) => {
    const key = appKey(contextId, appId)
    if (faviconResolved.current.has(key)) return
    faviconResolved.current.add(key)
    const app = stateRef.current?.contexts
      .find((c) => c.id === contextId)
      ?.apps.find((a) => a.id === appId)
    if (!app) return
    window.api.fetchFavicon(app.url).then((dataUri) => {
      if (!dataUri) {
        faviconResolved.current.delete(key) // allow a later retry
        return
      }
      setState((s) => {
        if (!s) return s
        return {
          ...s,
          contexts: s.contexts.map((c) =>
            c.id === contextId
              ? { ...c, apps: c.apps.map((a) => (a.id === appId ? { ...a, favicon: dataUri } : a)) }
              : c
          )
        }
      })
    })
  }, [])

  // On first load, resolve favicons for every app that doesn't have one yet,
  // so all icons appear without needing to open each app.
  const bootstrappedFavicons = useRef(false)
  useEffect(() => {
    if (!state || bootstrappedFavicons.current) return
    bootstrappedFavicons.current = true
    state.contexts.forEach((c) =>
      c.apps.forEach((a) => {
        if (!a.favicon) captureFavicon(c.id, a.id)
      })
    )
  }, [state, captureFavicon])

  const setContextIcon = useCallback(
    (contextId: string, next: { emoji?: string | null; image?: string | null }) => {
      setState((s) => {
        if (!s) return s
        return {
          ...s,
          contexts: s.contexts.map((c) =>
            c.id === contextId
              ? {
                  ...c,
                  // Emoji and image are mutually exclusive; setting one clears the other.
                  icon: 'emoji' in next ? (next.emoji ?? undefined) : c.icon,
                  iconImage: 'image' in next ? (next.image ?? undefined) : c.iconImage,
                  ...('emoji' in next && next.emoji ? { iconImage: undefined } : {}),
                  ...('image' in next && next.image ? { icon: undefined } : {})
                }
              : c
          )
        }
      })
    },
    []
  )

  // Every page-title update: refresh the unread badge, and (for apps added
  // without an explicit name) adopt the cleaned title once, then leave it.
  const handleTitle = useCallback((contextId: string, appId: string, rawTitle: string) => {
    const badge = parseBadge(rawTitle)
    setState((s) => {
      if (!s) return s
      const app = s.contexts.find((c) => c.id === contextId)?.apps.find((a) => a.id === appId)
      if (!app) return s
      const adoptName = app.autoNamed ? cleanTitle(rawTitle).trim() : ''
      if (app.badge === badge && !adoptName) return s
      return {
        ...s,
        contexts: s.contexts.map((c) =>
          c.id === contextId
            ? {
                ...c,
                apps: c.apps.map((a) =>
                  a.id === appId
                    ? {
                        ...a,
                        badge,
                        ...(adoptName ? { name: adoptName, autoNamed: false } : {})
                      }
                    : a
                )
              }
            : c
        )
      }
    })
  }, [])

  // Enter a context without a specific app: mark it visited and show its brief.
  const enterContext = useCallback((contextId: string) => {
    setFocusedContextId(contextId)
    setState((s) => {
      if (!s) return s
      return {
        ...s,
        activeApp: null,
        expanded: s.expanded.includes(contextId) ? s.expanded : [...s.expanded, contextId],
        contexts: s.contexts.map((c) =>
          c.id === contextId ? { ...c, lastVisited: Date.now() } : c
        )
      }
    })
  }, [])

  const deleteApp = useCallback((contextId: string, appId: string) => {
    if (!window.confirm('Remove this app? Its isolated session data will be wiped.')) return
    void window.api.clearPartition(partitionFor(contextId, appId))
    const key = appKey(contextId, appId)
    setOpenedKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setState((s) => {
      if (!s) return s
      const activeApp =
        s.activeApp?.contextId === contextId && s.activeApp?.appId === appId ? null : s.activeApp
      return {
        ...s,
        activeApp,
        contexts: s.contexts.map((c) =>
          c.id === contextId ? { ...c, apps: c.apps.filter((a) => a.id !== appId) } : c
        )
      }
    })
  }, [])

  const deleteContext = useCallback((contextId: string) => {
    if (!window.confirm('Delete this context and all its apps? All session data will be wiped.'))
      return
    setState((s) => {
      if (!s) return s
      const target = s.contexts.find((c) => c.id === contextId)
      target?.apps.forEach((a) => void window.api.clearPartition(partitionFor(contextId, a.id)))
      setOpenedKeys((prev) => {
        const next = new Set(prev)
        target?.apps.forEach((a) => next.delete(appKey(contextId, a.id)))
        return next
      })
      return {
        ...s,
        activeApp: s.activeApp?.contextId === contextId ? null : s.activeApp,
        contexts: s.contexts.filter((c) => c.id !== contextId),
        expanded: s.expanded.filter((id) => id !== contextId)
      }
    })
  }, [])

  const createDockApp = useCallback(
    async (contextId: string) => {
      const context = state?.contexts.find((c) => c.id === contextId)
      if (!context) return
      // Reuse whatever icon the context already shows: chosen favicon, then
      // emoji, then the letter tile.
      const iconPngBase64 = await renderIconPngBase64({
        image: context.iconImage,
        emoji: context.icon,
        letter: context.name.charAt(0) || 'C',
        color: context.color
      })
      const result = await window.api.createDockApp({
        contextId,
        contextName: context.name,
        iconPngBase64
      })
      if (!result.ok) {
        window.alert(`Could not create the Dock app: ${result.error}`)
      }
    },
    [state]
  )

  // Apply the theme to the root: toggle the `.dark` class from the chosen
  // theme, following the OS when set to "system".
  const theme = state?.theme ?? 'system'
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    return undefined
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setState((s) => (s ? { ...s, theme: next } : s))
  }, [])

  // Client mode: the window title carries the context name.
  useEffect(() => {
    if (window.api.clientContextId && state?.contexts[0]) {
      document.title = state.contexts[0].name
    }
  }, [state?.contexts])

  // Dev/test hook (CW_TEST_DOCKAPP=1): exercise the full creation path once.
  const testFired = useRef(false)
  useEffect(() => {
    if (!state || testFired.current || !window.api.testDockApp) return
    const first = state.contexts[0]
    if (!first) return
    testFired.current = true
    void createDockApp(first.id)
  }, [state, createDockApp])

  if (!state) {
    return <div className="h-full bg-white dark:bg-zinc-950" />
  }

  return (
    <div className="flex h-full bg-white text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      <Sidebar
        contexts={state.contexts}
        activeApp={state.activeApp}
        expanded={state.expanded}
        canGoBack={navState.canGoBack}
        canGoForward={navState.canGoForward}
        onNavigate={navigate}
        onSelectApp={selectApp}
        onToggleExpanded={toggleExpanded}
        onAddContext={addContext}
        onAddApp={addApp}
        onDeleteApp={deleteApp}
        onDeleteContext={deleteContext}
        onRenameContext={renameContext}
        onRenameApp={renameApp}
        onReorderApp={reorderApp}
        onCreateDockApp={createDockApp}
        onSetContextIcon={setContextIcon}
        openedKeys={openedKeys}
        memory={memory}
        onSleepApp={sleepApp}
        onToggleNeverSleep={toggleNeverSleep}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Workspace
        contexts={state.contexts}
        activeApp={state.activeApp}
        openedKeys={openedKeys}
        onTitle={handleTitle}
        onFavicon={captureFavicon}
        briefContext={
          !state.activeApp
            ? (state.contexts.find((c) => c.id === focusedContextId) ?? null)
            : null
        }
        onSelectApp={selectApp}
      />
      {paletteOpen && (
        <CommandPalette
          contexts={state.contexts}
          onSelectApp={(cid, aid) => {
            selectApp(cid, aid)
            setPaletteOpen(false)
          }}
          onEnterContext={(cid) => {
            enterContext(cid)
            setPaletteOpen(false)
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {update && <UpdateToast info={update} onDismiss={() => setUpdate(null)} />}
      {settingsOpen && (
        <Settings
          theme={theme}
          onSetTheme={setTheme}
          sleepAfterMinutes={state.settings?.sleepAfterMinutes ?? DEFAULT_SLEEP_MINUTES}
          onSetSleepAfter={setSleepAfter}
          openAtLogin={state.settings?.openAtLogin ?? false}
          onSetOpenAtLogin={setOpenAtLogin}
          appVersion={window.api.appVersion}
          onCheckUpdate={() => window.api.checkForUpdate()}
          onOpenExternal={(url) => window.api.openExternal(url)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
