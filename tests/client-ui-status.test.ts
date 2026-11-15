/**
 * Regression tests for the connection-status refresh path (no DOM needed).
 *
 * Two client-half defects lived here:
 * 1. `useViewData` short-circuited on any cached `ready` snapshot, so
 *    `reload()` (which only bumps the hook nonce) never issued a second
 *    request — the Setup tab stayed on `not_running` forever.
 * 2. The Setup view promised "this tab connects automatically" without any
 *    re-probe, so a late-started Zotero was never noticed.
 *
 * The pure decision helpers are tested directly: server-side rendering does not
 * run effects, and vitest runs with `environment: 'node'` (no jsdom).
 */
import { describe, expect, it } from 'vitest'
import { shouldServeCachedView } from '../src/client/ui.tsx'
import { statusPollIntervalMs } from '../src/client/views.tsx'
import type { ViewState } from '../src/client/store.ts'

const readyView: ViewState = { phase: 'ready', token: 1, data: { state: 'not_running' } }
const loadingView: ViewState = { phase: 'loading', token: 2 }

describe('shouldServeCachedView', () => {
  it('serves the cached snapshot on the first mount (nonce 0)', () => {
    expect(shouldServeCachedView(readyView, 0)).toBe(true)
  })

  it('refetches after reload() even when the snapshot is ready', () => {
    // The regression: nonce 1 means reload() ran; a ready cache must not win.
    expect(shouldServeCachedView(readyView, 1)).toBe(false)
  })

  it('never serves an absent snapshot', () => {
    expect(shouldServeCachedView(undefined, 0)).toBe(false)
  })

  it('never serves a non-ready snapshot', () => {
    expect(shouldServeCachedView(loadingView, 1)).toBe(false)
  })
})

describe('statusPollIntervalMs', () => {
  it('stops polling once connected', () => {
    expect(statusPollIntervalMs('ready')).toBeNull()
  })

  it('does not poll before the first probe result', () => {
    expect(statusPollIntervalMs(undefined)).toBeNull()
  })

  it('polls every 5 s while Zotero is not running', () => {
    expect(statusPollIntervalMs('not_running')).toBe(5000)
  })

  it('polls every 5 s on probe errors', () => {
    expect(statusPollIntervalMs('error')).toBe(5000)
  })
})
