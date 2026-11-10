/**
 * `src/client/context-chip-source.ts` tests: the `@` source registration, the
 * codec round-trip (ADR 0004 — a chip expands to the same model text as the
 * old draft writer), the insert / ask chip path and the full fallback path.
 *
 * Everything is driven by fake host objects and a fake chat face: no DSH
 * runtime, no Zotero, no real conversation.
 */
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_CHIP_APPEARANCE,
  CONTEXT_CHIP_SOURCE,
  MAX_QUOTE_CHARS,
  contextChipLabel,
  contextModelText,
  contextPayloadText,
  encodeContextRef,
  selectionFromItems,
  selectionFromQuote,
} from '../src/client/context-chip.ts'
import { askQuoteText, askText, type ChatFace } from '../src/client/chat-draft.ts'
import { createChipRuntime, currentChipRuntime, installChipRuntime, registerContextChipSource, type ChipHost } from '../src/client/context-chip-source.ts'
import type { ItemSummaryWire } from '../src/shared/protocol.ts'

const summary = (overrides: Partial<ItemSummaryWire> = {}): ItemSummaryWire => ({
  key: 'ABCD2345',
  itemType: 'journalArticle',
  title: 'Deep Learning for Schema Matching',
  creatorSummary: 'Smith, J.; Wang, L.',
  year: '2024',
  venue: 'Nature Methods',
  tags: [],
  numChildren: 2,
  pdf: { key: 'PDFK2345' },
  dateAdded: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-02T00:00:00Z',
  ...overrides,
})

const quote = (overrides: Partial<Parameters<typeof selectionFromQuote>[0]> = {}): Parameters<typeof selectionFromQuote>[0] => ({
  library: 'user',
  itemKey: 'ABCD2345',
  attachmentKey: 'PDFK2345',
  title: 'Deep Learning for Schema Matching',
  pageIndex: 4,
  pageLabel: '5',
  text: 'first line\nsecond line',
  ...overrides,
})

/** Fake translator: echoes the key and its params (labels come from the dictionaries). */
const t = (key: string, params?: Record<string, string | number>): string => key + JSON.stringify(params ?? {})

/** Reference object the host receives from `insertReference`. */
interface ReferenceShape {
  source: string
  ref: string
  label: string
  appearance: string
  clipboardText: string
}

/** One source as the fake trigger registry stored it. */
interface SourceShape {
  trigger: string
  name: string
  order: number
  showGroupTitle: boolean
  candidates: () => Promise<unknown[]>
  onPick: () => unknown
  codec: { clipboardText: (ref: unknown) => string; serialize: (ref: unknown) => Promise<string> }
}

/** Fake chat face that records every call (drafts, insertions, submits). */
interface FaceSpy {
  face: ChatFace
  drafts: string[]
  texts: string[]
  submits: number
  captures: number
}

function recordingFace(span: { draftRev: number } | undefined = { draftRev: 1 }): FaceSpy {
  const spy: FaceSpy = {
    drafts: [],
    texts: [],
    submits: 0,
    captures: 0,
    face: {
      setDraft: (text: string) => {
        spy.drafts.push(text)
      },
      submit: () => {
        spy.submits += 1
      },
      captureInsertion: () => {
        spy.captures += 1
        return span
      },
      insertText: (text: string) => {
        spy.texts.push(text)
        return true
      },
    },
  }
  return spy
}

/** Host whose `@` source registration succeeds (the insert/ask chip path). */
function chippedHost(onReference: (reference: ReferenceShape, span: unknown, actx: unknown) => boolean): ChipHost {
  return {
    inputTriggers: { registerSource: () => () => {} },
    sessions: { scope: (sessionId: string) => ({ sessionId }) },
    conversation: {
      input: {
        for: (actx: unknown) => ({
          insertReference: (reference: unknown, span: unknown) => onReference(reference as ReferenceShape, span, actx),
        }),
      },
    },
  }
}

