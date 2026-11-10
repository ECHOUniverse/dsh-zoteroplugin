/**
 * Zotero Context Chip: the self-contained reference carried by one chip in
 * the DSH chat draft (ADR 0004, "加入对话用引用芯片承载上下文").
 *
 * Evidence and design constraints:
 *
 * - ADR 0004 decides that "Add to chat" inserts a single atomic reference
 *   chip (`ctx.inputTriggers.registerSource()`, `appearance: 'file'`) instead
 *   of pushing the fixed-format multi-line text into the draft. The chip
 *   shows a short label and the model text is produced by the source's
 *   `codec.serialize(ref)` at send time.
 * - The `ref` must be self-contained — library, item key/title/creators/year and
 *   the primary PDF attachment key for an item selection; item/attachment keys,
 *   page and quoted text for a PDF passage — encoded as base64url JSON — so `codec.serialize` stays a
 *   pure function and still works after a reload or while Zotero is down
 *   (ADR 0004 "Decision"; `docs/adr/0004-reference-chip-for-zotero-context.md`).
 * - The model text must stay byte-identical to the previous fixed-format
 *   projections, so this module reuses `itemsDraftText` / `quoteDraftText`
 *   from `./chat-draft.ts` (a pure, side-effect-free module) instead of
 *   re-implementing the formatting: the chip only changes what the user sees
 *   in the draft, never what the model reads.
 * - A single passage above 8k characters is refused rather than silently
 *   truncated (ADR 0004; the DSH codec contract is "throwing blocks the send
 *   and keeps the draft").
 *
 * Everything here is pure and host-free: no DSH import, no Zotero access, no
 * module-level mutable state. Encoding uses only the globals `TextEncoder`,
 * `atob` and `btoa` so the same code runs in the browser and in vitest's Node
 * environment (no `node:buffer`).
 *
 * @module @hanxu131/dsh-zotero/client/context-chip
 */

import { itemsDraftText, quoteDraftText, type QuoteRef } from './chat-draft.ts'
import type { ItemSummaryWire } from '../shared/protocol.ts'

/** `@` trigger source id the chip is registered under (ADR 0004). */
export const CONTEXT_CHIP_SOURCE = 'zotero'

/** Reference-chip appearance shown by the DSH renderer (`file` in v1). */
export const CONTEXT_CHIP_APPEARANCE = 'file'

/** Largest quoted passage the chip accepts; longer ones are refused. */
export const MAX_QUOTE_CHARS = 8000

/**
 * One item carried inside a chip ref. `pdfKey` is the item's primary PDF
 * attachment key when it has one: the model text keeps the `· PDF <key>`
 * marker (the only handle for `read_fulltext` / `find_in_pdf` / `cite`), so
 * the ref must carry it too or the projection would regress.
 */
export interface ContextChipItem {
  readonly key: string
  readonly title: string
  readonly creatorSummary: string
  readonly year: string
  readonly pdfKey: string | null
}

/** The whole selection one chip stands for: item set or one PDF passage. */
export type ContextChipSelection =
  | { readonly kind: 'items'; readonly library: string; readonly items: readonly ContextChipItem[] }
  | {
      readonly kind: 'quote'
      readonly library: string
      readonly itemKey: string
      readonly attachmentKey: string
      readonly title: string
      readonly pageIndex: number
      readonly pageLabel: string
      readonly text: string
    }

/** Item fields `itemsDraftText` reads for its fixed-format projection. */
type DraftItem = Pick<ItemSummaryWire, 'key' | 'title' | 'creatorSummary' | 'year' | 'pdf'>

/**
 * Build an item-set selection from the tab's current selection.
 *
 * Only these ref fields survive: the chip ref is persisted with the draft and
 * re-decoded later, so its shape must round-trip exactly (ADR 0004 lists
 * library/key/title/creators/year plus the PDF attachment key as the item
 * payload — the key is what keeps the `· PDF <key>` marker in the model text).
 */
export function selectionFromItems(
  items: readonly Pick<ItemSummaryWire, 'key' | 'title' | 'creatorSummary' | 'year' | 'pdf'>[],
  library: string,
): ContextChipSelection {
  return {
    kind: 'items',
    library,
    items: items.map((item) => ({
      key: item.key,
      title: item.title,
      creatorSummary: item.creatorSummary,
      year: item.year,
      pdfKey: item.pdf === null ? null : item.pdf.key,
    })),
  }
}

/**
 * Build a PDF-passage selection from a reader selection (`QuoteRef` shape
 * minus none: every field is carried so the ref is self-contained).
 */
export function selectionFromQuote(quote: {
  library: string
  itemKey: string
  attachmentKey: string
  title: string
  pageIndex: number
  pageLabel: string
  text: string
}): ContextChipSelection {
  return {
    kind: 'quote',
    library: quote.library,
    itemKey: quote.itemKey,
    attachmentKey: quote.attachmentKey,
    title: quote.title,
    pageIndex: quote.pageIndex,
    pageLabel: quote.pageLabel,
    text: quote.text,
  }
}

/** Encode bytes as unpadded base64url (`-`/`_` alphabet, no `=`). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Decode unpadded base64url back to bytes (throws on invalid input). */
function fromBase64Url(encoded: string): Uint8Array {
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = standard.length % 4
  const padded = remainder === 0 ? standard : standard + '='.repeat(4 - remainder)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Encode a selection as the chip ref: JSON → UTF-8 → unpadded base64url.
 * Pure and deterministic; the encoded form is what the draft persists.
 */
export function encodeContextRef(selection: ContextChipSelection): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(selection)))
}

