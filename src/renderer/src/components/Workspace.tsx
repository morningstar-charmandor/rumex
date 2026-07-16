import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ActiveApp, WebApp, WorkContext } from '../../../shared/types'
import { FIREFOX_UA, isGoogleUrl, partitionForApp } from '../../../shared/types'
import { appKey } from '../App'

interface WorkspaceProps {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  openedKeys: Set<string>
  /** Raw page title; App derives both the auto-name and the unread badge. */
  onTitle(contextId: string, appId: string, rawTitle: string): void
  onFavicon(contextId: string, appId: string): void
  /** When set (and no app is active), show this context's Brief. */
  briefContext: WorkContext | null
  onSelectApp(contextId: string, appId: string): void
}

function relativeTime(ms?: number): string {
  if (!ms) return 'not visited yet'
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** "Since your last visit"-style panel shown when a context is entered. */
function ContextBrief(props: {
  context: WorkContext
  onSelectApp(contextId: string, appId: string): void
}): JSX.Element {
  const { context } = props
  const totalUnread = context.apps.reduce((sum, a) => sum + (a.badge ?? 0), 0)
  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col justify-center px-8">
      <div className="mb-1 flex items-center gap-2.5">
        {context.iconImage ? (
          <img src={context.iconImage} alt="" className="h-7 w-7 rounded-lg" />
        ) : context.icon ? (
          <span className="text-2xl leading-none">{[...context.icon].slice(0, 2).join('')}</span>
        ) : (
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: context.color }} />
        )}
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{context.name}</h1>
      </div>
      <p className="mb-5 text-[13px] text-zinc-500">
        Last opened {relativeTime(context.lastVisited)}
        {totalUnread > 0 && ` · ${totalUnread} unread waiting`}
      </p>

      {context.apps.length === 0 ? (
        <p className="text-[13px] text-zinc-500">No apps in this context yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {context.apps.map((a) => (
            <button
              key={a.id}
              onClick={() => props.onSelectApp(context.id, a.id)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
            >
              {a.favicon ? (
                <img src={a.favicon} alt="" className="h-6 w-6 shrink-0 rounded" />
              ) : (
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-zinc-950"
                  style={{ backgroundColor: context.color }}
                >
                  {a.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="flex-1 truncate text-[13px] text-zinc-800 dark:text-zinc-200">
                {a.name}
              </span>
              {a.badge ? (
                <span className="rounded-full bg-zinc-200 px-2 text-[11px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                  {a.badge} unread
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One isolated web-app instance. The <webview> is created once and kept
 * mounted for the whole session; its `partition` pins it to a persistent
 * Electron session shared with no other instance.
 */
function AppView(props: {
  context: WorkContext
  webApp: WebApp
  active: boolean
  onTitle(title: string): void
  onFavicon(): void
}): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const [loading, setLoading] = useState(true)
  const onTitleRef = useRef(props.onTitle)
  onTitleRef.current = props.onTitle
  const onFaviconRef = useRef(props.onFavicon)
  onFaviconRef.current = props.onFavicon

  useEffect(() => {
    const view = ref.current
    if (!view) return
    const onStart = (): void => setLoading(true)
    const onStop = (): void => setLoading(false)
    const onTitleUpdated = (event: Event): void => {
      const title = (event as Event & { title?: string }).title ?? ''
      onTitleRef.current(title)
    }
    // Resolve the favicon once the guest DOM is ready. The page-favicon-updated
    // webview event is unreliable (often never fires), so the main process
    // derives the icon from the app URL instead.
    const onDomReady = (): void => onFaviconRef.current()
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('page-title-updated', onTitleUpdated)
    view.addEventListener('dom-ready', onDomReady)

    // Electron's <webview> hosts the guest page in a shadow-DOM iframe that
    // can get stuck at a stale size (content renders cropped, the rest shows
    // the webview background). Pin the iframe to 100% and re-assert whenever
    // the webview element itself resizes.
    const fixGuestSize = (): void => {
      const iframe = view.shadowRoot?.querySelector('iframe')
      if (iframe) {
        iframe.style.width = '100%'
        iframe.style.height = '100%'
      }
    }
    fixGuestSize()
    view.addEventListener('dom-ready', fixGuestSize)
    const observer = new ResizeObserver(fixGuestSize)
    observer.observe(view)

    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('page-title-updated', onTitleUpdated)
      view.removeEventListener('dom-ready', onDomReady)
      view.removeEventListener('dom-ready', fixGuestSize)
      observer.disconnect()
    }
  }, [])

  return (
    <div
      className={`absolute inset-0 ${props.active ? 'z-10' : 'z-0 opacity-0 pointer-events-none'}`}
    >
      {/* allowpopups must be a string: React drops unknown boolean-valued
          attributes, and without it window.open — i.e. every sign-in popup —
          is silently blocked. */}
      <webview
        ref={ref}
        data-appkey={appKey(props.context.id, props.webApp.id)}
        src={props.webApp.url}
        partition={partitionForApp(props.context.id, props.webApp)}
        allowpopups={'true' as unknown as boolean}
        useragent={isGoogleUrl(props.webApp.url) ? FIREFOX_UA : window.api.userAgent}
      />
      {props.active && loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div
            className="h-full w-1/3 animate-pulse rounded-full"
            style={{ backgroundColor: props.context.color }}
          />
        </div>
      )}
    </div>
  )
}

export default function Workspace(props: WorkspaceProps): JSX.Element {
  const instances = props.contexts.flatMap((context) =>
    context.apps
      .filter((webApp) => props.openedKeys.has(appKey(context.id, webApp.id)))
      .map((webApp) => ({ context, webApp }))
  )

  const activeKey = props.activeApp
    ? appKey(props.activeApp.contextId, props.activeApp.appId)
    : null

  return (
    <main className="relative min-w-0 flex-1 bg-zinc-100 dark:bg-zinc-900">
      {instances.map(({ context, webApp }) => (
        <AppView
          key={appKey(context.id, webApp.id)}
          context={context}
          webApp={webApp}
          active={activeKey === appKey(context.id, webApp.id)}
          onTitle={(title) => props.onTitle(context.id, webApp.id, title)}
          onFavicon={() => props.onFavicon(context.id, webApp.id)}
        />
      ))}

      {!activeKey && props.briefContext && (
        <div className="absolute inset-0">
          <ContextBrief context={props.briefContext} onSelectApp={props.onSelectApp} />
        </div>
      )}

      {!activeKey && !props.briefContext && (
        <div className="drag flex h-full flex-col items-center justify-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-200/70 ring-1 ring-zinc-300/60 dark:bg-zinc-800/70 dark:ring-zinc-700/50">
            <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-zinc-400 dark:stroke-zinc-500" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16M3 9h6" />
            </svg>
          </div>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-500">
            Select an app from the sidebar, or create a context to get started.
          </p>
          <p className="text-[12px] text-zinc-400 dark:text-zinc-600">
            Every app instance runs in its own isolated session — no shared cookies, ever.
          </p>
        </div>
      )}
    </main>
  )
}
