/**
 * Browser half of `@hanxu131/dsh-zotero`.
 *
 * M2/M3/M4/M8 milestone: the right-sidebar tab is the single-tab app shell.
 * It:
 *
 * 1. registers the right-sidebar page-type tab (`sidebarRightTabs`, kind
 *    `zotero`) plus its keyed body on `sidebar.right.pane.tab` — page tabs
 *    dedupe per pane, realizing the "single tab" decision (ADR 0002);
 * 2. renders the internal navigation stack from `client/store.ts`
 *    (Library → Item detail → PDF Reader → Agent items → Connection);
 * 3. talks to the host half only through same-origin relative fetches on the
 *    shared `ROUTES` (`client/api.ts`) — no Zotero key, no direct Zotero
 *    connection;
 * 4. subscribes to the host's SSE view events and applies Agent navigation
 *    intents (`open_item` / `show_items`, plus `highlights` refresh nudges)
 *    with `seq` dedupe;
 * 5. writes chat drafts and submits asks through the OFFICIAL session-scoped
 *    `inputActions` standard prop of this slot (DSH `sidebar.right.pane.tab`
 *    contract; see `client/chat-draft.ts` for the evidence). The face is used
 *    defensively: when no session scope is live the buttons are disabled —
 *    there is no clipboard fallback and no silent send; and
 * 6. when the host offers the chip extension points (`inputTriggers`,
 *    `conversation`, `sessions`), registers the `@` Zotero Context Chip source
 *    and its message-side card (ADR 0004), exposing one {@link ChipRuntime}
 *    through the chat context — views keep the old `insertText` path as the
 *    documented fallback.
 *
 * The PDF reader ships in a separate lazy chunk (`client.pdf.js`, built from
 * `src/client-pdf.tsx`): opening a reader route loads it through the
 * official package-local chunk contract (`require.async('./client.pdf.js')`,
 * dsh-client-modules `ClientBundleRequire.async`), so browsing a plain
 * library never downloads pdf.js.
 *
 * The slot props shape (`hooks.tabInfo`, `sessionId`, `inputActions`) is read
 * defensively until verified on a real host (verification point V-1).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { PLUGIN_NAME, PLUGIN_VERSION, type ViewEvent } from './shared/protocol.ts'
import { connectViewEvents, getItem, type ViewStreamHandle } from './client/api.ts'
import { chatFaceFrom, type ChatFace } from './client/chat-draft.ts'
import { registerContextCard } from './client/context-card.tsx'
import { currentChipRuntime, installChipRuntime, registerContextChipSource, type ChipHost, type ChipServices } from './client/context-chip-source.ts'
import { DICTIONARIES } from './client/i18n.ts'
import { GuideLibraryIcon } from './client/guide-icon.tsx'
import { Icon } from './client/icons.tsx'
import { CSS } from './client/styles.ts'
import { ZoteroStore, currentRoute, type Route } from './client/store.ts'
import { useConnection, type ConnectionInfo } from './client/connection.tsx'
import { Toast, type Notify, type Translate } from './client/ui.tsx'
import { AgentItemsView, ItemDetailView, LibraryView, SetupView, type ChatInfo } from './client/views.tsx'

/** Locale namespace of this bundle. */
export const NAMESPACE = 'zotero'

/** Tab-type implementation identity: unique across the tab system; the package name is the natural value. */
export const TAB_DEFINITION_ID = PLUGIN_NAME

/** Tab-type discriminator: what `openTab` names for this page. */
export const TAB_KIND = 'zotero'

/** Translate function bound to the plugin's locale namespace. */
type TranslateFn = (key: string, params?: Record<string, string | number>) => string

