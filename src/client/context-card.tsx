/**
 * Message-side Zotero Context Card: the pure text matcher that folds the
 * expanded Zotero context block back into a single unit, plus the React
 * renderer that draws it.
 *
 * ADR 0004 (`docs/adr/0004-reference-chip-for-zotero-context.md`) splits the
 * feature in two halves: the composer carries a *Zotero Context Chip* whose
 * codec still hands the model the full expanded block, while the message
 * side — pending echo, queue rows and durable messages — folds that same
 * expanded text through `ctx.uiConversation.userText` matching plus a
 * `conversation.user.text.node` renderer. This module owns exactly that
 * message-side pair and nothing else:
 *
 * 1. `matchZoteroContextBlock` is a pure scanner over the format produced by
 *    `client/chat-draft.ts` (`itemsDraftText` / `quoteDraftText`); it never
 *    mutates or re-serializes the text, so the model payload is unchanged.
 * 2. `ContextCard` renders one single-line bordered card: an inline SVG
 *    literature glyph, the localized title, and (in the browser) a
 *    body-portaled hover detail list resolved lazily through
 *    `ContextCardDeps.getItem` with a module-level cache.
 * 3. `registerContextCard` performs the two host registrations defensively:
 *    when `uiConversation` / `slots` are absent the fold is simply skipped and
 *    the raw text stays readable (the documented degraded path).
 *
 * CONTEXT.md calls this unit a "Zotero Context Card" — never a quote block,
 * preview or attachment.
 *
 * @module @hanxu131/dsh-zotero/client/context-card
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Translate function bound to the plugin locale namespace (host-provided). */
type Translate = (key: string, params?: Record<string, string | number>) => string

/** Locale namespace the renderer is registered under. */
const NAMESPACE = 'zotero'

/** Stable rule / slot key of the Zotero context contribution. */
const CARD_KEY = 'zotero-context'

/** Slot the message-side text-node renderers are injected into. */
const NODE_SLOT = 'conversation.user.text.node'

/** Sentence every folded block starts with (`itemsDraftText` / `quoteDraftText`). */
const HEADER_PREFIX = 'The user selected '

/** Exact quote header emitted by `quoteDraftText`. */
const QUOTE_HEADER = 'The user selected a PDF passage in the Zotero panel:'

/** Item header: `The user selected N Zotero item(s)[ in library <lib>] in the Zotero panel:`. */
const ITEMS_HEADER = /^The user selected (\d+) Zotero items?(?: in library (.+?))? in the Zotero panel:$/u

/** One structured reference line: `- [KEY] …` (items and the quote's first line). */
const REFERENCE_LINE = /^- \[([^\]\n]+)\]/u

/** Page qualifier of a quote's reference line: `, page <n>`. */
const QUOTE_PAGE = /, page (\d+)/u

/** Prefix of every quoted passage line. */
const QUOTE_TEXT_PREFIX = '> '

/** Rows the hover card lists before collapsing into the "more" line. */
const DETAIL_LIMIT = 5

/** Gap between the card and its hover surface, in CSS pixels. */
const FLOAT_GAP = 6

/** Preferred hover-surface width, clamped to the viewport. */
const FLOAT_WIDTH = 320

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/** Everything one folded Zotero context block carries for display. */
export interface ContextCardData {
  /** Which kind of selection the block describes. */
  readonly kind: 'items' | 'quote'
  /** Selected items (items) or `1` for a single quoted passage. */
  readonly count: number
  /**
   * Library the block belongs to (`user` or `g<id>`). A header spells the
   * qualifier only for non-personal libraries (`client/chat-draft.ts` omits it
   * for `user`), and a quote block never carries one at all — both default to
   * `user`, the only library the text can imply.
   */
  readonly library: string
  /** Zotero item keys taken from the `- [KEY]` lines. */
  readonly keys: readonly string[]
  /** 0-based page index for quotes; `null` for item blocks. */
  readonly pageIndex: number | null
  /** Characters of quoted passage text (summed over `> ` lines); `0` for items. */
  readonly charCount: number
}

