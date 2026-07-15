import { useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { Theme } from '../../../shared/types'

type Section = 'general' | 'memory' | 'downloads' | 'network' | 'account' | 'updates' | 'about'

interface SettingsProps {
  theme: Theme
  onSetTheme(theme: Theme): void
  sleepAfterMinutes: number
  onSetSleepAfter(minutes: number): void
  openAtLogin: boolean
  onSetOpenAtLogin(open: boolean): void
  appVersion: string
  onCheckUpdate(): void
  onOpenExternal(url: string): void
  onClose(): void
}

const NAV: { group: string; items: { id: Section; label: string; icon: JSX.Element }[] }[] = [
  {
    group: 'Workspace',
    items: [
      { id: 'general', label: 'General', icon: icon('M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1') },
      { id: 'memory', label: 'Memory Saver', icon: icon('M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z') },
      { id: 'downloads', label: 'Downloads', icon: icon('M8 10.5V2.5M4.5 7L8 10.5 11.5 7M2.5 13h11') },
      { id: 'network', label: 'Network', icon: icon('M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2.5 8h11M8 2.5c1.5 1.5 2.3 3.5 2.3 5.5S9.5 12 8 13.5M8 2.5C6.5 4 5.7 6 5.7 8S6.5 12 8 13.5') }
    ]
  },
  {
    group: 'Account',
    items: [
      { id: 'account', label: 'Account', icon: icon('M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3.5 13a4.5 4.5 0 019 0') },
      { id: 'updates', label: 'Updates', icon: icon('M13.5 8a5.5 5.5 0 11-1.7-3.97M13.7 1.8v3h-3') },
      { id: 'about', label: 'About', icon: icon('M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 7v4M8 5h.01') }
    ]
  }
]

function icon(d: string): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

function Row(props: { label: string; description: string; children: ReactNode; last?: boolean }): JSX.Element {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-3.5 ${
        props.last ? '' : 'border-b border-zinc-200 dark:border-[#2a2925]'
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] text-zinc-800 dark:text-[#ededea]">{props.label}</div>
        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-[#8a887f]">{props.description}</div>
      </div>
      <div className="shrink-0">{props.children}</div>
    </div>
  )
}

function Toggle(props: { on: boolean; onChange(on: boolean): void }): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={props.on}
      onClick={() => props.onChange(!props.on)}
      className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
        props.on ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-[#3a3833]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all ${
          props.on ? 'right-0.5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function SectionHeader(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="mb-4 text-[15px] font-medium text-zinc-900 dark:text-[#f2f1ee]">
      {props.children}
    </div>
  )
}

function Placeholder(props: { title: string; blurb: string; ticket: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 p-5 dark:border-[#34322d]">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-zinc-700 dark:text-[#d7d5cd]">{props.title}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-[#262521] dark:text-[#8a887f]">
          Coming soon
        </span>
      </div>
      <p className="mt-2 max-w-sm text-[12px] leading-5 text-zinc-500 dark:text-[#8a887f]">
        {props.blurb}
      </p>
    </div>
  )
}

const SELECT_CLASS =
  'rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[12px] text-zinc-700 outline-none ring-1 ring-zinc-200 dark:bg-[#262521] dark:text-[#cfcdc5] dark:ring-[#302e2a]'

export default function Settings(props: SettingsProps): JSX.Element {
  const [section, setSection] = useState<Section>('general')

  const appearanceOptions: { value: Theme; label: string; d: string }[] = [
    { value: 'light', label: 'Light', d: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5V3M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1' },
    { value: 'dark', label: 'Dark', d: 'M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z' },
    { value: 'system', label: 'System', d: 'M2 3.5h12v7H2zM6 13.5h4M8 10.5v3' }
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={props.onClose}
    >
      <div
        className="flex h-[460px] w-[680px] max-w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-[#302e2a] dark:bg-[#1b1a18]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
      >
        <nav className="w-48 shrink-0 border-r border-zinc-200 p-2.5 dark:border-[#2a2925]">
          {NAV.map((grp) => (
            <div key={grp.group} className="mb-2">
              <div className="px-2 pb-1.5 pt-2 text-[11px] text-zinc-400 dark:text-[#78766d]">
                {grp.group}
              </div>
              {grp.items.map((it) => {
                const active = section === it.id
                return (
                  <button
                    key={it.id}
                    onClick={() => setSection(it.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left ${
                      active
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-[#2c2b26] dark:text-[#f2f1ee]'
                        : 'text-zinc-600 hover:bg-zinc-50 dark:text-[#b9b7af] dark:hover:bg-[#232220]'
                    }`}
                  >
                    <span className={active ? '' : 'text-zinc-400 dark:text-[#8a887f]'}>
                      {it.icon}
                    </span>
                    <span className="text-[13px]">{it.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="relative flex-1 overflow-y-auto px-6 py-5">
          <button
            onClick={props.onClose}
            aria-label="Close settings"
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-[#8a887f] dark:hover:bg-[#262521] dark:hover:text-[#ededea]"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>

          {section === 'general' && (
            <>
              <SectionHeader>General</SectionHeader>
              <Row label="Appearance" description="How ContextWorkspace looks">
                <div className="flex gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-[#262521]">
                  {appearanceOptions.map((o) => {
                    const active = props.theme === o.value
                    return (
                      <button
                        key={o.value}
                        onClick={() => props.onSetTheme(o.value)}
                        title={o.label}
                        aria-label={o.label}
                        className={`flex h-[26px] w-[30px] items-center justify-center rounded-md ${
                          active
                            ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#3a3833] dark:text-[#f2f1ee]'
                            : 'text-zinc-500 dark:text-[#8a887f]'
                        }`}
                      >
                        <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d={o.d} />
                        </svg>
                      </button>
                    )
                  })}
                </div>
              </Row>
              <Row
                label="Start at login"
                description="Open automatically when you sign in to your Mac"
                last
              >
                <Toggle on={props.openAtLogin} onChange={props.onSetOpenAtLogin} />
              </Row>
            </>
          )}

          {section === 'memory' && (
            <>
              <SectionHeader>Memory Saver</SectionHeader>
              <Row
                label="Sleep idle apps"
                description="Apps you haven't used in a while sleep to free memory"
              >
                <select
                  value={props.sleepAfterMinutes}
                  onChange={(e) => props.onSetSleepAfter(Number(e.target.value))}
                  className={SELECT_CLASS}
                >
                  <option value={0}>Off</option>
                  <option value={5}>After 5 min</option>
                  <option value={15}>After 15 min</option>
                  <option value={30}>After 30 min</option>
                  <option value={60}>After 1 hour</option>
                </select>
              </Row>
              <Row label="Keep an app awake" description="Set per app with the ☕ button in the sidebar" last>
                <span className="text-[12px] text-zinc-400 dark:text-[#8a887f]">In the sidebar</span>
              </Row>
            </>
          )}

          {section === 'downloads' && (
            <>
              <SectionHeader>Downloads</SectionHeader>
              <Placeholder
                title="Per-context downloads folder"
                blurb="Files downloaded in each context will land in their own folder, so a client's assets never mix with another's."
                ticket="22"
              />
            </>
          )}

          {section === 'network' && (
            <>
              <SectionHeader>Network</SectionHeader>
              <Placeholder
                title="Per-context proxy"
                blurb="Route each context's web traffic through its own proxy, so entering a context brings the right network identity. Not a full system VPN."
                ticket="23"
              />
            </>
          )}

          {section === 'account' && (
            <>
              <SectionHeader>Account</SectionHeader>
              <p className="mb-4 max-w-sm text-[12px] leading-5 text-zinc-500 dark:text-[#8a887f]">
                Sign in to sync your contexts, back them up, and restore them on another Mac. The app
                stays fully usable without an account.
              </p>
              <Placeholder
                title="Continue with Apple or Google"
                blurb="Optional sign-in. Only context names and app links would sync — never your logins or session data, which always stay on this Mac."
                ticket="26"
              />
            </>
          )}

          {section === 'updates' && (
            <>
              <SectionHeader>Updates</SectionHeader>
              <Row label="Current version" description="You're on this build of ContextWorkspace">
                <span className="text-[12px] text-zinc-600 dark:text-[#cfcdc5]">{props.appVersion}</span>
              </Row>
              <Row
                label="Check for updates"
                description="Notifies you when a newer version is published"
                last
              >
                <button
                  onClick={props.onCheckUpdate}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800 dark:bg-[#f2f1ee] dark:text-[#1b1a18] dark:hover:bg-white"
                >
                  Check now
                </button>
              </Row>
            </>
          )}

          {section === 'about' && (
            <>
              <SectionHeader>About</SectionHeader>
              <p className="text-[13px] text-zinc-800 dark:text-[#ededea]">ContextWorkspace</p>
              <p className="mt-1 text-[12px] text-zinc-500 dark:text-[#8a887f]">
                A Context OS for your web apps — isolated workspaces per client or project.
              </p>
              <p className="mt-3 text-[12px] text-zinc-500 dark:text-[#8a887f]">
                Version {props.appVersion}
              </p>
              <button
                onClick={() =>
                  props.onOpenExternal('https://github.com/morningstar-charmandor/rumex')
                }
                className="mt-4 rounded-lg px-3 py-1.5 text-[12px] text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:text-[#cfcdc5] dark:ring-[#302e2a] dark:hover:bg-[#232220]"
              >
                View on GitHub
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
