/**
 * Zotero Context Chip — host wiring (ADR 0004, implementation spec §6
 * "会话上下文", milestone M8).
 *
 * ADR 0004 (`docs/adr/0004-reference-chip-for-zotero-context.md`) splits the
 * composer half in two pieces: `client/context-chip.ts` owns the pure ref
 * codec and text projections, and this module connects them to the official
 * DSH extension points:
 *
 * - `ctx.inputTriggers.registerSource({ trigger:'@', name:'zotero', codec })`
 *   registers the `@` source whose `codec.serialize(ref)` (and
 *   `codec.clipboardText(ref)`) expands a chip back into exactly the text the
 *   model used to receive. DSH evidence: verification point V-13 in
 *   `docs/implementation-spec.md` records the source/codec contract
 *   (`serialize` throwing blocks the send and keeps the draft), so the codec
 *   here never throws — an undecodable ref is returned verbatim.
 * - `ctx.conversation.input.for(ctx.sessions.scope(sessionId))` →
 *   `insertReference(reference, span)` inserts the atomic chip at the caret
 *   span captured by `captureInsertion()`; the reference's `clipboardText` is
 *   the full expanded text (ADR 0004 "Decision").
 * - `captureInsertion()` / `insertText()` / `setDraft()` / `submit()` are the
 *   official session-scoped `inputActions` face already used by
 *   `client/chat-draft.ts` (V-6, resolved).
 *
 * Every host surface is optional. When the chip path is unavailable — no
 * `inputTriggers`, no `conversation`, no insertion span, a rejected
 * `insertReference`, or any exception — both operations degrade to the old
 * behavior: `addToChat` writes the expanded multi-line text into the draft
 * (never sending), and Ask falls back to the byte-identical legacy payload
 * (`askText` / `askQuoteText`). ADR 0004: no path ever sends silently.
 *
 * The module keeps one module-level slot for the runtime installed by
 * `client.tsx` so late-arriving services are picked up by the next call
 * (`currentChipRuntime()`), and imports no DSH internals: the browser half
 * always treats the host as a defensive face.
 *
 * @module @hanxu131/dsh-zotero/client/context-chip-source
 */

import {
  CONTEXT_CHIP_APPEARANCE,
  CONTEXT_CHIP_SOURCE,
  contextChipLabel,
  contextModelText,
  contextPayloadText,
  decodeContextRef,
  encodeContextRef,
  quoteSelectionFitsLimit,
  type ContextChipSelection,
} from './context-chip.ts'
import { addToChat, ask, askQuote, type ChatFace } from './chat-draft.ts'

/** Outcome of one Add-to-chat attempt once the chip runtime is consulted. */
export type ChipInsertResult = 'inserted' | 'fallback' | 'unavailable' | 'too-long'

/**
 * Optional host extension points the chip needs. Every member is optional and
 * defensively typed: a missing service means "degrade", never "crash".
 */
export interface ChipHost {
  /** `@` trigger registry (`registerSource` returns the disposer when it took the source). */
  readonly inputTriggers?: { registerSource?(source: unknown): (() => void) | void }
  /** Reference insertion surface, scoped through `sessions.scope(...)`. */
  readonly conversation?: {
    input?: { for?(actx: unknown): { insertReference?(reference: unknown, span: unknown): boolean } | undefined }
  }
  /** Session-scope resolver handed to `conversation.input.for(...)`. */
  readonly sessions?: { scope?(sessionId: string): unknown }
}