/** One matched block: the half-open `[start, end)` span (no trailing newline) and its data. */
export interface ContextCardMatch {
  readonly start: number
  readonly end: number
  readonly data: ContextCardData
}

// ---------------------------------------------------------------------------
// Pure matcher (host-free, never throws)
// ---------------------------------------------------------------------------

/** One line of `text`: content `[start, end)`, excluding the terminating `\n`. */
interface LineSpan {
  readonly start: number
  readonly end: number
}

/** Line content span starting at `start` (never fails; clamps at the end). */
function lineAt(text: string, start: number): LineSpan {
  const newline = text.indexOf('\n', start)
  return { start, end: newline < 0 ? text.length : newline }
}

/** Start of the line after `span`, or `text.length` when the span is the last line. */
function nextLineStart(text: string, span: LineSpan): number {
  return span.end < text.length ? span.end + 1 : text.length
}

/** Item block: header + one or more consecutive `- [KEY] …` lines. */
function readItemsBlock(text: string, header: LineSpan, start: number, fields: RegExpExecArray): ContextCardMatch | undefined {
  const keys: string[] = []
  let end = header.end
  let cursor = nextLineStart(text, header)
  while (cursor < text.length) {
    const line = lineAt(text, cursor)
    const reference = REFERENCE_LINE.exec(text.slice(line.start, line.end))
    if (reference === null) break
    const key = reference[1]
    if (key === undefined) break
    keys.push(key)
    end = line.end
    cursor = nextLineStart(text, line)
  }
  if (keys.length === 0) return undefined
  // The header omits the qualifier for the personal library, so absence means `user`.
  const library = fields[2] ?? 'user'
  return {
    start,
    end,
    data: { kind: 'items', count: keys.length, library, keys, pageIndex: null, charCount: 0 },
  }
}

/** Quote block: header + one `- [KEY] … , page <n>` line + consecutive `> ` lines. */
function readQuoteBlock(text: string, header: LineSpan, start: number): ContextCardMatch | undefined {
  const referenceStart = nextLineStart(text, header)
  if (referenceStart >= text.length) return undefined
  const referenceLine = lineAt(text, referenceStart)
  const referenceText = text.slice(referenceLine.start, referenceLine.end)
  const reference = REFERENCE_LINE.exec(referenceText)
  const page = QUOTE_PAGE.exec(referenceText)
  if (reference === null || page === null) return undefined
  const key = reference[1]
  const pageText = page[1]
  if (key === undefined || pageText === undefined) return undefined
  const pageNumber = Number.parseInt(pageText, 10)
  if (!Number.isFinite(pageNumber) || pageNumber < 1) return undefined

  let charCount = 0
  let quotedLines = 0
  let end = referenceLine.end
  let cursor = nextLineStart(text, referenceLine)
  while (cursor < text.length) {
    const line = lineAt(text, cursor)
    const content = text.slice(line.start, line.end)
    if (!content.startsWith(QUOTE_TEXT_PREFIX)) break
    charCount += content.length - QUOTE_TEXT_PREFIX.length
    quotedLines += 1
    end = line.end
    cursor = nextLineStart(text, line)
  }
  if (quotedLines === 0) return undefined
  // A quote header never spells the library; `user` is the only implication left.
  return {
    start,
    end,
    data: { kind: 'quote', count: 1, library: 'user', keys: [key], pageIndex: pageNumber - 1, charCount },
  }
}

/** Try to read one complete block whose header starts exactly at `start`. */
function readBlockAt(text: string, start: number): ContextCardMatch | undefined {
  const header = lineAt(text, start)
  const headerText = text.slice(header.start, header.end)
  const items = ITEMS_HEADER.exec(headerText)
  if (items !== null) return readItemsBlock(text, header, start, items)
  if (headerText === QUOTE_HEADER) return readQuoteBlock(text, header, start)
  return undefined
}

