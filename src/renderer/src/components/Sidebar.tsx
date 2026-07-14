import { useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { ActiveApp, MemoryUsage, WebApp, WorkContext } from '../../../shared/types'
import { buildSuggestions } from '../catalog'
import { appKey, type NavAction } from '../App'

interface SidebarProps {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  expanded: string[]
  canGoBack: boolean
  canGoForward: boolean
  onNavigate(action: NavAction): void
  onSelectApp(contextId: string, appId: string): void
  onToggleExpanded(contextId: string): void
  onAddContext(name: string): void
  onAddApp(contextId: string, name: string, url: string, autoNamed: boolean): void
  onDeleteApp(contextId: string, appId: string): void
  onDeleteContext(contextId: string): void
  onRenameContext(contextId: string, name: string): void
  onRenameApp(contextId: string, appId: string, name: string): void
  onCreateDockApp(contextId: string): void
  onSetContextIcon(
    contextId: string,
    next: { emoji?: string | null; image?: string | null }
  ): void
  onOpenPalette(): void
  onOpenSettings(): void
  openedKeys: Set<string>
  memory: MemoryUsage
  onSleepApp(contextId: string, appId: string): void
  onToggleNeverSleep(contextId: string, appId: string): void
}

type Renaming = { kind: 'context'; contextId: string } | { kind: 'app'; contextId: string; appId: string }

function NavButton(props: {
  title: string
  disabled: boolean
  onClick(): void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className="no-drag flex h-6 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {props.children}
    </button>
  )
}

function InlineInput(props: {
  placeholder: string
  initial?: string
  onSubmit(value: string): void
  onCancel(): void
}): JSX.Element {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <input
      autoFocus
      value={value}
      placeholder={props.placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) props.onSubmit(value)
        if (e.key === 'Escape') props.onCancel()
      }}
      onBlur={props.onCancel}
      onClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded-md bg-zinc-200 px-2 py-1 text-[13px] text-zinc-900 placeholder-zinc-500 outline-none ring-1 ring-zinc-300 focus:ring-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:focus:ring-zinc-500"
    />
  )
}

/**
 * Single searchable input: matches a catalog of popular apps, accepts pasted
 * URLs, and falls back to guessing "<word>.com". The app name is derived
 * automatically (and later refined from the page title for URL guesses).
 */
function AddAppForm(props: {
  onSubmit(name: string, url: string, autoNamed: boolean): void
  onCancel(): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const suggestions = useMemo(() => buildSuggestions(query), [query])
  const selected = suggestions[Math.min(highlight, suggestions.length - 1)]

  return (
    <div
      className="ml-4 flex flex-col gap-1 rounded-md bg-zinc-100 p-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onCancel()
      }}
    >
      <input
        autoFocus
        value={query}
        placeholder="Search apps or paste a URL…"
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlight(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && selected) {
            props.onSubmit(selected.name, selected.url, selected.autoNamed)
          }
        }}
        className="rounded bg-zinc-200 px-2 py-1 text-[13px] text-zinc-900 placeholder-zinc-500 outline-none ring-1 ring-zinc-300 focus:ring-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:focus:ring-zinc-500"
      />
      <div className="flex flex-col">
        {suggestions.map((s, i) => (
          <button
            key={`${s.url}-${s.name}`}
            onMouseEnter={() => setHighlight(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              props.onSubmit(s.name, s.url, s.autoNamed)
            }}
            className={`flex items-baseline gap-2 rounded px-2 py-1 text-left ${
              i === highlight ? 'bg-zinc-200 dark:bg-zinc-800' : ''
            }`}
          >
            <span className="truncate text-[13px] text-zinc-700 dark:text-zinc-200">{s.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-zinc-500">{s.hint}</span>
          </button>
        ))}
        {suggestions.length === 0 && (
          <span className="px-2 py-1 text-[12px] text-zinc-400 dark:text-zinc-600">
            Keep typing, or paste a full URL
          </span>
        )}
      </div>
    </div>
  )
}

/** A context's leading icon: chosen favicon, else emoji, else color dot. */
function ContextIcon(props: { context: WorkContext }): JSX.Element {
  const { context } = props
  if (context.iconImage) {
    return <img src={context.iconImage} alt="" className="h-4 w-4 shrink-0 rounded-[3px]" />
  }
  if (context.icon) {
    return (
      <span className="w-4 shrink-0 overflow-hidden text-center text-[13px] leading-none">
        {[...context.icon].slice(0, 2).join('')}
      </span>
    )
  }
  return (
    <span
      className="mx-1 h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: context.color }}
    />
  )
}

