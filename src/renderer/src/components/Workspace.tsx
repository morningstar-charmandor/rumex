import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ActiveApp, WebApp, WorkContext } from '../../../shared/types'
import { FIREFOX_UA, isGoogleUrl, partitionFor } from '../../../shared/types'
import { cleanTitle } from '../catalog'
import { appKey } from '../App'

interface WorkspaceProps {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  openedKeys: Set<string>
  onAutoName(contextId: string, appId: string, title: string): void
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
}): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const [loading, setLoading] = useState(true)
  const onTitleRef = useRef(props.onTitle)
  onTitleRef.current = props.onTitle

  useEffect(() => {
    const view = ref.current
    if (!view) return
    const onStart = (): void => setLoading(true)
    const onStop = (): void => setLoading(false)
    const onTitleUpdated = (event: Event): void => {
      const title = (event as Event & { title?: string }).title ?? ''
      onTitleRef.current(cleanTitle(title))
    }
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('page-title-updated', onTitleUpdated)

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
        partition={partitionFor(props.context.id, props.webApp.id)}
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
    <main className="relative min-w-0 flex-1 bg-zinc-900">
      {instances.map(({ context, webApp }) => (
        <AppView
          key={appKey(context.id, webApp.id)}
          context={context}
          webApp={webApp}
          active={activeKey === appKey(context.id, webApp.id)}
          onTitle={(title) => props.onAutoName(context.id, webApp.id, title)}
        />
      ))}

      {!activeKey && (
        <div className="drag flex h-full flex-col items-center justify-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800/70 ring-1 ring-zinc-700/50">
            <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-zinc-500" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16M3 9h6" />
            </svg>
          </div>
          <p className="text-[13px] text-zinc-500">
            Select an app from the sidebar, or create a context to get started.
          </p>
          <p className="text-[12px] text-zinc-600">
            Every app instance runs in its own isolated session — no shared cookies, ever.
          </p>
        </div>
      )}
    </main>
  )
}
