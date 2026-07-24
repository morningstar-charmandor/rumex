import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppState } from '../../../shared/types'

/** Persist local state and reconcile context changes written by Dock clients. */
export function useStatePersistence(
  state: AppState | null,
  setState: Dispatch<SetStateAction<AppState | null>>
): void {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!state) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void window.api.saveState(state), 300)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  useEffect(
    () =>
      window.api.onStateExternalChange(async () => {
        const fresh = await window.api.loadState()
        if (!fresh) return
        setState((current) => {
          if (!current) return fresh
          if (JSON.stringify(fresh.contexts) === JSON.stringify(current.contexts)) return current
          const activeStillExists =
            current.activeApp != null &&
            fresh.contexts.some(
              (context) =>
                context.id === current.activeApp?.contextId &&
                context.apps.some((app) => app.id === current.activeApp?.appId)
            )
          return {
            ...current,
            contexts: fresh.contexts,
            activeApp: activeStillExists ? current.activeApp : null
          }
        })
      }),
    [setState]
  )
}
