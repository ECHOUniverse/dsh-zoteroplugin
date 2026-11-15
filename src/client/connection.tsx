/**
 * Connection indicator for the tab: one shared probe hook (single timer for
 * the whole app), the top-bar pill, and the guidance strip.
 *
 * The probe lives here instead of inside `SetupView` because the guidance
 * page is now one branch of the app, not the app: a single `useConnection`
 * call in `ZoteroApp` owns the request and the re-probe cadence, and both the
 * data views and the guidance page consume that same result (no duplicate
 * timers, no divergent snapshots).
 *
 * `ConnectionInfo` stays plain data + plain callbacks so it can cross the
 * package-local lazy chunk boundary into the PDF reader.
 *
 * @module @hanxu131/dsh-zotero/client/connection
 */

import { useEffect, useRef, useState } from 'react'
import { getStatus, launchZotero } from './api.ts'
import {
  canOpenZotero,
  connectionTone,
  showsConnectionStrip,
  statusLabelKey,
  statusPollIntervalMs,
  statusReasonKey,
  type ConnectionTone,
} from './status.ts'
import type { ZoteroStore } from './store.ts'
import { errorText, useViewData, type Notify, type Translate } from './ui.tsx'
import type { StatusResponse } from '../shared/protocol.ts'

/**
 * Everything the views need to draw the indicator. Pure data plus callbacks;
 * produced once per app render by {@link useConnection}.
 */
export interface ConnectionInfo {
  /** Tone of the latest probe; `null` = no result yet (no pill). */
  tone: ConnectionTone | null
  /** Latest probe payload, when present. */
  data?: StatusResponse
  /** Set when the status request itself failed (host unreachable). */
  error?: { message: string }
  /** A status request is in flight. */
  loading: boolean
  /** The "open Zotero" launch is in flight. */
  opening: boolean
  /** Last launch failure (raw message), shown on the guidance page. */
  openError?: string
  /** Re-probe the host now. */
  reload: () => void
  /** Ask the host to start the Zotero desktop app. */
  openZotero: () => void
  /** Open the connection settings page (the pill's click target). */
  openSettings: () => void
}

/**
 * One status probe + re-probe cadence for the whole tab. Must be called once,
 * in `ZoteroApp`; the guidance page (`SetupView`) and every view consume the
 * returned value as a prop.
 */
export function useConnection(store: ZoteroStore, t: Translate, notify: Notify): ConnectionInfo {
  const status = useViewData<StatusResponse>(store, 'status', (signal) => getStatus({ signal }))
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | undefined>(undefined)
  const openingRef = useRef(false)

  // Auto re-probe while Zotero is not connected: the guidance text promises
  // the tab connects itself once Zotero starts. The ref keeps the interval
  // from closing over a stale reload callback; the effect restarts only when
  // the reported connection state changes (ready clears the interval).
  const reloadRef = useRef(status.reload)
  reloadRef.current = status.reload
  const pollState = status.data?.state
  useEffect(() => {
    const intervalMs = statusPollIntervalMs(pollState)
    if (intervalMs === null) return
    const timer = setInterval(() => reloadRef.current(), intervalMs)
    return () => clearInterval(timer)
  }, [pollState])

  // Launch: explicit user click only; failures surface to the user and the
  // button recovers (the host reports spawn failures, we do not guess).
  const openZotero = (): void => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    setOpenError(undefined)
    void launchZotero()
      .then(() => {
        reloadRef.current()
      })
      .catch((error: unknown) => {
        const message = errorText(t, error)
        setOpenError(message)
        notify(t('setup.openFailed', { message }), 'error')
      })
      .finally(() => {
        openingRef.current = false
        setOpening(false)
      })
  }

  const openSettings = (): void => {
    store.dispatch({ type: 'push', route: { view: 'settings' } })
  }

  const error = status.error === undefined ? undefined : { message: status.error.message }
  return {
    tone: connectionTone(status.data, error),
    data: status.data,
    error,
    loading: status.loading,
    opening,
    openError,
    reload: status.reload,
    openZotero,
    openSettings,
  }
}

/**
 * Top-bar pill: dot + 11px label, tinted with the state token. Clicking it
 * opens the connection settings page; the native `title` carries the full
 * reason (the narrow container query hides the label, so the title is the
 * fallback there).
 */
export function ConnectionPill(props: { conn: ConnectionInfo; t: Translate }): JSX.Element | null {
  const { conn, t } = props
  const tone = conn.tone
  if (tone === null) return null
  const label = t(statusLabelKey(tone))
  const reason = statusReasonKey(conn.data, conn.error)
  const reasonText = t(reason.key, reason.params)
  return (
    <button
      type="button"
      className={`dshZotStatus ${tone}`}
      title={`${reasonText} · ${t('status.detail')}`}
      aria-label={t('status.pillAria', { state: label })}
      onClick={conn.openSettings}
    >
      <span className="dshZotStatusDot" aria-hidden="true" />
      <span className="dshZotStatusLabel">{label}</span>
    </button>
  )
}

/**
 * Guidance strip under the bar: one full-width row with the reason plus
 * "Open Zotero" (only while nothing is listening) and "Check again". It is
 * rendered collapsed for `ok`/`null` so the panel keeps its single bar; the
 * 160ms max-height transition is disabled under prefers-reduced-motion.
 */
export function ConnectionStrip(props: { conn: ConnectionInfo; t: Translate }): JSX.Element | null {
  const { conn, t } = props
  const open = showsConnectionStrip(conn.tone)
  const tone = conn.tone
  if (!open || tone === null) {
    // Collapsed wrapper keeps the transition target mounted without putting
    // an empty live region into the accessibility tree.
    return <div className="dshZotStripWrap" aria-hidden="true" />
  }
  const reason = statusReasonKey(conn.data, conn.error)
  return (
    <div className={`dshZotStripWrap open ${tone}`} role="status" aria-label={t('status.stripAria')}>
      <div className="dshZotStrip">
        <span className="dshZotStripText">{t(reason.key, reason.params)}</span>
        <span className="dshZotStripActions">
          {canOpenZotero(conn.data?.state) && (
            <button type="button" className="dshZotStripBtn" disabled={conn.opening} onClick={conn.openZotero}>
              {conn.opening ? t('setup.opening') : t('status.openZotero')}
            </button>
          )}
          <button type="button" className="dshZotStripBtn" onClick={conn.reload}>
            {t('status.retry')}
          </button>
        </span>
      </div>
    </div>
  )
}
