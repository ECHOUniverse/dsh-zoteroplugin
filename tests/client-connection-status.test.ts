/**
 * Unit tests for the connection-status mapping (pure functions, node env).
 *
 * The tone/reason decisions are the contract between the probe result and the
 * two indicator surfaces, so they are tested directly; the render-level
 * wiring is covered by tests/client-views.test.tsx (static markup) and the
 * built bundle by scripts/smoke.mjs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DICTIONARIES, en, zh } from '../src/client/i18n.ts'
import {
  canOpenZotero,
  connectionTone,
  showsConnectionStrip,
  statusLabelKey,
  statusPollIntervalMs,
  statusReasonKey,
} from '../src/client/status.ts'
import type { StatusResponse } from '../src/shared/protocol.ts'

/** Probe payload builder: only the fields the mapping reads. */
function status(state: StatusResponse['state'], overrides: Partial<StatusResponse> = {}): StatusResponse {
  return { plugin: 'p', state, baseUrl: 'http://127.0.0.1:23119', checkedAt: 1, ...overrides }
}

describe('connectionTone', () => {
  it('maps a connected probe to ok', () => {
    expect(connectionTone(status('ready'))).toBe('ok')
  })

  it('maps every reachable-but-not-ready state to warn', () => {
    expect(connectionTone(status('not_running'))).toBe('warn')
    expect(connectionTone(status('api_disabled'))).toBe('warn')
    expect(connectionTone(status('unsupported'))).toBe('warn')
  })

  it('maps a probe error to bad', () => {
    expect(connectionTone(status('error'))).toBe('bad')
  })

  it('maps a failed status request to bad even without data', () => {
    // The host half itself is unreachable: that is the strongest failure the
    // indicator expresses (the app gates to the guidance page for this case).
    expect(connectionTone(undefined, { message: 'fetch failed' })).toBe('bad')
  })

  it('returns null before the first probe result', () => {
    expect(connectionTone(undefined)).toBeNull()
    expect(connectionTone(undefined, undefined)).toBeNull()
  })

  it('lets a request failure win over a stale payload', () => {
    expect(connectionTone(status('ready'), { message: 'fetch failed' })).toBe('bad')
  })
})

describe('labels and reasons', () => {
  it('maps tones to the short pill label keys', () => {
    expect(statusLabelKey('ok')).toBe('status.connected')
    expect(statusLabelKey('warn')).toBe('status.notReady')
    expect(statusLabelKey('bad')).toBe('status.failed')
  })

  it('explains every state with a reason key (and the URL for probe errors)', () => {
    expect(statusReasonKey(status('ready'))).toEqual({ key: 'status.connected' })
    expect(statusReasonKey(status('not_running'))).toEqual({ key: 'status.reason.notRunning' })
    expect(statusReasonKey(status('api_disabled'))).toEqual({ key: 'status.reason.apiDisabled' })
    expect(statusReasonKey(status('unsupported'))).toEqual({ key: 'status.reason.unsupported' })
    expect(statusReasonKey(status('error'))).toEqual({
      key: 'status.reason.unreachable',
      params: { url: 'http://127.0.0.1:23119' },
    })
  })

  it('names the host as the reason when the status request failed', () => {
    expect(statusReasonKey(undefined, { message: 'fetch failed' })).toEqual({ key: 'status.reason.host' })
  })

  it('has a reason for the pre-probe window', () => {
    expect(statusReasonKey(undefined)).toEqual({ key: 'status.reason.unknown' })
  })
})

describe('surface visibility', () => {
  it('shows the guidance strip only for warn/bad', () => {
    expect(showsConnectionStrip('warn')).toBe(true)
    expect(showsConnectionStrip('bad')).toBe(true)
    expect(showsConnectionStrip('ok')).toBe(false)
    expect(showsConnectionStrip(null)).toBe(false)
  })

  it('offers "Open Zotero" only while nothing is listening', () => {
    expect(canOpenZotero('not_running')).toBe(true)
    expect(canOpenZotero('api_disabled')).toBe(false)
    expect(canOpenZotero('unsupported')).toBe(false)
    expect(canOpenZotero('error')).toBe(false)
    expect(canOpenZotero('ready')).toBe(false)
    expect(canOpenZotero(undefined)).toBe(false)
  })
})

describe('statusPollIntervalMs (regression, still exported from views.tsx)', () => {
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

// ---------------------------------------------------------------------------
// Dictionaries: new keys exist in both languages, and neither table repeats a
// key (a duplicate would silently shadow the first value at runtime).
// ---------------------------------------------------------------------------

const I18N_SOURCE = readFileSync(new URL('../src/client/i18n.ts', import.meta.url), 'utf8')

/** Source block of one dictionary literal (JS object repetitions are invisible at runtime). */
function dictionaryBlock(name: 'zh' | 'en'): string {
  const start = name === 'zh' ? I18N_SOURCE.indexOf('export const zh = {') : I18N_SOURCE.indexOf('export const en:')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = name === 'zh' ? I18N_SOURCE.indexOf('} as const', start) : I18N_SOURCE.indexOf('/** All dictionaries', start)
  expect(end).toBeGreaterThan(start)
  return I18N_SOURCE.slice(start, end)
}

/** Quoted keys of one dictionary block, in source order. */
function dictionaryKeys(block: string): string[] {
  return [...block.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1] as string)
}

const CONNECTION_KEYS = [
  'status.connected',
  'status.notReady',
  'status.failed',
  'status.reason.notRunning',
  'status.reason.apiDisabled',
  'status.reason.unsupported',
  'status.reason.unreachable',
  'status.reason.host',
  'status.reason.unknown',
  'status.openZotero',
  'status.retry',
  'status.detail',
  'status.pillAria',
  'status.stripAria',
] as const

describe('i18n dictionaries', () => {
  it('registers zh and en', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual(['en', 'zh'])
  })

  it('has every connection-status key in both languages', () => {
    for (const key of CONNECTION_KEYS) {
      expect(zh[key as keyof typeof zh], `zh missing ${key}`).toBeTruthy()
      expect(en[key as keyof typeof en], `en missing ${key}`).toBeTruthy()
    }
  })

  it('keeps both dictionaries key-for-key in sync', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('has no duplicate keys in either dictionary literal', () => {
    for (const name of ['zh', 'en'] as const) {
      const keys = dictionaryKeys(dictionaryBlock(name))
      expect(keys.length, `${name} has no keys parsed`).toBeGreaterThan(0)
      expect(new Set(keys).size, `duplicate key in ${name}`).toBe(keys.length)
    }
  })
})