describe('registerContextChipSource', () => {
  it('registers the @ zotero source and its codec round-trips to the expanded text', async () => {
    const sources: unknown[] = []
    let released = 0
    const disposer = (): void => {
      released += 1
    }
    const host: ChipHost = {
      inputTriggers: {
        registerSource: (source) => {
          sources.push(source)
          return disposer
        },
      },
    }

    const dispose = registerContextChipSource({ host, t })
    expect(dispose).toBe(disposer)
    expect(sources).toHaveLength(1)

    const source = sources[0] as SourceShape
    expect(source.trigger).toBe('@')
    expect(source.name).toBe(CONTEXT_CHIP_SOURCE)
    expect(source.order).toBe(90)
    expect(source.showGroupTitle).toBe(false)
    expect(await source.candidates()).toEqual([])
    expect(source.onPick()).toBeUndefined()

    const selection = selectionFromItems([summary()], 'user')
    const ref = encodeContextRef(selection)
    const payload = contextPayloadText(selection)
    // Clipboard projection stays the bare payload; the model text is the
    // paragraph-wrapped form (two chips or a chip after typed text would
    // otherwise concatenate mid-line, because DSH appends a space per chip).
    expect(source.codec.clipboardText(ref)).toBe(payload)
    expect(await source.codec.serialize(ref)).toBe(contextModelText(selection))
    expect(await source.codec.serialize(ref)).toBe(`\n${payload}\n`)

    // A foreign / stale ref is handed back verbatim — the codec never throws.
    expect(source.codec.clipboardText('plain text, not a ref')).toBe('plain text, not a ref')
    expect(await source.codec.serialize('plain text, not a ref')).toBe('plain text, not a ref')

    dispose?.()
    expect(released).toBe(1)
  })

  it('returns null when the host has no trigger registry or it throws', () => {
    expect(registerContextChipSource({ host: {}, t })).toBeNull()
    const throwing: ChipHost = {
      inputTriggers: {
        registerSource: () => {
          throw new Error('no seat')
        },
      },
    }
    expect(registerContextChipSource({ host: throwing, t })).toBeNull()
  })

  it('returns null when registerSource hands back no disposer', () => {
    const host: ChipHost = { inputTriggers: { registerSource: () => undefined } }
    expect(registerContextChipSource({ host, t })).toBeNull()
  })
})

describe('createChipRuntime availability', () => {
  it('is unavailable without the host extension points', () => {
    const runtime = createChipRuntime({ host: {}, t })
    expect(runtime.available).toBe(false)
  })

  it('probes the source once and releases the probe (the caller owns the live source)', () => {
    let registered = 0
    let released = 0
    const host: ChipHost = {
      inputTriggers: {
        registerSource: () => {
          registered += 1
          return () => {
            released += 1
          }
        },
      },
    }
    const runtime = createChipRuntime({ host, t })
    expect(runtime.available).toBe(true)
    expect(registered).toBe(1)
    expect(released).toBe(1)
  })
})

describe('insert (Add to chat)', () => {
  it('inserts the chip reference through sessions + conversation', async () => {
    const seen: { reference: ReferenceShape; span: unknown; actx: unknown }[] = []
    const runtime = createChipRuntime({
      host: chippedHost((reference, span, actx) => {
        seen.push({ reference, span, actx })
        return true
      }),
      t,
    })
    const spy = recordingFace()
    const selection = selectionFromQuote(quote())

    expect(await runtime.insert(selection, 's1', spy.face)).toBe('inserted')
    expect(seen).toHaveLength(1)
    const first = seen[0]
    expect(first?.actx).toEqual({ sessionId: 's1' })
    expect(first?.span).toEqual({ draftRev: 1 })
    expect(first?.reference).toEqual({
      source: CONTEXT_CHIP_SOURCE,
      ref: encodeContextRef(selection),
      label: contextChipLabel(selection, t),
      appearance: CONTEXT_CHIP_APPEARANCE,
      clipboardText: contextPayloadText(selection),
    })
    // The label is the short one from the fake dictionary ("1 passage · page 5").
    expect(first?.reference.label).toBe('chat.chip.quote{"page":5}')
    // Nothing was written into the draft: the chip is the only change.
    expect(spy.texts).toEqual([])
  })

  it('falls back to writing the full expanded text when the chip services are missing', async () => {
    const spy = recordingFace()
    const runtime = createChipRuntime({ host: {}, t })
    const selection = selectionFromItems([summary()], 'user')

    expect(await runtime.insert(selection, undefined, spy.face)).toBe('fallback')
    expect(spy.texts).toEqual([contextPayloadText(selection)])
    expect(spy.drafts).toEqual([])
  })

  it('falls back when insertReference reports false', async () => {
    const spy = recordingFace()
    const runtime = createChipRuntime({ host: chippedHost(() => false), t })
    const selection = selectionFromItems([summary()], 'g42')

    expect(await runtime.insert(selection, 's1', spy.face)).toBe('fallback')
    expect(spy.texts).toEqual([contextPayloadText(selection)])
  })

  it('refuses an over-long passage and never touches the face', async () => {
    const spy = recordingFace()
    const runtime = createChipRuntime({ host: chippedHost(() => true), t })
    const selection = selectionFromQuote(quote({ text: 'x'.repeat(MAX_QUOTE_CHARS + 1) }))

    expect(await runtime.insert(selection, 's1', spy.face)).toBe('too-long')
    expect(spy.drafts).toEqual([])
    expect(spy.texts).toEqual([])
    expect(spy.submits).toBe(0)
  })

  it('is unavailable without a chat face', async () => {
    const runtime = createChipRuntime({ host: chippedHost(() => true), t })
    expect(await runtime.insert(selectionFromItems([summary()], 'user'), 's1', null)).toBe('unavailable')
  })
})

