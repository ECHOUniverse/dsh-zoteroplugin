/**
 * Message-side Zotero Context Card (ADR 0004) — behavior tests only.
 *
 * The block fixtures are produced by the real projections in
 * `client/chat-draft.ts` (`itemsDraftText` / `quoteDraftText`), so the matcher
 * is pinned to the format the model actually receives. Rendering runs through
 * `renderToStaticMarkup` in the node environment (no DOM), which is also the
 * SSR path the card has to survive.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { itemsDraftText, quoteDraftText, type QuoteRef } from '../src/client/chat-draft.ts'
import {
  CONTEXT_CARD_CSS,
  ContextCard,
  contextCardTitle,
  matchZoteroContextBlock,
  registerContextCard,
  type CardContext,
  type ContextCardData,
  type ContextCardDeps,
} from '../src/client/context-card.tsx'
import { contextModelText, selectionFromItems, selectionFromQuote } from '../src/client/context-chip.ts'
import { CSS } from '../src/client/styles.ts'

/** One item shaped like the panel's summary wire (only the fields the text needs). */
const item = (key: string, title: string, creatorSummary = 'Smith, J.', year = '2024') =>
  ({ key, title, creatorSummary, year, pdf: { key: `PDF${key.slice(0, 4)}` } }) as const

const FIRST = item('ABCD2345', 'Deep Learning for Schema Matching')
const SECOND = item('BCDE3456', 'Second Paper', 'Doe, A.', '2021')
const THIRD = item('CDEF4567', 'Third Paper', 'Roe, B.', '2019')

/** One quoted passage; pageIndex is 0-based on the wire. */
const quote = (overrides: Partial<QuoteRef> = {}): QuoteRef => ({
  library: 'user',
  itemKey: 'ABCD2345',
  attachmentKey: 'PDFK2345',
  title: 'Deep Learning for Schema Matching',
  pageIndex: 4,
  pageLabel: '5',
  text: 'Passage text.',
  ...overrides,
})

/** Recorded translate calls, so title tests can assert the exact parameters. */
interface TranslateCall {
  readonly key: string
  readonly params: Record<string, string | number> | undefined
}

/** Translate stub that records calls and echoes a readable string. */
function recorder(): { readonly t: (key: string, params?: Record<string, string | number>) => string; readonly calls: TranslateCall[] } {
  const calls: TranslateCall[] = []
  return {
    t: (key, params) => {
      calls.push({ key, params })
      return `${key}:${JSON.stringify(params ?? {})}`
    },
    calls,
  }
}

/** Translate stub with real copy, used by the render tests. */
function table(key: string, params?: Record<string, string | number>): string {
  const count = params?.count ?? 0
  const page = params?.page ?? 0
  if (key === 'chat.card.items') return `${count} 个 Zotero 条目`
  if (key === 'chat.card.quote') return `Zotero 引文 · 第 ${page} 页`
  if (key === 'chat.card.more') return `还有 ${count} 篇`
  return key
}

/**
 * The real host passes `node`, `raw` and the locale-bound `t` together; the
 * exported signature deliberately keeps only `node`, so tests build the
 * runtime prop object explicitly instead of widening that signature.
 */
function cardProps(node: unknown, raw = ''): { readonly node: unknown } {
  return { node, raw, t: table } as unknown as { readonly node: unknown }
}

/** A valid folded payload, with the shape the matcher produces. */
const itemsData = (count: number, library = ''): ContextCardData => ({
  kind: 'items',
  count,
  library,
  keys: [FIRST.key, SECOND.key, THIRD.key].slice(0, count),
  pageIndex: null,
  charCount: 0,
})