/** Host context plus the plugin translator the chip labels need. */
export interface ChipServices {
  readonly host: ChipHost
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/** `@` menu order of the Zotero source (after the shipped sources). */
const SOURCE_ORDER = 90

/** Reference object handed to `conversation.input.for(...).insertReference(...)`. */
interface ChipReference {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance: string
  readonly clipboardText: string
}

/**
 * Decode `ref` and project it to the model text; never throws.
 *
 * ADR 0004 requires the codec to be a pure function of the ref: a decodable
 * ref expands through `contextPayloadText` (byte-identical to the old draft
 * text), anything else is returned verbatim so the send is never blocked by a
 * stale or foreign reference.
 */
function codecText(ref: unknown): string {
  let raw: string
  try {
    raw = typeof ref === 'string' ? ref : String(ref)
  } catch {
    return ''
  }
  try {
    const selection = decodeContextRef(raw)
    return selection === null ? raw : contextPayloadText(selection)
  } catch {
    return raw
  }
}

/**
 * Model serialization of one occurrence: the same payload, paragraph-wrapped.
 *
 * DSH appends a space after every chip, so a bare payload would join the
 * neighbouring blocks mid-line (two chips, or typed text beside a chip). The
 * wrapping in `contextModelText` keeps each block on its own lines; the
 * clipboard projection stays unwrapped.
 */
function codecModelText(ref: unknown): string {
  let raw: string
  try {
    raw = typeof ref === 'string' ? ref : String(ref)
  } catch {
    return ''
  }
  try {
    const selection = decodeContextRef(raw)
    return selection === null ? raw : contextModelText(selection)
  } catch {
    return raw
  }
}

/**
 * Register the `@` reference source with the host trigger registry.
 *
 * @returns the disposer when the host accepted the source, or `null` when
 * `inputTriggers.registerSource` is missing, throws, or returns no disposer.
 */
export function registerContextChipSource(services: ChipServices): (() => void) | null {
  const registerSource = services.host.inputTriggers?.registerSource
  if (typeof registerSource !== 'function') return null
  try {
    const dispose = registerSource.call(services.host.inputTriggers, {
      trigger: '@',
      name: CONTEXT_CHIP_SOURCE,
      order: SOURCE_ORDER,
      showGroupTitle: false,
      // v1 ships no candidates: the `@` menu shows the group title only
      // (ADR 0004 "Consequences").
      candidates: async () => [],
      onPick: () => undefined,
      codec: {
        clipboardText: codecText,
        serialize: async (ref: unknown) => codecModelText(ref),
      },
    })
    return typeof dispose === 'function' ? dispose : null
  } catch {
    return null
  }
}

/**
 * Old behavior for Add to chat: write the expanded text into the draft through
 * the non-destructive `captureInsertion` + `insertText` path (never sends).
 */
async function writeExpandedText(selection: ContextChipSelection, face: ChatFace): Promise<ChipInsertResult> {
  try {
    const outcome = await addToChat(face, contextPayloadText(selection))
    return outcome === 'written' ? 'fallback' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Old behavior for Ask, byte-identical to the pre-chip payloads: the item
 * branch rebuilds the `ItemSummaryWire` projection and calls `ask(...)`, the
 * quote branch calls `askQuote(...)`; both submit in queue mode.
 */
function askExpanded(question: string, selection: ContextChipSelection, face: ChatFace): ChipInsertResult {
  try {
    const outcome =
      selection.kind === 'items'
        ? ask(
            face,
            question,
            selection.items.map((item) => ({
              key: item.key,
              title: item.title,
              creatorSummary: item.creatorSummary,
              year: item.year,
              pdf: item.pdfKey === null ? null : { key: item.pdfKey },
            })),
            selection.library,
          )
        : askQuote(face, question, {
            library: selection.library,
            itemKey: selection.itemKey,
            attachmentKey: selection.attachmentKey,
            title: selection.title,
            pageIndex: selection.pageIndex,
            pageLabel: selection.pageLabel,
            text: selection.text,
          })
    return outcome === 'submitted' ? 'fallback' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Create the chip runtime used by every Add-to-chat / Ask entry point.
 *
 * `available` reports whether the host took the `@` source. The one real
 * registration is owned by `apply` in `client.tsx` (through `ctx.effect`), so
 * callers pass that outcome in as `options.available`; without the option this
 * function probes by registering and immediately releasing the probe, which is
 * only for tests and single-shot runtimes (a runtime must not leak a second
 * source into the trigger menu).
 */
export function createChipRuntime(services: ChipServices, options?: { readonly available?: boolean }): ChipRuntime {
  let available: boolean
  if (options?.available !== undefined) {
    available = options.available
  } else {
    const probe = registerContextChipSource(services)
    if (probe !== null) {
      try {
        probe()
      } catch {
        // Releasing the probe is best effort; the caller owns the live source.
      }
    }
    available = probe !== null
  }

  /** The reference the DSH renderer shows as one short chip. */
  const referenceFor = (selection: ContextChipSelection): ChipReference => ({
    source: CONTEXT_CHIP_SOURCE,
    ref: encodeContextRef(selection),
    label: contextChipLabel(selection, services.t),
    appearance: CONTEXT_CHIP_APPEARANCE,
    clipboardText: contextPayloadText(selection),
  })

  /**
   * One insertion attempt at `span`: resolve the session scope, ask the
   * conversation input for its insert surface, then insert. Any missing
   * capability reports `false` (the caller degrades).
   */
  const insertReferenceAt = (selection: ContextChipSelection, sessionId: string | undefined, span: unknown): boolean => {
    const actx = sessionId === undefined ? undefined : services.host.sessions?.scope?.(sessionId)
    const input = services.host.conversation?.input?.for?.(actx)
    if (input === undefined || input === null) return false
    const insertReference = input.insertReference
    if (typeof insertReference !== 'function') return false
    return insertReference.call(input, referenceFor(selection), span) === true
  }

  /**
   * Add to chat: insert the chip at the caret span, or fall back to writing
   * the expanded text. Never sends.
   */
  const insert = async (selection: ContextChipSelection, sessionId: string | undefined, face: ChatFace | null): Promise<ChipInsertResult> => {
    if (!quoteSelectionFitsLimit(selection)) return 'too-long'
    if (face === null) return 'unavailable'
    const capture = face.captureInsertion
    if (typeof capture !== 'function') return 'unavailable'
    let span: unknown
    try {
      span = capture.call(face)
    } catch {
      return writeExpandedText(selection, face)
    }
    if (span === undefined || span === null) return 'unavailable'
    if (available) {
      let inserted = false
      try {
        inserted = insertReferenceAt(selection, sessionId, span)
      } catch {
        inserted = false
      }
      if (inserted) return 'inserted'
    }
    return writeExpandedText(selection, face)
  }

  /**
   * Chip-first Ask: write the trimmed question, insert the chip, submit. Any
   * failure falls back to the legacy `ask` / `askQuote` payload.
   */
  const askWithChip = async (
    question: string,
    selection: ContextChipSelection,
    sessionId: string | undefined,
    face: ChatFace | null,
  ): Promise<ChipInsertResult | 'submitted'> => {
    if (!quoteSelectionFitsLimit(selection)) return 'too-long'
    if (face === null) return 'unavailable'
    if (available) {
      const capture = face.captureInsertion
      if (typeof capture === 'function') {
        try {
          face.setDraft(question.trim())
          const span = capture.call(face)
          if (span !== undefined && span !== null && insertReferenceAt(selection, sessionId, span)) {
            face.submit()
            return 'submitted'
          }
        } catch {
          // Fall through to the legacy Ask semantics below.
        }
      }
    }
    return askExpanded(question, selection, face)
  }

  return { available, insert, ask: askWithChip }
}

/**
 * Chip operations shared by every entry point: `insert` for Add to chat,
 * `ask` for the Ask box. Results tell the view which toast to raise.
 */
export interface ChipRuntime {
  /** Whether the host accepted the `@` source (otherwise every call degrades). */
  readonly available: boolean
  insert(selection: ContextChipSelection, sessionId: string | undefined, face: ChatFace | null): Promise<ChipInsertResult>
  ask(question: string, selection: ContextChipSelection, sessionId: string | undefined, face: ChatFace | null): Promise<ChipInsertResult | 'submitted'>
}

/**
 * Runtime owned by the mounted client plugin, or `null` while the host has not
 * offered the chip services yet.
 *
 * The services may arrive asynchronously (`ctx.inject` callback), after the tab
 * has already rendered; views therefore read this slot at call time instead of
 * capturing a `null` from their render pass.
 */
let installed: ChipRuntime | null = null

/**
 * Install the runtime created from the live host services.
 *
 * @param services - host extension points plus the plugin translator.
 * @param available - whether the host accepted the `@` source registration.
 * @returns the installed runtime.
 */
export function installChipRuntime(services: ChipServices, available: boolean): ChipRuntime {
  installed = createChipRuntime(services, { available })
  return installed
}

/**
 * The runtime installed by {@link installChipRuntime}, read at call time.
 *
 * @returns the installed runtime, or `null` on hosts without the chip seats.
 */
export function currentChipRuntime(): ChipRuntime | null {
  return installed
}
