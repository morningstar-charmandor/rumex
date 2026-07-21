import assert from 'node:assert/strict'
import test from 'node:test'
import { iconLinksFromHtml } from '../src/main/faviconService.ts'
import { isNewerVersion } from '../src/main/updateService.ts'
import { appKey } from '../src/shared/identity.ts'
import { normalizeAppState } from '../src/shared/state.ts'

test('app keys remain compatible with persisted runtime maps', () => {
  assert.equal(appKey('context-id', 'app-id'), 'context-id:app-id')
})

test('state normalization preserves valid data and repairs dangling references', () => {
  const normalized = normalizeAppState({
    contexts: [
      {
        id: 'c1',
        name: 'Work',
        color: '#fff',
        apps: [{ id: 'a1', name: 'Mail', url: 'https://mail.example.com' }]
      },
      { id: 'c1', name: 'Duplicate', color: '#000', apps: [] },
      { broken: true }
    ],
    activeApp: { contextId: 'c1', appId: 'missing' },
    expanded: ['c1', 'missing', 'c1'],
    theme: 'unsupported',
    settings: { sleepAfterMinutes: -10, openAtLogin: true }
  })

  assert.deepEqual(normalized, {
    contexts: [
      {
        id: 'c1',
        name: 'Work',
        color: '#fff',
        apps: [{ id: 'a1', name: 'Mail', url: 'https://mail.example.com' }]
      }
    ],
    activeApp: null,
    expanded: ['c1'],
    settings: { sleepAfterMinutes: 0, openAtLogin: true }
  })
})

test('favicon candidates prefer touch and larger declared icons', () => {
  const links = iconLinksFromHtml(
    '<link rel="icon" sizes="32x32" href="/small.png">' +
      '<link rel="apple-touch-icon" href="touch.png">',
    'https://example.com/account'
  )
  assert.deepEqual(links, [
    'https://example.com/touch.png',
    'https://example.com/small.png'
  ])
})

test('version comparison preserves dotted release semantics', () => {
  assert.equal(isNewerVersion('0.2.0', '0.1.9'), true)
  assert.equal(isNewerVersion('1.0', '1.0.0'), false)
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), false)
})