describe('matchZoteroContextBlock', () => {
  it('matches a single-item block at the start of the text', () => {
    const text = itemsDraftText([FIRST], 'user')
    const hit = matchZoteroContextBlock(text, 0)
    expect(hit).toBeDefined()
    expect(hit?.start).toBe(0)
    expect(hit?.end).toBe(text.length)
    expect(hit?.data.kind).toBe('items')
    expect(hit?.data.count).toBe(1)
    // An unqualified header means the personal library.
    expect(hit?.data.library).toBe('user')
    expect(hit?.data.keys).toEqual(['ABCD2345'])
    expect(hit?.data.pageIndex).toBeNull()
    expect(hit?.data.charCount).toBe(0)
  })

  it('counts and keys a three-item block', () => {
    const text = itemsDraftText([FIRST, SECOND, THIRD], 'user')
    const hit = matchZoteroContextBlock(text, 0)
    expect(hit?.data.count).toBe(3)
    expect(hit?.data.keys).toEqual(['ABCD2345', 'BCDE3456', 'CDEF4567'])
    expect(hit?.end).toBe(text.length)
  })

  it('keeps the group-library qualifier verbatim', () => {
    const text = itemsDraftText([FIRST, SECOND], 'g54321')
    const hit = matchZoteroContextBlock(text, 0)
    expect(hit?.data.library).toBe('g54321')
    expect(hit?.data.count).toBe(2)
  })

  it('matches a quote without a printed page label', () => {
    const text = quoteDraftText(quote())
    const hit = matchZoteroContextBlock(text, 0)
    expect(hit?.data.kind).toBe('quote')
    expect(hit?.data.count).toBe(1)
    expect(hit?.data.keys).toEqual(['ABCD2345'])
    // page 5 on the wire (1-based) folds to a 0-based index.
    expect(hit?.data.pageIndex).toBe(4)
    // A quote block never spells a library, so the personal one is implied.
    expect(hit?.data.library).toBe('user')
    expect(hit?.data.charCount).toBe('Passage text.'.length)
    expect(hit?.end).toBe(text.length)
  })

  it('matches a multi-line quote with a printed page label and sums its characters', () => {
    const text = quoteDraftText(quote({ pageIndex: 21, pageLabel: 'S22', text: 'alpha\nbeta\ngamma' }))
    const hit = matchZoteroContextBlock(text, 0)
    expect(text).toContain('(printed S22)')
    expect(hit?.data.pageIndex).toBe(21)
    expect(hit?.data.charCount).toBe('alpha'.length + 'beta'.length + 'gamma'.length)
    expect(hit?.end).toBe(text.length)
  })

  it('matches two adjacent blocks separately', () => {
    const first = itemsDraftText([FIRST], 'user')
    const second = quoteDraftText(quote())
    const text = `${first}\n${second}`
    const blockA = matchZoteroContextBlock(text, 0)
    expect(blockA?.start).toBe(0)
    expect(blockA?.end).toBe(first.length)
    const blockB = matchZoteroContextBlock(text, blockA?.end ?? 0)
    expect(blockB?.start).toBe(first.length + 1)
    expect(blockB?.end).toBe(text.length)
    expect(blockB?.data.kind).toBe('quote')
  })

  it('stops before ordinary prose that follows a block', () => {
    const block = itemsDraftText([FIRST, SECOND], 'user')
    const text = `${block}\n\nAnd then the user asked something else.`
    const hit = matchZoteroContextBlock(text, 0)
    expect(hit?.end).toBe(block.length)
    expect(text.slice(hit?.end ?? 0)).toContain('And then the user asked')
    // No second block hides in the prose.
    expect(matchZoteroContextBlock(text, hit?.end ?? 0)).toBeUndefined()
  })

  it('searches forward from an advanced `from` offset', () => {
    const prefix = 'Some question first.'
    const block = itemsDraftText([SECOND], 'user')
    const text = `${prefix}\n${block}`
    const hit = matchZoteroContextBlock(text, prefix.length)
    expect(hit?.start).toBe(prefix.length + 1)
    expect(hit?.data.keys).toEqual(['BCDE3456'])
    // Starting after the block finds nothing.
    expect(matchZoteroContextBlock(text, hit?.end ?? 0)).toBeUndefined()
  })

  it('ignores a header that does not own its line', () => {
    const inline = `prefix The user selected 1 Zotero item in the Zotero panel:\n- [ABCD2345] Inline`
    expect(matchZoteroContextBlock(inline, 0)).toBeUndefined()
  })

  it('returns undefined for unrelated text', () => {
    expect(matchZoteroContextBlock('Nothing about Zotero here.', 0)).toBeUndefined()
    expect(matchZoteroContextBlock('', 0)).toBeUndefined()
    expect(matchZoteroContextBlock('The user selected a PDF passage in the Zotero panel:', 0)).toBeUndefined()
  })

  it('returns undefined for malformed headers and bodies', () => {
    // Missing item count.
    expect(matchZoteroContextBlock('The user selected Zotero items in the Zotero panel:\n- [ABCD2345] X', 0)).toBeUndefined()
    // Header without any reference line.
    expect(matchZoteroContextBlock('The user selected 2 Zotero items in the Zotero panel:', 0)).toBeUndefined()
    // Header trailing junk.
    expect(matchZoteroContextBlock('The user selected 2 Zotero items in the Zotero panel: please', 0)).toBeUndefined()
    // Quote reference line without `, page <n>`.
    expect(matchZoteroContextBlock('The user selected a PDF passage in the Zotero panel:\n- [ABCD2345] Title — PDF PDFK2345\n> hi', 0)).toBeUndefined()
    // Quote without any `> ` line.
    expect(matchZoteroContextBlock('The user selected a PDF passage in the Zotero panel:\n- [ABCD2345] Title — PDF PDFK2345, page 3', 0)).toBeUndefined()
  })

  it('never throws on hostile input', () => {
    const samples = ['- [', 'The user selected ', 'The user selected 1 Zotero item in the Zotero panel:\n- [', '\u0000\n> ', 'The user selected a PDF passage in the Zotero panel:\n- [K], page 0']
    for (const sample of samples) {
      expect(() => matchZoteroContextBlock(sample, 0)).not.toThrow()
      expect(matchZoteroContextBlock(sample, 0)).toBeUndefined()
    }
  })
})