/** Non-null object check for untrusted decoded JSON. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read a string field, or `null` when absent or of another type. */
function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Validate the item-set shape of decoded JSON; `null` when malformed. */
function itemsSelectionFrom(record: Record<string, unknown>): ContextChipSelection | null {
  const library = stringField(record.library)
  if (library === null) return null
  const rawItems = record.items
  if (!Array.isArray(rawItems)) return null
  const items: ContextChipItem[] = []
  for (const entry of rawItems) {
    if (!isRecord(entry)) return null
    const key = stringField(entry.key)
    const title = stringField(entry.title)
    const creatorSummary = stringField(entry.creatorSummary)
    const year = stringField(entry.year)
    if (key === null || title === null || creatorSummary === null || year === null) return null
    const rawPdfKey = entry.pdfKey
    if (rawPdfKey !== null && typeof rawPdfKey !== 'string') return null
    items.push({ key, title, creatorSummary, year, pdfKey: rawPdfKey })
  }
  return { kind: 'items', library, items }
}

/** Validate the quote shape of decoded JSON; `null` when malformed. */
function quoteSelectionFrom(record: Record<string, unknown>): ContextChipSelection | null {
  const library = stringField(record.library)
  const itemKey = stringField(record.itemKey)
  const attachmentKey = stringField(record.attachmentKey)
  const title = stringField(record.title)
  const pageLabel = stringField(record.pageLabel)
  const text = stringField(record.text)
  const pageIndex = record.pageIndex
  if (library === null || itemKey === null || attachmentKey === null) return null
  if (title === null || pageLabel === null || text === null) return null
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex)) return null
  return { kind: 'quote', library, itemKey, attachmentKey, title, pageIndex, pageLabel, text }
}

/**
 * Decode a chip ref produced by {@link encodeContextRef}.
 *
 * Defensive by contract: an empty string, a non-string, invalid base64, a
 * JSON syntax error, an unknown `kind`, or any missing/mistyped field yields
 * `null` — this function never throws (the send path must be able to fall
 * back instead of crashing on a persisted draft).
 */
export function decodeContextRef(ref: string): ContextChipSelection | null {
  if (typeof ref !== 'string' || ref === '') return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(ref)))
    if (!isRecord(parsed)) return null
    if (parsed.kind === 'items') return itemsSelectionFrom(parsed)
    if (parsed.kind === 'quote') return quoteSelectionFrom(parsed)
    return null
  } catch {
    return null
  }
}

/**
 * Model-facing text for a selection, byte-identical to the old fixed-format
 * draft text: the items branch delegates to `itemsDraftText`, the quote
 * branch maps back to `QuoteRef` and delegates to `quoteDraftText`.
 */
export function contextPayloadText(selection: ContextChipSelection): string {
  if (selection.kind === 'items') {
    // Rebuild the `pdf` field so `itemsDraftText` keeps emitting `· PDF <key>`
    // exactly as it did before the chip existed.
    const items: DraftItem[] = selection.items.map((item) => ({
      key: item.key,
      title: item.title,
      creatorSummary: item.creatorSummary,
      year: item.year,
      pdf: item.pdfKey === null ? null : { key: item.pdfKey },
    }))
    return itemsDraftText(items, selection.library)
  }
  const quote: QuoteRef = {
    library: selection.library,
    itemKey: selection.itemKey,
    attachmentKey: selection.attachmentKey,
    title: selection.title,
    pageIndex: selection.pageIndex,
    pageLabel: selection.pageLabel,
    text: selection.text,
  }
  return quoteDraftText(quote)
}

/**
 * Model-facing text for one chip: the plain payload wrapped in single newlines.
 *
 * DSH inserts one space after every reference chip (`$replaceDetectSpanWithNodes`
 * appends a space), and text the user typed sits immediately beside the chip.
 * Without the wrapping, two chips — or a chip after a typed question — would
 * concatenate their blocks mid-line, which both reads badly to the model and
 * breaks the line-anchored fold rule on the message side. The leading and
 * trailing newlines turn each chip into its own paragraph.
 *
 * @param selection - the selection the chip stands for.
 * @returns `\n<payload>\n`; the payload itself stays byte-identical to
 * {@link contextPayloadText} and to the old fixed-format draft text.
 */
export function contextModelText(selection: ContextChipSelection): string {
  return `\n${contextPayloadText(selection)}\n`
}

/**
 * Short chip label, rendered through the host translator: the item count for
 * a set, the 1-based page number for a passage. No copy lives in this module.
 */
export function contextChipLabel(
  selection: ContextChipSelection,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (selection.kind === 'items') return t('chat.chip.items', { count: selection.items.length })
  return t('chat.chip.quote', { page: selection.pageIndex + 1 })
}

/**
 * Whether the selection may be inserted at all: item sets always fit, a
 * passage fits while it is at most {@link MAX_QUOTE_CHARS} characters (an
 * over-long passage is refused, never truncated — ADR 0004).
 */
export function quoteSelectionFitsLimit(selection: ContextChipSelection): boolean {
  if (selection.kind === 'items') return true
  return selection.text.length <= MAX_QUOTE_CHARS
}