/** An app's leading icon: its real favicon, else a colored letter tile. */
function AppIcon(props: { app: WebApp; color: string }): JSX.Element {
  if (props.app.favicon) {
    return <img src={props.app.favicon} alt="" className="h-5 w-5 shrink-0 rounded" />
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-zinc-950"
      style={{ backgroundColor: props.color }}
    >
      {props.app.name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Popover to set a context's icon: a custom emoji, or one of the favicons
 * from the apps inside the context, or reset to the color dot.
 */
function ContextIconPicker(props: {
  context: WorkContext
  onSet(next: { emoji?: string | null; image?: string | null }): void
  onClose(): void
}): JSX.Element {
  const [emoji, setEmoji] = useState('')
  const appIcons = props.context.apps.filter((a) => a.favicon)
  return (
    <div
      className="absolute left-2 top-9 z-30 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Custom emoji
      </p>
      <input
        autoFocus
        value={emoji}
        placeholder="Type or paste an emoji…"
        onChange={(e) => setEmoji(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && emoji.trim()) {
            props.onSet({ emoji: emoji.trim() })
            props.onClose()
          }
        }}
        className="w-full rounded bg-zinc-200 px-2 py-1 text-[13px] text-zinc-900 placeholder-zinc-500 outline-none ring-1 ring-zinc-300 focus:ring-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:focus:ring-zinc-500"
      />
      <p className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Use an app icon
      </p>
      {appIcons.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-1">
          {appIcons.map((a) => (
            <button
              key={a.id}
              title={a.name}
              onClick={() => {
                props.onSet({ image: a.favicon })
                props.onClose()
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-zinc-300 hover:ring-zinc-400 dark:ring-zinc-700 dark:hover:ring-zinc-500"
            >
              <img src={a.favicon} alt={a.name} className="h-5 w-5 rounded" />
            </button>
          ))}
        </div>
      ) : (
        <p className="px-1 text-[12px] text-zinc-400 dark:text-zinc-600">
          Open an app to load its icon.
        </p>
      )}
      <div className="mt-2 flex justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <button
          onClick={() => {
            props.onSet({ emoji: null, image: null })
            props.onClose()
          }}
          className="rounded px-2 py-0.5 text-[12px] text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Reset
        </button>
        <button
          onClick={props.onClose}
          className="rounded px-2 py-0.5 text-[12px] text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Done
        </button>
      </div>
    </div>
  )
}

export default function Sidebar(props: SidebarProps): JSX.Element {
  const [addingContext, setAddingContext] = useState(false)
  const [addingAppTo, setAddingAppTo] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)
  const isMac = window.api.platform === 'darwin'
  const clientMode = window.api.clientContextId !== null

  const isRenamingContext = (contextId: string): boolean =>
    renaming?.kind === 'context' && renaming.contextId === contextId
  const isRenamingApp = (contextId: string, appId: string): boolean =>
    renaming?.kind === 'app' && renaming.contextId === contextId && renaming.appId === appId

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800/80 dark:bg-zinc-950">
      {/* Title strip doubles as the window drag region */}
      <div className={`drag flex items-center px-4 ${isMac ? 'h-12 pl-20' : 'h-11'}`}>
        <span className="truncate text-[13px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
          {clientMode
            ? `${props.contexts[0]?.icon ? `${props.contexts[0].icon} ` : ''}${props.contexts[0]?.name ?? 'Workspace'}`
            : 'ContextWorkspace'}
        </span>
      </div>

      {!clientMode && (
        <button
          onClick={props.onOpenPalette}
          title="Search contexts and apps (⌘K)"
          className="no-drag mx-2 mb-1 flex items-center gap-2 rounded-md bg-zinc-100 px-2 py-1.5 text-left text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-200/70 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:bg-zinc-800/70"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M13.5 13.5l-3-3" />
          </svg>
          <span className="flex-1 text-[12px]">Go to…</span>
          <kbd className="rounded bg-white px-1 text-[10px] font-medium text-zinc-400 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700">
            ⌘K
          </kbd>
        </button>
      )}

      {props.activeApp && (
        <div className="flex items-center gap-0.5 border-b border-zinc-200 px-3 pb-2 dark:border-zinc-800/80">
          <NavButton
            title="Back (⌘[)"
            disabled={!props.canGoBack}
            onClick={() => props.onNavigate('back')}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </NavButton>
          <NavButton
            title="Forward (⌘])"
            disabled={!props.canGoForward}
            onClick={() => props.onNavigate('forward')}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </NavButton>
          <NavButton title="Reload (⌘R)" disabled={false} onClick={() => props.onNavigate('reload')}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" />
              <path d="M13.7 1.8v3h-3" />
            </svg>
          </NavButton>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {props.contexts.map((context) => {
          const isExpanded = props.expanded.includes(context.id)
          return (
            <div key={context.id}>
              <div className="group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                {isRenamingContext(context.id) ? (
                  <InlineInput
                    placeholder="Context name"
                    initial={context.name}
                    onSubmit={(name) => {
                      props.onRenameContext(context.id, name)
                      setRenaming(null)
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <>
                    <button
                      onClick={() =>
                        !clientMode &&
                        setIconPickerFor(iconPickerFor === context.id ? null : context.id)
                      }
                      title={clientMode ? undefined : 'Change icon'}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                        clientMode ? 'cursor-default' : 'hover:bg-zinc-200 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <ContextIcon context={context} />
                    </button>
                    <button
                      onClick={() => props.onToggleExpanded(context.id)}
                      onDoubleClick={() =>
                        !clientMode && setRenaming({ kind: 'context', contextId: context.id })
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title={
                        clientMode
                          ? 'Click to collapse/expand'
                          : 'Click to collapse/expand · double-click to rename'
                      }
                    >
                      <span className="truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                        {context.name}
                      </span>
                      <svg
                        viewBox="0 0 16 16"
                        className={`h-3 w-3 shrink-0 fill-zinc-400 transition-transform dark:fill-zinc-600 ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      >
                        <path d="M6 4l4 4-4 4z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        setAddingAppTo(context.id)
                        if (!isExpanded) props.onToggleExpanded(context.id)
                      }}
                      title="Add app"
                      className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 group-hover:flex dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                        <path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z" />
                      </svg>
                    </button>
                    {!clientMode && (
                      <>
                        {isMac && (
                          <button
                            onClick={() => props.onCreateDockApp(context.id)}
                            title="Add to Dock as its own app (uses this context's icon)"
                            className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 group-hover:flex dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          >
                            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                              <path d="M8 5.5v4M6.2 7.7L8 9.5l1.8-1.8" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => props.onDeleteContext(context.id)}
                          title="Delete context"
                          className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-red-500 group-hover:flex dark:hover:bg-zinc-800 dark:hover:text-red-400"
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                            <path d="M6.5 2h3l.5 1H13v1.5H3V3h3zM4 6h8l-.6 8H4.6z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </>
                )}
                {iconPickerFor === context.id && (
                  <ContextIconPicker
                    context={context}
                    onSet={(next) => props.onSetContextIcon(context.id, next)}
                    onClose={() => setIconPickerFor(null)}
                  />
                )}
              </div>

              {isExpanded && (
                <div className="mt-0.5 space-y-0.5">
                  {context.apps.map((webApp) => {
                    const isActive =
                      props.activeApp?.contextId === context.id &&
                      props.activeApp?.appId === webApp.id
                    const key = appKey(context.id, webApp.id)
                    const awake = props.openedKeys.has(key)
                    const mb = props.memory[key]
                    return (
                      <div
                        key={webApp.id}
                        className={`group ml-4 flex items-center gap-1 rounded-md px-2 py-1.5 ${
                          isActive
                            ? 'bg-zinc-200 dark:bg-zinc-800/90'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                        }`}
                      >
                        {isRenamingApp(context.id, webApp.id) ? (
                          <InlineInput
                            placeholder="App name"
                            initial={webApp.name}
                            onSubmit={(name) => {
                              props.onRenameApp(context.id, webApp.id, name)
                              setRenaming(null)
                            }}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <>
                            <button
                              onClick={() => props.onSelectApp(context.id, webApp.id)}
                              onDoubleClick={() =>
                                setRenaming({ kind: 'app', contextId: context.id, appId: webApp.id })
                              }
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              title={
                                awake
                                  ? `${webApp.url} · double-click to rename`
                                  : `${webApp.url} · asleep — click to wake`
                              }
                            >
                              <span className={awake ? '' : 'opacity-40'}>
                                <AppIcon app={webApp} color={context.color} />
                              </span>
                              <span
                                className={`truncate text-[13px] ${
                                  isActive
                                    ? 'text-zinc-900 dark:text-zinc-100'
                                    : awake
                                      ? 'text-zinc-600 dark:text-zinc-400'
                                      : 'text-zinc-400 dark:text-zinc-500'
                                }`}
                              >
                                {webApp.name}
                              </span>
              {webApp.neverSleep && (
                                <svg
                                  viewBox="0 0 16 16"
                                  className="h-3 w-3 shrink-0 fill-none stroke-zinc-400 dark:stroke-zinc-500"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-label="Kept awake"
                                >
                                  <path d="M2.75 6.5h8v3a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z" />
                                  <path d="M10.75 7.25H12a1.5 1.5 0 0 1 0 3h-1.25" />
                                  <path d="M5 2.4c0 .8-.6 1-.6 1.9M8 2.4c0 .8-.6 1-.6 1.9" />
                                </svg>
                              )}
                            </button>
                            {/* At rest: memory (awake) or a sleep dot. On hover: actions. */}
                            <span className="shrink-0 text-[10px] tabular-nums text-zinc-400 group-hover:hidden dark:text-zinc-600">
                              {awake ? (mb ? `${mb} MB` : '') : '💤'}
                            </span>
                            <div className="hidden shrink-0 items-center group-hover:flex">
                              <button
                                onClick={() => props.onToggleNeverSleep(context.id, webApp.id)}
                                title={
                                  webApp.neverSleep
                                    ? 'Kept awake — allow sleeping'
                                    : 'Keep awake (never sleep)'
                                }
                                className={`flex h-5 w-5 items-center justify-center rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 ${
                                  webApp.neverSleep
                                    ? 'text-amber-500'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'
                                }`}
                              >
                                <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2.75 6.5h8v3a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z" />
                                  <path d="M10.75 7.25H12a1.5 1.5 0 0 1 0 3h-1.25" />
                                  <path d="M5 2.4c0 .8-.6 1-.6 1.9M8 2.4c0 .8-.6 1-.6 1.9" />
                                </svg>
                              </button>
                              {awake && (
                                <button
                                  onClick={() => props.onSleepApp(context.id, webApp.id)}
                                  title="Sleep now (frees memory)"
                                  className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-300 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                                >
                                  <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
                                  </svg>
                                </button>
                              )}
                              <button
                                onClick={() => props.onDeleteApp(context.id, webApp.id)}
                                title="Remove app and wipe its session"
                                className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-300 hover:text-red-500 dark:hover:bg-zinc-700 dark:hover:text-red-400"
                              >
                                <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                                  <path d="M4.7 3.6L8 6.9l3.3-3.3 1.1 1.1L9.1 8l3.3 3.3-1.1 1.1L8 9.1l-3.3 3.3-1.1-1.1L6.9 8 3.6 4.7z" />
                                </svg>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}

                  {addingAppTo === context.id && (
                    <AddAppForm
                      onSubmit={(name, url, autoNamed) => {
                        props.onAddApp(context.id, name, url, autoNamed)
                        setAddingAppTo(null)
                      }}
                      onCancel={() => setAddingAppTo(null)}
                    />
                  )}

                  {context.apps.length === 0 && addingAppTo !== context.id && (
                    <button
                      onClick={() => setAddingAppTo(context.id)}
                      className="ml-4 w-[calc(100%-1rem)] rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-400"
                    >
                      + Add an app…
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="flex items-center gap-1 border-t border-zinc-200 p-2 dark:border-zinc-800/80">
        {!clientMode &&
          (addingContext ? (
            <InlineInput
              placeholder="Context name (e.g. Client A)"
              onSubmit={(name) => {
                props.onAddContext(name)
                setAddingContext(false)
              }}
              onCancel={() => setAddingContext(false)}
            />
          ) : (
            <button
              onClick={() => setAddingContext(true)}
              className="flex-1 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
            >
              + New Context
            </button>
          ))}
        {!clientMode && !addingContext && (
          <button
            onClick={props.onOpenSettings}
            title="Settings (⌘,)"
            aria-label="Settings"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.25" />
              <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  )
}
