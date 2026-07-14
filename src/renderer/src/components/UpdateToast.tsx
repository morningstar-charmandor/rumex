import type { JSX } from 'react'
import type { UpdateInfo } from '../../../shared/types'

/** Non-blocking notice shown when a newer published version exists. */
export default function UpdateToast(props: {
  info: UpdateInfo
  onDismiss(): void
}): JSX.Element {
  return (
    <div className="absolute bottom-4 right-4 z-40 flex w-72 items-start gap-3 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
        <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-zinc-500" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10.5V2.5M4.5 7L8 10.5 11.5 7M2.5 13h11" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Update available</p>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Version {props.info.version} is ready to download.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => {
              window.api.openExternal(props.info.url)
              props.onDismiss()
            }}
            className="rounded-md bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Download
          </button>
          <button
            onClick={props.onDismiss}
            className="rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
