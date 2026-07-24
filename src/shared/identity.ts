/** Stable key used for runtime maps and webview DOM attributes. */
export function appKey(contextId: string, appId: string): string {
  return `${contextId}:${appId}`
}
