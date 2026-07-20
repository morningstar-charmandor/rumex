import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { WorkContext } from '../../../shared/types'

interface Entry {
  kind: 'context' | 'app'
  contextId: string
  appId?: string
  label: string
  sub: string
  color: string
  icon?: string
  favicon?: string
  badge?: number
}

/** Case-insensitive subsequence match, so "fig" matches "Figma". */
function matches(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return true
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length
}

export default function CommandPalette(props: {
  contexts: WorkContext[]
  onSelectApp(contextId: string, appId: string): void
  onEnterContext(contextId: string): void
  onClose(): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = []
    for (const c of props.contexts) {
      all.push({
        kind: 'context',
        contextId: c.id,
        label: c.name,
        sub: `${c.apps.length} app${c.apps.length === 1 ? '' : 's'}`,
        color: c.color,
        icon: c.iconImage ?? c.icon
      })
      for (const a of c.apps) {
        all.push({
          kind: 'app',
          contextId: c.id,
          appId: a.id,
          label: a.name,
          sub: c.name,
          color: c.color,
          favicon: a.favicon,
          badge: a.badge
        })
      }
    }
    const q = query.trim()
    if (!q) return all
    return all.filter((e) => matches(q, e.label) || matches(q, e.sub))
  }, [props.contexts, query])

  const clampedHighlight = Math.min(highlight, Math.max(entries.length - 1, 0))

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${clampedHighlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clampedHighlight])

  const choose = (e: Entry): void => {
    if (e.kind === 'app' && e.appId) props.onSelectApp(e.contextId, e.appId)
    else props.onEnterContext(e.contextId)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh] backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className="w-[min(560px,92vw)] overflow-hidden rounded-xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, entries.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && entries[clampedHighlight]) {
            e.preventDefault()
            choose(entries[clampedHighlight])
          }
        }}
      >
        <input
          autoFocus
          value={query}
          placeholder="Go to a space or app…"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 text-[15px] text-zinc-900 placeholder-zinc-400 outline-none dark:border-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {entries.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-zinc-400">No matches</p>
          )}
          {entries.map((e, i) => {
            const active = i === clampedHighlight
            return (
              <button
                key={`${e.kind}-${e.contextId}-${e.appId ?? ''}`}
                data-idx={i}
                onMouseMove={() => setHighlight(i)}
                onClick={() => choose(e)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                  active ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                }`}
              >
                {e.kind === 'app' ? (
                  e.favicon ? (
                    <img src={e.favicon} alt="" className="h-5 w-5 shrink-0 rounded" />
                  ) : (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-zinc-950"
                      style={{ backgroundColor: e.color }}
                    >
                      {e.label.charAt(0).toUpperCase()}
                    </span>
                  )
                ) : e.icon ? (
                  e.icon.startsWith('data:') ? (
                    <img src={e.icon} alt="" className="h-5 w-5 shrink-0 rounded-[4px]" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[13px]">
                      {[...e.icon].slice(0, 2).join('')}
                    </span>
                  )
                ) : (
                  <span
                    className="ml-1.5 mr-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: e.color }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-zinc-800 dark:text-zinc-100">
                    {e.label}
                  </span>
                </span>
                {e.badge ? (
                  <span className="shrink-0 rounded-full bg-zinc-200 px-1.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {e.badge}
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {e.kind === 'context' ? 'Space' : e.sub}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
