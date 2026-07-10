import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ActiveApp, AppState } from '../../shared/types'
import { partitionFor } from '../../shared/types'
import type { WebviewElement } from './env'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'

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

  useEffect(() => {
    window.api.loadState().then((saved) => {
      const next = saved ?? seedState()
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
    setOpenedKeys((prev) => new Set(prev).add(appKey(contextId, appId)))
    setState((s) => (s ? { ...s, activeApp: { contextId, appId } } : s))
  }, [])

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

  // When an app was added without an explicit name, adopt the page title the
  // first time the site reports one, then leave the name alone.
  const autoNameApp = useCallback((contextId: string, appId: string, title: string) => {
    if (!title.trim()) return
    setState((s) => {
      if (!s) return s
      const app = s.contexts.find((c) => c.id === contextId)?.apps.find((a) => a.id === appId)
      if (!app?.autoNamed) return s
      return {
        ...s,
        contexts: s.contexts.map((c) =>
          c.id === contextId
            ? {
                ...c,
                apps: c.apps.map((a) =>
                  a.id === appId ? { ...a, name: title, autoNamed: false } : a
                )
              }
            : c
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

  if (!state) {
    return <div className="h-full bg-zinc-950" />
  }

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-200">
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
      />
      <Workspace
        contexts={state.contexts}
        activeApp={state.activeApp}
        openedKeys={openedKeys}
        onAutoName={autoNameApp}
      />
    </div>
  )
}