/**
 * Match the nearest Zotero context block at or after `from`.
 *
 * The scanner only accepts a header that begins a line, then requires the
 * block body to be *consecutive*: the first line that does not fit ends the
 * block, so two adjacent blocks match separately (call again with the first
 * match's `end`) and trailing prose is left alone. `[start, end)` is always
 * non-empty and excludes the newline after the last block line.
 *
 * @param text - the message (or draft) text to scan.
 * @param from - offset to start searching from; earlier blocks are ignored.
 * @returns the match, or `undefined` for absent/ungrammatical input (never throws).
 */
export function matchZoteroContextBlock(text: string, from: number): ContextCardMatch | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined
  let cursor = typeof from === 'number' && Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0
  while (cursor < text.length) {
    const candidate = text.indexOf(HEADER_PREFIX, cursor)
    if (candidate < 0) return undefined
    // A block header must own its line: reject mentions inside prose/quotes.
    if (candidate === 0 || text.charCodeAt(candidate - 1) === 10) {
      const match = readBlockAt(text, candidate)
      if (match !== undefined) return match
    }
    cursor = candidate + 1
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/**
 * Localized single-line title of a folded block.
 *
 * Wording comes exclusively from the `zotero` namespace (`chat.card.items`,
 * `chat.card.quote`): the card never inlines copy, so the same function serves
 * the message side and any future locale.
 *
 * @param data - folded block data.
 * @param t - translate function bound to the plugin namespace.
 * @returns the localized title.
 */
export function contextCardTitle(data: ContextCardData, t: Translate): string {
  if (data.kind === 'quote') return t('chat.card.quote', { page: (data.pageIndex ?? 0) + 1 })
  return t('chat.card.items', { count: data.count })
}

// ---------------------------------------------------------------------------
// Styles (mirrored at the end of `client/styles.ts`)
// ---------------------------------------------------------------------------

/** Card stylesheet, appended verbatim to the tab `CSS` constant. */
export const CONTEXT_CARD_CSS = String.raw`
/* --- message-side Zotero context card (ADR 0004) ------------------------ */
.dshZotCtxCard {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 1px 8px 1px 5px;
  vertical-align: baseline;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.14));
  border-radius: var(--dsw-radius-sm, 6px);
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
}
.dshZotCtxCard:hover { background: color-mix(in srgb, currentColor 9%, transparent); }
.dshZotCtxCard:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
.dshZotCtxGlyph { flex: none; width: 12px; height: 12px; color: inherit; opacity: 0.75; }
.dshZotCtxTitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshZotCtxRaw { color: inherit; overflow-wrap: anywhere; white-space: pre-wrap; }
.dshZotCtxFloat {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: max-content;
  max-width: min(340px, calc(100vw - 16px));
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.14));
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-raised, var(--dsw-alias-bg-layer-2, #fff));
  color: var(--dsw-alias-label-primary, inherit);
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  pointer-events: none;
}
.dshZotCtxFloatHead { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshZotCtxFloatList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.dshZotCtxFloatRow { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshZotCtxFloatMore { font-size: 11px; color: var(--dsw-alias-label-secondary, inherit); white-space: nowrap; }
`

// ---------------------------------------------------------------------------
// Hover details (module-level cache, never throws)
// ---------------------------------------------------------------------------

/** One resolved hover row: `标题 — 作者 (年)`. */
interface DetailRow {
  readonly title: string
  readonly creatorSummary: string
  readonly year: string
}

/** Resolved rows by `<library>:<key>`; `null` caches a failed lookup. */
const detailCache = new Map<string, DetailRow | null>()

/** Read a string field off an unknown record, defaulting to `''`. */
function textField(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  return typeof value === 'string' ? value : ''
}

/**
 * Resolve one key, caching both hits and failures.
 *
 * @param deps - host deps (`getItem`) captured by the registration.
 * @param library - Zotero library the item belongs to (`user` or `g<id>`).
 * @param key - Zotero item key.
 * @returns the row, or `null` when the lookup failed.
 */
async function detailFor(deps: ContextCardDeps, library: string, key: string): Promise<DetailRow | null> {
  const cacheKey = `${library}:${key}`
  const cached = detailCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    const raw: unknown = await deps.getItem(library, key)
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const row: DetailRow = { title: textField(record, 'title'), creatorSummary: textField(record, 'creatorSummary'), year: textField(record, 'year') }
    detailCache.set(cacheKey, row)
    return row
  } catch {
    detailCache.set(cacheKey, null)
    return null
  }
}