describe('contextCardTitle', () => {
  it('asks for the items title with the count', () => {
    const { t, calls } = recorder()
    expect(contextCardTitle(itemsData(3), t)).toContain('chat.card.items')
    expect(calls).toEqual([{ key: 'chat.card.items', params: { count: 3 } }])
  })

  it('asks for the quote title with the 1-based page', () => {
    const { t, calls } = recorder()
    contextCardTitle({ kind: 'quote', count: 1, library: '', keys: ['ABCD2345'], pageIndex: 21, charCount: 120 }, t)
    expect(calls).toEqual([{ key: 'chat.card.quote', params: { page: 22 } }])
  })
})

describe('ContextCard', () => {
  it('renders the items card as a single bordered line with its title', () => {
    const html = renderToStaticMarkup(React.createElement(ContextCard, cardProps({ data: itemsData(3) })))
    expect(html).toContain('3 个 Zotero 条目')
    expect(html).toContain('dshZotCtxCard')
    expect(html).toContain('dshZotCtxGlyph')
    expect(html).toContain('dshZotCtxTitle')
    // No hover surface without a DOM.
    expect(html).not.toContain('dshZotCtxFloat')
  })

  it('renders the quote card with the localized page', () => {
    const data: ContextCardData = { kind: 'quote', count: 1, library: '', keys: ['ABCD2345'], pageIndex: 21, charCount: 12 }
    const html = renderToStaticMarkup(React.createElement(ContextCard, cardProps({ data })))
    expect(html).toContain('第 22 页')
    expect(html).toContain('dshZotCtxCard')
  })

  it('renders empty instead of throwing when the node carries no usable data', () => {
    expect(() => renderToStaticMarkup(React.createElement(ContextCard, cardProps(undefined)))).not.toThrow()
    const empty = renderToStaticMarkup(React.createElement(ContextCard, cardProps(undefined)))
    expect(empty).toContain('dshZotCtxRaw')
    expect(empty).not.toContain('dshZotCtxCard')
    // Malformed data takes the same path.
    const bogus = renderToStaticMarkup(React.createElement(ContextCard, cardProps({ data: { kind: 'other' } })))
    expect(bogus).toContain('dshZotCtxRaw')
  })

  it('falls back to the original fragment when data is missing', () => {
    const raw = 'The user selected 1 Zotero item in the Zotero panel:\n- [ABCD2345] X'
    const html = renderToStaticMarkup(React.createElement(ContextCard, cardProps({}, raw)))
    expect(html).toContain('The user selected 1 Zotero item in the Zotero panel:')
  })
})

describe('CONTEXT_CARD_CSS', () => {
  it('is the block appended to the shipped stylesheet', () => {
    expect(CONTEXT_CARD_CSS).toContain('.dshZotCtxCard')
    expect(CONTEXT_CARD_CSS).toContain('.dshZotCtxFloat')
    expect(CSS.includes(CONTEXT_CARD_CSS)).toBe(true)
  })
})

