import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ActiveApp, WebApp, WorkContext } from '../../../shared/types'
import { partitionFor } from '../../../shared/types'
import { appKey } from '../App'

interface WorkspaceProps {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  openedKeys: Set<string>
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
}): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const view = ref.current
    if (!view) return
    const onStart = (): void => setLoading(true)
    const onStop = (): void => setLoading(false)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
    }
  }, [])

  return (
    <div
      className={`absolute inset-0 ${props.active ? '' : 'invisible pointer-events-none'}`}
    >
      <webview
        ref={ref}
        data-appkey={appKey(props.context.id, props.webApp.id)}
        src={props.webApp.url}
        partition={partitionFor(props.context.id, props.webApp.id)}
        allowpopups={true}
        useragent={window.api.userAgent}
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