/**
 * Resolve the first `DETAIL_LIMIT` keys; any failure degrades the whole list so
 * the hover surface can fall back to showing the count only.
 *
 * @param deps - host deps (`getItem`).
 * @param library - Zotero library shared by these keys.
 * @param keys - keys to resolve (already ordered).
 * @returns resolved rows, or `null` when a lookup failed.
 */
async function detailRows(deps: ContextCardDeps, library: string, keys: readonly string[]): Promise<readonly DetailRow[] | null> {
  const wanted = keys.slice(0, DETAIL_LIMIT)
  if (wanted.length === 0) return []
  const rows: DetailRow[] = []
  for (const key of wanted) {
    const row = await detailFor(deps, library, key)
    if (row === null) return null
    rows.push(row)
  }
  return rows
}

/** `标题 — 作者 (年)` for one resolved row. */
function detailLine(row: DetailRow): string {
  const who = [row.creatorSummary, row.year !== '' ? `(${row.year})` : ''].filter(Boolean).join(' ')
  return who === '' ? row.title : `${row.title} — ${who}`
}

/** Deps captured by `registerContextCard`; the renderer is registered by value. */
let activeDeps: ContextCardDeps | null = null

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Small inline literature glyph (own copy: never an external icon asset). */
function ContextCardGlyph(): JSX.Element {
  return (
    <svg
      className="dshZotCtxGlyph"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  )
}

/** Validate an unknown node payload into `ContextCardData`. */
function cardDataFrom(value: unknown): ContextCardData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (kind !== 'items' && kind !== 'quote') return undefined
  const count = record.count
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return undefined
  const library = record.library
  if (typeof library !== 'string') return undefined
  const rawKeys = record.keys
  if (!Array.isArray(rawKeys)) return undefined
  const keys: string[] = []
  for (const candidate of rawKeys) {
    if (typeof candidate !== 'string') return undefined
    keys.push(candidate)
  }
  const rawPage = record.pageIndex
  if (rawPage !== null && (typeof rawPage !== 'number' || !Number.isInteger(rawPage) || rawPage < 0)) return undefined
  const charCount = record.charCount
  if (typeof charCount !== 'number' || !Number.isFinite(charCount) || charCount < 0) return undefined
  return { kind, count, library, keys, pageIndex: rawPage, charCount }
}

/** Read the folded data from the renderer's `node` prop. */
function readCardData(props: { readonly node: unknown }): ContextCardData | undefined {
  const node: unknown = props?.node
  if (typeof node !== 'object' || node === null) return undefined
  return cardDataFrom((node as { readonly data?: unknown }).data)
}

/** Original fragment the host passes beside `node`; `''` when absent. */
function readRaw(props: { readonly node: unknown }): string {
  const value = (props as unknown as { readonly raw?: unknown }).raw
  return typeof value === 'string' ? value : ''
}

/** Translate seat the host injects for `locale: 'zotero'`; `undefined` outside a host. */
function readTranslate(props: { readonly node: unknown }): Translate | undefined {
  const value = (props as unknown as { readonly t?: unknown }).t
  return typeof value === 'function' ? (value as Translate) : activeDeps?.t
}