/** Minimal ClientContext face this half touches (runtime values come from Cordis). */
interface ClientContext {
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): TranslateFn
  }
  slots: {
    inject(slot: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  sidebarRightTabs: {
    register(definition: {
      readonly id: string
      readonly kind: string
      readonly title: (address: string) => string
      readonly guide?: readonly {
        readonly id: string
        readonly order: number
        readonly title: () => string
        readonly description?: () => string
        /** Guide artwork: a React component the host renders at a fixed `size` (26 with a description). */
        readonly icon?: (props: { readonly size: number; readonly className?: string }) => ReactNode
      }[]
    }): () => void
  }
  /**
   * Optional capability injection (ADR 0004 / §6 "接入方式"): the chip asks for
   * the conversation services it needs and receives a child context once they
   * exist. Absent on hosts without the optional-injection seat.
   */
  inject?(deps: string[], callback: (child: ClientContext & ChipHost) => void): unknown
  /** `@` trigger registry (Zotero Context Chip source); optional by design. */
  readonly inputTriggers?: ChipHost['inputTriggers']
  /** Session-scoped reference insertion surface. */
  readonly conversation?: ChipHost['conversation']
  /** Session-scope resolver used by `conversation.input.for(...)`. */
  readonly sessions?: ChipHost['sessions']
  effect(callback: () => void | (() => void), label?: string): () => void
}

/** Defensive shape of the slot-injected tab-info hook (verified on a real host later). */
interface TabInfoStub {
  readonly tab?: { readonly address?: string }
}

/**
 * Standard props the framework may inject into a `sidebar.right.pane.tab`
 * component when a session scope is live (`scope: "session"`): `sessionId`
 * and the chat `inputActions` face. All optional — the tab keeps working for
 * plain library browsing without them.
 */
interface ZoteroTabProps {
  /** Locale translate bound at apply time (passed through registration). */
  t: TranslateFn
  hooks?: { tabInfo?: () => TabInfoStub }
  sessionId?: string
  inputActions?: unknown
  useInput?: (selector: (state: { phase: string }) => unknown) => unknown
}

/** Module-level store singleton (page tabs dedupe per pane; see store.ts). */
const store = new ZoteroStore()

/** Chat context shared by all views of this tab instance. */
const ChatContext = createContext<ChatInfo>({ face: null, hasSession: false, busy: false, sessionId: undefined, chip: null })

/** Install the stylesheet once; returns its removal cleanup. */
function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const selector = 'style[data-plugin-css="zotero-tab"]'
  if (document.querySelector(selector) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_NAME
  tag.dataset.pluginCss = 'zotero-tab'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

/** The lazy chunk's exports (Reader + pdf helpers), once loaded. */
interface PdfChunk {
  Reader: (props: {
    route: Extract<Route, { view: 'reader' }>
    store: ZoteroStore
    t: TranslateFn
    notify: Notify
    chat: ChatInfo
    conn: ConnectionInfo
    onBack: () => void
  }) => ReactNode
}

/**
 * Package-local chunk loader over the official contract: the factory's
 * `require.async('./client.pdf.js')` fetches/registers/materializes the
 * sibling chunk (dsh-client-modules `importChunk`). The `require` symbol
 * below is the one the module-loader envelope passes to this factory.
 */
type ChunkRequire = { async(specifier: string): Promise<unknown> }
declare const require: ChunkRequire

let pdfChunkPromise: Promise<PdfChunk> | null = null
function loadPdfChunk(): Promise<PdfChunk> {
  pdfChunkPromise ??= require.async('./client.pdf.js') as Promise<PdfChunk>
  return pdfChunkPromise
}

function ReaderSlot(props: { route: Extract<Route, { view: 'reader' }>; t: TranslateFn; notify: Notify; conn: ConnectionInfo; onBack: () => void }): JSX.Element {
  const { route, t, notify, conn, onBack } = props
  const chat = useContext(ChatContext)
  const [chunk, setChunk] = useState<PdfChunk | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadPdfChunk()
      .then((loaded) => {
        if (!cancelled) setChunk(loaded)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (chunk !== null) return <chunk.Reader route={route} store={store} t={t} notify={notify} chat={chat} conn={conn} onBack={onBack} />
  return (
    <div className="dshZot">
      <header className="dshZotBar">
        <button type="button" className="dshZotBack" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="back" size={15} />
        </button>
        <span className="dshZotBarTitle dshZotStrong">{t('reader.title')}</span>
      </header>
      <div className="dshZotReader">{failed ? <div className="dshZotErrorBox">{t('reader.chunkFailed')}</div> : <div className="dshZotReaderNote">{t('common.loading')}</div>}</div>
    </div>
  )
}

/** Route → view switch (pure structure; data flows through the store). */
function RouteView(props: { route: Route; t: TranslateFn; notify: Notify; conn: ConnectionInfo; onBack: () => void }): JSX.Element {
  const { route, t, notify, conn, onBack } = props
  const chat = useContext(ChatContext)
  switch (route.view) {
    case 'library':
      return <LibraryView store={store} t={t} notify={notify} chat={chat} conn={conn} route={route} />
    case 'items':
      return <AgentItemsView store={store} t={t} notify={notify} chat={chat} conn={conn} route={route} onBack={onBack} />
    case 'item':
      return <ItemDetailView store={store} t={t} notify={notify} chat={chat} conn={conn} route={route} onBack={onBack} />
    case 'reader':
      return <ReaderSlot route={route} t={t} notify={notify} conn={conn} onBack={onBack} />
    case 'settings':
      return <SetupView t={t} chat={chat} conn={conn} showDetail />
  }
}

/** Full app: connection gate, route views, toasts. */
function ZoteroApp(props: { t: TranslateFn }): JSX.Element {
  const { t } = props
  const chat = useContext(ChatContext)
  const state = useSyncExternalStore(store.subscribe, store.get, store.get)
  const [toast, setToast] = useState<{ message: string; tone?: 'info' | 'error' } | null>(null)
  const dismiss = useCallback(() => setToast(null), [])
  const notify = useMemo<Notify>(() => (message, tone) => setToast({ message, tone }), [])

  // One probe for the whole app: the guidance page and the data views share
  // this snapshot, so no view starts a second timer.
  const conn = useConnection(store, t, notify)
  const route = currentRoute(state)

  // Gate: the full guidance page owns the panel while the data layer is
  // unusable — the host routes themselves are unreachable (the status request
  // failed) or no probe result exists yet — plus the explicit settings route.
  // A reachable-but-not-ready Zotero is NOT a gate: the views render normally
  // and the pill/strip express the state (data requests fail into DataGate,
  // which already offers retry).
  if (route.view === 'settings' || conn.data === undefined || conn.error !== undefined) {
    const onBack =
      route.view === 'settings' && state.stack.length > 1 ? (): void => store.dispatch({ type: 'back' }) : undefined
    return (
      <div className="dshZotRoot">
        <SetupView t={t} chat={chat} conn={conn} showDetail {...(onBack !== undefined ? { onBack } : {})} />
        {toast !== null && <Toast message={toast.message} tone={toast.tone} onDismiss={dismiss} />}
      </div>
    )
  }

  return (
    <div className="dshZotRoot">
      <div className="dshZot">
        <RouteView route={route} t={t} notify={notify} conn={conn} onBack={() => store.dispatch({ type: 'back' })} />
      </div>
      {toast !== null && <Toast message={toast.message} tone={toast.tone} onDismiss={dismiss} />}
    </div>
  )
}

/**
 * The tab body. Standard session-scope props (`sessionId`, `inputActions`,
 * `useInput`) are read defensively; the chat context they feed powers the
 * Add-to-chat / Ask actions everywhere in the tab.
 */
function ZoteroTab(props: ZoteroTabProps): JSX.Element {
  const t = props.t
  // Live input phase (queued submission in flight); read defensively — the
  // prop only exists while the session scope provides the input store.
  const inputPhase = (() => {
    try {
      if (typeof props.useInput !== 'function') return undefined
      return props.useInput((state: { phase?: string }) => state.phase) as string | undefined
    } catch {
      return undefined
    }
  })()
  const chat = useMemo<ChatInfo>(() => {
    const face = chatFaceFrom(props)
    const busy = inputPhase === 'adjudicating' || inputPhase === 'submitting'
    const sessionId = typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined
    // `chip` is a live getter: the conversation services may arrive after this
    // tab has rendered (`ctx.inject` callback), so a captured `null` would pin
    // the legacy path forever. ADR 0004 degraded path is a `null` answer.
    return {
      face,
      hasSession: sessionId !== undefined,
      busy,
      sessionId,
      get chip() {
        return currentChipRuntime()
      },
    }
  }, [props.inputActions, props.sessionId, inputPhase])

  // SSE view events drive navigation; dedupe happens in api + reducer.
  useEffect(() => {
    const handle: ViewStreamHandle = connectViewEvents({
      fromSeq: store.get().seenSeq,
      onEvent: (event: ViewEvent) => {
        store.dispatch({ type: 'viewEvent', seq: event.seq, intent: event.intent })
      },
    })
    return () => {
      handle.close()
    }
  }, [])

  return (
    <ChatContext.Provider value={chat}>
      <ZoteroApp t={t} />
    </ChatContext.Provider>
  )
}

/** Required browser services: the slot registry, copy, and the right-sidebar tab registry. */
export const inject = ['slots', 'locale', 'sidebarRightTabs'] as const

/**
 * Mount the browser half: dictionaries, styles, the tab-type registration and
 * the keyed tab-body registration.
 *
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => ctx.locale.register(NAMESPACE, { ...DICTIONARIES }), 'zotero: dictionaries')
  ctx.effect(() => installStyles(), 'zotero: styles')

  // Stage one: what the tab type IS. A page type (no patterns), opened by kind,
  // one per pane — pages always deduplicate within the target pane.
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_DEFINITION_ID,
        kind: TAB_KIND,
        title: () => t('tab.title'),
        guide: [
          {
            id: 'zotero-library',
            order: 100,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: GuideLibraryIcon,
          },
        ],
      }),
    'zotero: tab type',
  )

  // Stage two: the body under the same definition id, dispatched for every tab
  // of this kind in every pane. Standard session-scope props (sessionId,
  // inputActions, useInput) arrive here when a chat session is live.
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_DEFINITION_ID, locale: NAMESPACE },
          function ZoteroTabBody(tabProps: ZoteroTabProps) {
            return <ZoteroTab {...tabProps} t={t} />
          },
        ),
      ),
    'zotero: tab body',
  )

  // Stage three (ADR 0004): the Zotero Context Chip pair. `inject` is the
  // optional seat for the conversation services; without it this very context
  // is used, so a host that already exposes them still gets chips. Both the
  // registration and the card are defensive — apply must never throw.
  const services: ChipServices = { host: ctx as unknown as ChipHost, t }

  const startChip = (child: ClientContext & ChipHost): void => {
    const childCtx = child as unknown as ClientContext
    const host = child as unknown as ChipHost
    const dispose = registerContextChipSource({ host, t })
    if (dispose !== null) childCtx.effect(() => dispose, 'zotero: context chip source')
    registerContextCard(child as never, {
      t,
      getItem: (library, key) =>
        getItem(library, key).then((detail) => ({ title: detail.title, creatorSummary: detail.creatorSummary, year: detail.year })),
    })
    // The source registration above owns the one live chip source; the runtime
    // is told the outcome instead of probing (a probe would register the same
    // `@` source twice and the host rejects duplicate pairs).
    installChipRuntime({ host, t }, dispose !== null)
  }

  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['inputTriggers', 'conversation', 'sessions', 'uiConversation'], (child) => {
        try {
          startChip(child)
        } catch {
          // No chip runtime: every entry point keeps the legacy draft write.
        }
      })
    } else {
      startChip(services.host as unknown as ClientContext & ChipHost)
    }
  } catch {
    // Same degraded path: without the optional seat the tab still works.
  }
}