describe('registerContextCard', () => {
  const deps: ContextCardDeps = {
    t: table,
    getItem: async (library, key) => ({ title: `Title ${library}/${key}`, creatorSummary: 'Doe, J.', year: '2020' }),
  }

  it('registers the matching rule and the text-node renderer, then wires teardown', () => {
    const rules: Array<{ id: string; order: number; match: (text: string, from: number) => unknown }> = []
    const slots: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const disposeRule = vi.fn()
    const disposeSlot = vi.fn()
    const teardown: Array<() => void> = []
    const ctx: CardContext = {
      uiConversation: {
        userText: {
          register(rule) {
            rules.push(rule as { id: string; order: number; match: (text: string, from: number) => unknown })
            return disposeRule
          },
        },
      },
      slots: {
        inject(_slot, callback) {
          return callback()
        },
        register(options, component) {
          slots.push({ options, component })
          return disposeSlot
        },
      },
      effect(callback) {
        const cleanup = callback()
        teardown.push(typeof cleanup === 'function' ? cleanup : () => {})
        return () => {}
      },
    }

    registerContextCard(ctx, deps)

    expect(rules).toHaveLength(1)
    expect(rules[0]?.id).toBe('zotero-context')
    expect(rules[0]?.order).toBe(10)
    const text = itemsDraftText([FIRST], 'user')
    const candidate = rules[0]?.match(text, 0) as { id: string; start: number; end: number; data: ContextCardData } | undefined
    expect(candidate?.id).toBe('zotero-context')
    expect(candidate?.start).toBe(0)
    expect(candidate?.end).toBe(text.length)
    expect(candidate?.data.keys).toEqual(['ABCD2345'])
    expect(rules[0]?.match('nothing here', 0)).toBeUndefined()

    expect(slots).toHaveLength(1)
    expect(slots[0]?.options).toEqual({ name: 'conversation.user.text.node', key: 'zotero-context', locale: 'zotero' })
    expect(slots[0]?.component).toBe(ContextCard)

    // The registrations are tied to the plugin lifetime.
    for (const cleanup of teardown) cleanup()
    expect(disposeRule).toHaveBeenCalledTimes(1)
    expect(disposeSlot).toHaveBeenCalledTimes(1)
  })

  it('degrades silently when the host seats are missing', () => {
    expect(() => registerContextCard({}, deps)).not.toThrow()
    expect(() => registerContextCard({ slots: {} }, deps)).not.toThrow()
    expect(() => registerContextCard({ uiConversation: {}, slots: { register: () => () => {} } }, deps)).not.toThrow()
    // Missing `effect` keeps the registrations, only the teardown seat is gone.
    const register = vi.fn(() => vi.fn())
    expect(() => registerContextCard({ uiConversation: { userText: { register } } }, deps)).not.toThrow()
    expect(register).toHaveBeenCalledTimes(1)
  })
})

describe('codec output folds exactly like the sent message', () => {
  it('folds one chip block', () => {
    const selection = selectionFromItems([FIRST], 'user')
    const hit = matchZoteroContextBlock(contextModelText(selection), 0)
    expect(hit).toBeDefined()
    expect(hit?.data.kind).toBe('items')
    expect(hit?.data.count).toBe(1)
    expect(hit?.data.keys).toEqual(['ABCD2345'])
  })

  it('folds two chained chips that DSH separated with one space', () => {
    const first = contextModelText(selectionFromItems([FIRST], 'user'))
    const second = contextModelText(
      selectionFromItems([item('BCDE3456', 'Two', '', ''), item('CDEF4567', 'Three', '', '')], 'g42'),
    )
    // Exactly what the composer serializes: chip text, its post-chip space, chip text.
    const text = `${first} ${second}`
    const counts: number[] = []
    let from = 0
    for (;;) {
      const hit = matchZoteroContextBlock(text, from)
      if (hit === undefined) break
      counts.push(hit.data.count)
      from = hit.end + 1
    }
    expect(counts).toEqual([1, 2])
  })

  it('folds a quoted passage brought in through the same codec', () => {
    const selection = selectionFromQuote({
      library: 'user',
      itemKey: 'ABCD2345',
      attachmentKey: 'PDFK2345',
      title: 'Paper',
      pageIndex: 21,
      pageLabel: '22',
      text: 'first line\nsecond line',
    })
    const hit = matchZoteroContextBlock(contextModelText(selection), 0)
    expect(hit?.data.kind).toBe('quote')
    expect(hit?.data.pageIndex).toBe(21)
  })
})
