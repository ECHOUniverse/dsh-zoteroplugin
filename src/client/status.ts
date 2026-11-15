/**
 * Connection-status decisions for the tab's status indicator.
 *
 * Pure data + pure functions only (no React, no DOM) so the mapping is unit
 * testable in the node environment and the same rules feed the top-bar pill,
 * the guidance strip, and the app-level gate in `src/client.tsx`.
 *
 * @module @hanxu131/dsh-zotero/client/status
 */

import type { StatusResponse } from '../shared/protocol.ts'

/** Visual tone of the connection indicator. */
export type ConnectionTone = 'ok' | 'warn' | 'bad'

/** Re-probe cadence while the connection is not ready. */
const STATUS_POLL_MS = 5000

/**
 * Tone for the latest probe. `null` means "nothing to show yet": no result
 * has arrived (the app keeps the guidance page up until the first answer).
 *
 * A failed status request is `bad` even without data — the host itself is
 * unreachable, which is the strongest failure this indicator expresses.
 */
export function connectionTone(data?: StatusResponse, error?: { message: string }): ConnectionTone | null {
  if (error !== undefined) return 'bad'
  if (data === undefined) return null
  if (data.state === 'ready') return 'ok'
  if (data.state === 'error') return 'bad'
  // not_running / api_disabled / unsupported / unknown: reachable but not
  // usable — guidance, not a hard failure.
  return 'warn'
}

/** Short pill label key for a tone. */
export function statusLabelKey(tone: ConnectionTone): string {
  switch (tone) {
    case 'ok':
      return 'status.connected'
    case 'warn':
      return 'status.notReady'
    case 'bad':
      return 'status.failed'
  }
}

/**
 * Full reason behind the tone, as an i18n key + params (the pill's `title`
 * and the strip's text share it). A connected state falls back to the pill
 * label itself; a missing result falls back to the "not detected yet" copy.
 */
export function statusReasonKey(data?: StatusResponse, error?: { message: string }): { key: string; params?: Record<string, string> } {
  if (error !== undefined) return { key: 'status.reason.host' }
  if (data === undefined) return { key: 'status.reason.unknown' }
  switch (data.state) {
    case 'ready':
      return { key: 'status.connected' }
    case 'not_running':
      return { key: 'status.reason.notRunning' }
    case 'api_disabled':
      return { key: 'status.reason.apiDisabled' }
    case 'unsupported':
      return { key: 'status.reason.unsupported' }
    case 'error':
      return { key: 'status.reason.unreachable', params: { url: data.baseUrl } }
    default:
      return { key: 'status.reason.unknown' }
  }
}

/** The guidance strip only appears for warn/bad; green keeps the panel one row. */
export function showsConnectionStrip(tone: ConnectionTone | null): boolean {
  return tone === 'warn' || tone === 'bad'
}

/** "Open Zotero" is only meaningful when nothing is listening yet. */
export function canOpenZotero(state?: StatusResponse['state']): boolean {
  return state === 'not_running'
}

/**
 * How often the app should re-probe the host. `null` means "do not poll":
 * connected (nothing to wait for) or no result yet (a probe is already in
 * flight, or the host itself is unreachable and the manual refresh button
 * owns that path). Exported for `tests/client-ui-status.test.ts`, which
 * imports it from `views.tsx` (kept as a re-export there).
 */
export function statusPollIntervalMs(state: StatusResponse['state'] | undefined): number | null {
  if (state === undefined || state === 'ready') return null
  return STATUS_POLL_MS
}
