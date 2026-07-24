/** Single source of truth for the preload/main transport contract. */
export const IPC = {
  stateLoad: 'state:load',
  stateSave: 'state:save',
  stateExternalChange: 'state:external-change',
  partitionClear: 'partition:clear',
  dockAppCreate: 'dockapp:create',
  faviconFetch: 'favicon:fetch',
  metricsGet: 'metrics:get',
  paletteToggle: 'palette:toggle',
  settingsToggle: 'settings:toggle',
  contextOpenUrl: 'context:open-url',
  contextActivate: 'context:activate',
  appActivate: 'app:activate',
  updateAvailable: 'update:available',
  updateCheck: 'update:check',
  openExternal: 'open-external',
  setLoginItem: 'set-login-item',
  getAppVersion: 'get-app-version',
  notchCompatibility: 'notch:compatibility'
} as const
