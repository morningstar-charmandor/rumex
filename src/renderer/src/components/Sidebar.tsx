import { useState } from 'react'
import type { JSX } from 'react'
import type { ActiveApp, WorkContext } from '../../../shared/types'

interface SidebarProps {
  contexts: WorkContext[]
  activeApp: ActiveApp | null
  expanded: string[]
  onSelectApp(contextId: string, appId: string): void
  onToggleExpanded(contextId: string): void
  onAddContext(name: string): void
  onAddApp(contextId: string, name: string, url: string): void
  onDeleteApp(contextId: string, appId: string): void
  onDeleteContext(contextId: string): void
}

function InlineInput(props: {
  placeholder: string
  onSubmit(value: string): void
  onCancel(): void
}): JSX.Element {
  const [value, setValue] = useState('')
  return (
    <input
      autoFocus
      value={value}
      placeholder={props.placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) props.onSubmit(value)
        if (e.key === 'Escape') props.onCancel()
      }}
      onBlur={props.onCancel}
      className="w-full rounded-md bg-zinc-800 px-2 py-1 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
    />
  )
}

function AddAppForm(props: {
  onSubmit(name: string, url: string): void
  onCancel(): void
}): JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const submit = (): void => {
    if (name.trim() && url.trim()) props.onSubmit(name, url)
  }
  return (
    <div
      className="ml-4 flex flex-col gap-1 rounded-md bg-zinc-900 p-2 ring-1 ring-zinc-800"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onCancel()
      }}
    >
      <input
        autoFocus
        value={name}
        placeholder="Name (e.g. Figma)"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="rounded bg-zinc-800 px-2 py-1 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
      />
      <input
        value={url}
        placeholder="URL (e.g. figma.com)"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="rounded bg-zinc-800 px-2 py-1 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
      />
      <div className="mt-1 flex justify-end gap-1">
        <button
          onClick={props.onCancel}
          className="rounded px-2 py-0.5 text-[12px] text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!name.trim() || !url.trim()}
          className="rounded bg-zinc-100 px-2 py-0.5 text-[12px] font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

export default function Sidebar(props: SidebarProps): JSX.Element {
  const [addingContext, setAddingContext] = useState(false)
  const [addingAppTo, setAddingAppTo] = useState<string | null>(null)
  const isMac = window.api.platform === 'darwin'

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      {/* Title strip doubles as the window drag region */}
      <div className={`drag flex items-center px-4 ${isMac ? 'h-12 pl-20' : 'h-11'}`}>
        <span className="text-[13px] font-semibold tracking-wide text-zinc-400">
          ContextWorkspace
        </span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {props.contexts.map((context) => {
          const isExpanded = props.expanded.includes(context.id)
          return (
            <div key={context.id}>
              <div className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-zinc-900">
                <button
                  onClick={() => props.onToggleExpanded(context.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={isExpanded ? 'Collapse' : 'Expand'}
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
                <button
                  onClick={() => props.onDeleteContext(context.id)}
                  title="Delete context"
                  className="hidden h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-red-400 group-hover:flex"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                    <path d="M6.5 2h3l.5 1H13v1.5H3V3h3zM4 6h8l-.6 8H4.6z" />
                  </svg>
                </button>
              </div>

              {isExpanded && (
                <div className="mt-0.5 space-y-0.5">
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
                        <button
                          onClick={() => props.onSelectApp(context.id, webApp.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
                        <button
                          onClick={() => props.onDeleteApp(context.id, webApp.id)}
                          title="Remove app and wipe its session"
                          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:flex"
                        >
                          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                            <path d="M4.7 3.6L8 6.9l3.3-3.3 1.1 1.1L9.1 8l3.3 3.3-1.1 1.1L8 9.1l-3.3 3.3-1.1-1.1L6.9 8 3.6 4.7z" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}

                  {addingAppTo === context.id && (
                    <AddAppForm
                      onSubmit={(name, url) => {
                        props.onAddApp(context.id, name, url)
                        setAddingAppTo(null)
                      }}
                      onCancel={() => setAddingAppTo(null)}
                    />
                  )}

                  {context.apps.length === 0 && addingAppTo !== context.id && (
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

      <div className="border-t border-zinc-800/80 p-2">
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
