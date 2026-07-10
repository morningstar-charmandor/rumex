/// <reference types="vite/client" />

import type { Api } from '../../shared/types'

/** Electron <webview> element — the subset of methods this app uses. */
export interface WebviewElement extends HTMLElement {
  reload(): void
  reloadIgnoringCache(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
}

declare global {
  interface Window {
    api: Api
  }
}