/** Fixed-position anchor of the hover surface. */
interface FloatAnchor {
  readonly top: number
  readonly left: number
}

/**
 * Message-side renderer for one folded Zotero context block.
 *
 * The card is a single line with a border (not a pill): glyph, localized
 * title, `nowrap` + ellipsis. Hovering (or focusing) opens a `position: fixed`
 * portal on `document.body` — never an `absolute` child that an ancestor could
 * clip — listing up to `DETAIL_LIMIT` `标题 — 作者 (年)` rows plus a
 * `chat.card.more` line. Without a `document` (SSR, tests) it renders the card
 * alone; with unusable `node.data` it falls back to the host's `raw` fragment.
 *
 * @param props - the host's text-node props; only `node` is guaranteed.
 * @returns the inline card plus, in the browser, its portaled hover surface.
 */
export function ContextCard(props: { readonly node: unknown }): JSX.Element {
  const data = readCardData(props)
  const raw = readRaw(props)
  const t = readTranslate(props)
  const cardRef = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<FloatAnchor | null>(null)
  const [rows, setRows] = useState<readonly DetailRow[] | null>(null)
  const signature = data === undefined ? '' : `${data.kind}:${String(data.pageIndex)}:${data.keys.join(',')}`

  useEffect(() => {
    if (anchor === null || data === undefined) return
    const deps = activeDeps
    if (deps === null) return
    let cancelled = false
    setRows(null)
    void detailRows(deps, data.library, data.keys).then((loaded) => {
      if (!cancelled) setRows(loaded)
    })
    return () => {
      cancelled = true
    }
    // `signature` covers every field the lookup depends on.
  }, [anchor, signature])

  if (data === undefined || t === undefined) {
    return <span className="dshZotCtxRaw">{raw}</span>
  }

  const open = (): void => {
    if (typeof document === 'undefined') return
    const element = cardRef.current
    if (element === null || typeof element.getBoundingClientRect !== 'function') return
    const rect = element.getBoundingClientRect()
    const viewport = typeof window === 'undefined' ? undefined : window.innerWidth
    const width = viewport === undefined || !Number.isFinite(viewport) ? FLOAT_WIDTH : Math.min(FLOAT_WIDTH, Math.max(160, viewport - 16))
    const maxLeft = viewport === undefined || !Number.isFinite(viewport) ? rect.left : Math.max(8, viewport - width - 8)
    setAnchor({ top: rect.bottom + FLOAT_GAP, left: Math.max(8, Math.min(rect.left, maxLeft)) })
    setRows(null)
  }

  const close = (): void => {
    setAnchor(null)
  }

  const title = contextCardTitle(data, t)
  const more = data.count - (rows?.length ?? 0)
  const overlay =
    anchor !== null && typeof document !== 'undefined'
      ? createPortal(
          <div className="dshZotCtxFloat" role="tooltip" style={{ top: anchor.top, left: anchor.left }}>
            <div className="dshZotCtxFloatHead">{title}</div>
            {rows !== null && rows.length > 0 && (
              <ul className="dshZotCtxFloatList">
                {rows.map((row, index) => (
                  <li key={`${String(index)}:${row.title}`} className="dshZotCtxFloatRow">
                    {detailLine(row)}
                  </li>
                ))}
              </ul>
            )}
            {rows !== null && rows.length > 0 && more > 0 && <div className="dshZotCtxFloatMore">{t('chat.card.more', { count: more })}</div>}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <span
        ref={cardRef}
        className="dshZotCtxCard"
        tabIndex={0}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >
        <ContextCardGlyph />
        <span className="dshZotCtxTitle">{title}</span>
      </span>
      {overlay}
    </>
  )
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** One candidate returned by a user-text rule (DSH `UiConversation.userText`). */
interface UserTextCandidate {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly data: ContextCardData
}

/** One synchronous user-text matching rule, as the host registry expects it. */
interface UserTextRule {
  readonly id: string
  readonly order: number
  match(text: string, from: number): UserTextCandidate | undefined
}

/** Minimal host face this registration touches (same style as `ClientContext` in `client.tsx`). */
export interface CardContext {
  /** Message-side text services; absent on hosts without conversation support. */
  readonly uiConversation?: {
    readonly userText?: {
      register(rule: UserTextRule): () => void
    }
  }
  /** Keyed slot registry; `inject` defers registration until the slot exists. */
  readonly slots?: {
    inject?(slot: string, callback: () => (() => void) | void): (() => void) | void
    register?(
      options: Record<string, unknown>,
      component: (props: { readonly node: unknown }) => JSX.Element,
    ): (() => void) | void
  }
  /** Cordis effect seat used to tie the registrations to the plugin lifetime. */
  effect?(callback: () => void | (() => void), label?: string): (() => void) | void
}

/** Host deps the renderer needs: copy plus one item lookup per key. */
export interface ContextCardDeps {
  /** Translate function for the card's title and "more" line. */
  readonly t: Translate
  /** Look up one item's display fields per library and key; may reject. */
  readonly getItem: (library: string, key: string) => Promise<{ title: string; creatorSummary: string; year: string }>
}

/** Disposers parked when the context has no `effect` seat (nothing is lost, nothing throws). */
const detachedDisposers: Array<() => void> = []

/** Run and clear a disposer list in reverse registration order. */
function disposeAll(disposers: Array<() => void>): void {
  while (disposers.length > 0) {
    const next = disposers.pop()
    if (next === undefined) continue
    try {
      next()
    } catch {
      // A failing disposer must not break the remaining teardown.
    }
  }
}

/**
 * Register the message-side fold: the `userText` matching rule and the
 * `conversation.user.text.node` renderer.
 *
 * Both registrations are defensive. A host without `uiConversation` or
 * `slots` simply keeps the raw expanded text (ADR 0004's degraded path), and
 * a failing seat never throws out of this function. The returned disposers are
 * tied to the plugin lifetime through `ctx.effect`; without that seat they are
 * parked in this module so a later teardown can still reach them.
 *
 * @param ctx - client context (only the members used here are declared).
 * @param deps - translate seat and per-key item lookup for hover details.
 */
export function registerContextCard(ctx: CardContext, deps: ContextCardDeps): void {
  if (typeof ctx !== 'object' || ctx === null) return
  activeDeps = deps
  const disposers: Array<() => void> = []

  try {
    const userText = ctx.uiConversation?.userText
    if (userText !== undefined && typeof userText.register === 'function') {
      const rule: UserTextRule = {
        id: CARD_KEY,
        order: 10,
        match: (text: string, from: number) => {
          const hit = matchZoteroContextBlock(text, from)
          return hit === undefined ? undefined : { id: CARD_KEY, ...hit, data: hit.data }
        },
      }
      const dispose = userText.register(rule)
      if (typeof dispose === 'function') disposers.push(dispose)
    }
  } catch {
    // Matching is an enhancement; a broken registry must not break the plugin.
  }

  try {
    const slots = ctx.slots
    if (slots !== undefined && typeof slots.register === 'function') {
      const registerRenderer = (): (() => void) | void => slots.register?.({ name: NODE_SLOT, key: CARD_KEY, locale: NAMESPACE }, ContextCard)
      const dispose = typeof slots.inject === 'function' ? slots.inject(NODE_SLOT, registerRenderer) : registerRenderer()
      if (typeof dispose === 'function') disposers.push(dispose)
    }
  } catch {
    // Same rule: no renderer seat just leaves the expanded text in place.
  }

  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        disposeAll(disposers)
      }, 'zotero: context card')
    } else {
      detachedDisposers.push(...disposers)
    }
  } catch {
    // Lifecycle wiring is best effort; registrations already happened eagerly.
  }
}