describe('ask', () => {
  it('writes the question, inserts the chip, then submits', async () => {
    const order: string[] = []
    const host: ChipHost = {
      inputTriggers: { registerSource: () => () => {} },
      sessions: { scope: () => ({}) },
      conversation: {
        input: {
          for: () => ({
            insertReference: () => {
              order.push('insertReference')
              return true
            },
          }),
        },
      },
    }
    const runtime = createChipRuntime({ host, t })
    const face: ChatFace = {
      setDraft: (text: string) => {
        order.push(`setDraft:${text}`)
      },
      submit: () => {
        order.push('submit')
      },
      captureInsertion: () => {
        order.push('captureInsertion')
        return { draftRev: 2 }
      },
      insertText: () => {
        order.push('insertText')
        return true
      },
    }

    const selection = selectionFromItems([summary()], 'user')
    expect(await runtime.ask('  Compare these  ', selection, 's1', face)).toBe('submitted')
    expect(order).toEqual(['setDraft:Compare these', 'captureInsertion', 'insertReference', 'submit'])
  })

  it('falls back to the legacy item payload without chip services', async () => {
    const spy = recordingFace()
    const runtime = createChipRuntime({ host: {}, t })
    const items = [summary()]
    const selection = selectionFromItems(items, 'g42')

    expect(await runtime.ask('Why?', selection, undefined, spy.face)).toBe('fallback')
    expect(spy.drafts).toEqual([askText('Why?', items, 'g42')])
    expect(spy.submits).toBe(1)
  })

  it('falls back to the legacy quote payload without chip services', async () => {
    const spy = recordingFace()
    const runtime = createChipRuntime({ host: {}, t })
    const selection = selectionFromQuote(quote())

    expect(await runtime.ask('Why?', selection, undefined, spy.face)).toBe('fallback')
    expect(spy.drafts).toEqual([askQuoteText('Why?', quote())])
    expect(spy.submits).toBe(1)
  })

  it('falls back to the legacy payload when the chip path throws', async () => {
    const spy = recordingFace()
    const host: ChipHost = {
      inputTriggers: { registerSource: () => () => {} },
      sessions: { scope: () => ({}) },
      conversation: {
        input: {
          for: () => ({
            insertReference: () => {
              throw new Error('insert seat broke')
            },
          }),
        },
      },
    }
    const runtime = createChipRuntime({ host, t })
    const selection = selectionFromItems([summary()], 'user')

    expect(await runtime.ask('Why?', selection, 's1', spy.face)).toBe('fallback')
    expect(spy.drafts).toHaveLength(2)
    expect(spy.drafts[1]).toBe(askText('Why?', [summary()], 'user'))
    expect(spy.submits).toBe(1)
  })

  it('refuses an over-long passage before any draft write', async () => {
    const spy = recordingFace()
    const runtime = createChipRuntime({ host: chippedHost(() => true), t })
    const selection = selectionFromQuote(quote({ text: 'x'.repeat(MAX_QUOTE_CHARS + 1) }))

    expect(await runtime.ask('Why?', selection, 's1', spy.face)).toBe('too-long')
    expect(spy.drafts).toEqual([])
    expect(spy.submits).toBe(0)
  })

  it('is unavailable without a chat face', async () => {
    const runtime = createChipRuntime({ host: chippedHost(() => true), t })
    expect(await runtime.ask('Why?', selectionFromItems([summary()], 'user'), 's1', null)).toBe('unavailable')
  })
})

describe('installChipRuntime / currentChipRuntime', () => {
  it('starts uninstalled and exposes the installed runtime by reference', () => {
    expect(currentChipRuntime()).toBeNull()
    const runtime = installChipRuntime({ host: {}, t }, false)
    expect(currentChipRuntime()).toBe(runtime)
    expect(runtime.available).toBe(false)
  })

  it('honours an injected availability answer instead of probing the host', async () => {
    // A host that would accept a source, but the caller already registered it:
    // passing `available` must not register a second `@` source.
    let registrations = 0
    const host: ChipHost = {
      inputTriggers: {
        registerSource: () => {
          registrations += 1
          return () => undefined
        },
      },
    }
    const runtime = installChipRuntime({ host, t }, true)
    expect(runtime.available).toBe(true)
    expect(registrations).toBe(0)
  })

  it('keeps the legacy draft path when the caller reports no source', async () => {
    const spy = recordingFace()
    const runtime = installChipRuntime({ host: chippedHost(() => true), t }, false)
    const selection = selectionFromItems([summary()], 'user')
    expect(await runtime.insert(selection, 's1', spy.face)).toBe('fallback')
    expect(spy.texts).toEqual([contextPayloadText(selection)])
  })
})
