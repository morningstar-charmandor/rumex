import { useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { ActiveApp, WorkContext } from '../../../shared/types'
import { buildSuggestions } from '../catalog'
import type { NavAction } from '../App'

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
  onCreateDockApp(contextId: string, emoji: string | null): void
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
      className="no-drag flex h-6 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"
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
      className="w-full min-w-0 rounded-md bg-zinc-800 px-2 py-1 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
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
      className="ml-4 flex flex-col gap-1 rounded-md bg-zinc-900 p-2 ring-1 ring-zinc-800"
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
        className="rounded bg-zinc-800 px-2 py-1 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
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
              i === highlight ? 'bg-zinc-800' : ''
            }`}
          >
            <span className="truncate text-[13px] text-zinc-200">{s.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-zinc-500">{s.hint}</span>
          </button>
        ))}
        {suggestions.length === 0 && (
          <span className="px-2 py-1 text-[12px] text-zinc-600">
            Keep typing, or paste a full URL
          </span>
        )}
      </div>
    </div>
  )
}

function DockAppForm(props: {
  color: string
  letter: string
  onSubmit(emoji: string | null): void
  onCancel(): void
}): JSX.Element {
  const [emoji, setEmoji] = useState('')
  return (
    <div
      className="ml-4 flex flex-col gap-1.5 rounded-md bg-zinc-900 p-2 ring-1 ring-zinc-800"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onCancel()
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base font-bold text-zinc-950"
          style={{ backgroundColor: props.color }}
        >
          {emoji.trim() || props.letter.toUpperCase()}
        </span>
        <input
          autoFocus
          value={emoji}
          placeholder="Emoji (optional)"
          onChange={(e) => setEmoji(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onSubmit(emoji.trim() || null)}
          className="w-full min-w-0 rounded bg-zinc-800 px-2 py-1 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
        />
      </div>
      <p className="text-[11px] leading-4 text-zinc-600">
        Creates a Mac app for this context — drag it to your Dock. ⌃⌘Space opens the emoji picker.
      </p>
      <div className="flex justify-end gap-1">
        <button
          onClick={props.onCancel}
          className="rounded px-2 py-0.5 text-[12px] text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={() => props.onSubmit(emoji.trim() || null)}
          className="rounded bg-zinc-100 px-2 py-0.5 text-[12px] font-medium text-zinc-900 hover:bg-white"
        >
          Create app
        </button>
      </div>
    </div>
  )
}

export default function Sidebar(props: SidebarProps): JSX.Element {
  const [addingContext, setAddingContext] = useState(false)
  const [addingAppTo, setAddingAppTo] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [dockAppFor, setDockAppFor] = useState<string | null>(null)
  const isMac = window.api.platform === 'darwin'
  const clientMode = window.api.clientContextId !== null

  const isRenamingContext = (contextId: string): boolean =>
    renaming?.kind === 'context' && renaming.contextId === contextId
  const isRenamingApp = (contextId: string, appId: string): boolean =>
    renaming?.kind === 'app' && renaming.contextId === contextId && renaming.appId === appId

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      {/* Title strip doubles as the window drag region */}
      <div className={`drag flex items-center px-4 ${isMac ? 'h-12 pl-20' : 'h-11'}`}>
        <span className="truncate text-[13px] font-semibold tracking-wide text-zinc-400">
          {clientMode ? (props.contexts[0]?.name ?? 'Workspace') : 'ContextWorkspace'}
        </span>
      </div>

      {props.activeApp && (
        <div className="flex items-center gap-0.5 border-b border-zinc-800/80 px-3 pb-2">
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
              <div className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-zinc-900">
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
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: context.color }}
                      />
                      <span className="truncate text-[13px] font-medium text-zinc-300">
                        {context.name}
                      </span>
                      <svg
                        viewBox="0 0 16 16"
                        className={`h-3 w-3 shrink-0 fill-zinc-600 transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      >
                        <path d="M6 4l4 4-4 4z" />
                      </svg>
                    </button>
                    {!clientMode && (
                      <>
                        <button
                          onClick={() => {
                            setAddingAppTo(context.id)
                            if (!isExpanded) props.onToggleExpanded(context.id)
                          }}
                          title="Add app"
                          className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 group-hover:flex"
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                            <path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z" />
                          </svg>
                        </button>
                        {isMac && (
                          <button
                            onClick={() => {
                              setDockAppFor(dockAppFor === context.id ? null : context.id)
                              if (!isExpanded) props.onToggleExpanded(context.id)
                            }}
                            title="Add to Dock as its own app"
                            className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 group-hover:flex"
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
                          className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-red-400 group-hover:flex"
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                            <path d="M6.5 2h3l.5 1H13v1.5H3V3h3zM4 6h8l-.6 8H4.6z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              {isExpanded && (
                <div className="mt-0.5 space-y-0.5">
                  {dockAppFor === context.id && (
                    <DockAppForm
                      color={context.color}
                      letter={context.name.charAt(0) || 'C'}
                      onSubmit={(emoji) => {
                        props.onCreateDockApp(context.id, emoji)
                        setDockAppFor(null)
                      }}
                      onCancel={() => setDockAppFor(null)}
                    />
                  )}
                  {context.apps.map((webApp) => {
                    const isActive =
                      props.activeApp?.contextId === context.id &&
                      props.activeApp?.appId === webApp.id
                    return (
                      <div
                        key={webApp.id}
                        className={`group ml-4 flex items-center gap-2 rounded-md px-2 py-1.5 ${
                          isActive ? 'bg-zinc-800/90' : 'hover:bg-zinc-900'
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
                                !clientMode &&
                                setRenaming({ kind: 'app', contextId: context.id, appId: webApp.id })
                              }
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              title={
                                clientMode ? webApp.url : `${webApp.url} · double-click to rename`
                              }
                            >
                              <span
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-zinc-950"
                                style={{ backgroundColor: context.color }}
                              >
                                {webApp.name.charAt(0).toUpperCase()}
                              </span>
                              <span
                                className={`truncate text-[13px] ${
                                  isActive ? 'text-zinc-100' : 'text-zinc-400'
                                }`}
                              >
                                {webApp.name}
                              </span>
                            </button>
                            {!clientMode && (
                              <button
                                onClick={() => props.onDeleteApp(context.id, webApp.id)}
                                title="Remove app and wipe its session"
                                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:flex"
                              >
                                <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                                  <path d="M4.7 3.6L8 6.9l3.3-3.3 1.1 1.1L9.1 8l3.3 3.3-1.1 1.1L8 9.1l-3.3 3.3-1.1-1.1L6.9 8 3.6 4.7z" />
                                </svg>
                              </button>
                            )}
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

                  {!clientMode && context.apps.length === 0 && addingAppTo !== context.id && (
                    <button
                      onClick={() => setAddingAppTo(context.id)}
                      className="ml-4 w-[calc(100%-1rem)] rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-600 hover:bg-zinc-900 hover:text-zinc-400"
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

      <div className={`border-t border-zinc-800/80 p-2 ${clientMode ? 'hidden' : ''}`}>
        {addingContext ? (
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
            className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            + New Context
          </button>
        )}
      </div>
    </aside>
  )
}
