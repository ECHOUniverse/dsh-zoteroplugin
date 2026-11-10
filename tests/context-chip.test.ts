/**
 * `src/client/context-chip.ts` tests: the chip ref codec, the model-text
 * projections (byte-identical to `chat-draft.ts`), the i18n label parameters
 * and the 8k quote limit — ADR 0004, "reference chip for Zotero context".
 */
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_CHIP_APPEARANCE,
  CONTEXT_CHIP_SOURCE,
  MAX_QUOTE_CHARS,
  contextChipLabel,
  contextModelText,
  contextPayloadText,
  decodeContextRef,
  encodeContextRef,
  quoteSelectionFitsLimit,
  selectionFromItems,
  selectionFromQuote,
} from '../src/client/context-chip.ts'
import { itemsDraftText, quoteDraftText } from '../src/client/chat-draft.ts'
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
  pdf: null,
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

/** Fake translator: echoes the key and the params as JSON (ADR 0004 keys). */
const fakeT = (key: string, params?: Record<string, string | number>): string => key + JSON.stringify(params ?? {})

describe('selection construction', () => {
  it('selectionFromItems keeps the ref fields, the PDF key and the library', () => {
    const selection = selectionFromItems([summary({ pdf: { key: 'PDFK2345' } })], 'user')
    expect(selection).toEqual({
      kind: 'items',
      library: 'user',
      items: [
        {
          key: 'ABCD2345',
          title: 'Deep Learning for Schema Matching',
          creatorSummary: 'Smith, J.; Wang, L.',
          year: '2024',
          pdfKey: 'PDFK2345',
        },
      ],
    })
  })

  it('selectionFromQuote carries item, attachment, page and text', () => {
    expect(selectionFromQuote(quote({ pageLabel: 'xii' }))).toEqual({
      kind: 'quote',
      library: 'user',
      itemKey: 'ABCD2345',
      attachmentKey: 'PDFK2345',
      title: 'Deep Learning for Schema Matching',
      pageIndex: 4,
      pageLabel: 'xii',
      text: 'first line\nsecond line',
    })
  })

  it('exposes the ADR 0004 source/appearance constants', () => {
    expect(CONTEXT_CHIP_SOURCE).toBe('zotero')
    expect(CONTEXT_CHIP_APPEARANCE).toBe('file')
    expect(MAX_QUOTE_CHARS).toBe(8000)
  })
})

describe('contextPayloadText (identical to the chat-draft projections)', () => {
  it('items: one item in the user library equals itemsDraftText', () => {
    const selection = selectionFromItems([summary()], 'user')
    expect(contextPayloadText(selection)).toBe(itemsDraftText([summary()], 'user'))
  })

  it('items: several items in a group library equal itemsDraftText', () => {
    const items = [summary(), summary({ key: 'BCDE3456', title: 'Second', creatorSummary: '', year: '' })]
    const selection = selectionFromItems(items, 'g42')
    expect(contextPayloadText(selection)).toBe(itemsDraftText(items, 'g42'))
    expect(contextPayloadText(selection)).toContain('The user selected 2 Zotero items in library g42 in the Zotero panel:')
    expect(contextPayloadText(selection)).toContain('- [BCDE3456] Second')
  })

  it('items: a PDF attachment key survives into the projection', () => {
    // The `· PDF <key>` marker is the model's only handle for read_fulltext /
    // find_in_pdf / cite, so the ref must carry pdfKey and the projection must
    // stay byte-identical to itemsDraftText of the original item.
    const withPdf = summary({ pdf: { key: 'PDFK2345' } })
    const selection = selectionFromItems([withPdf], 'user')
    expect(contextPayloadText(selection)).toBe(itemsDraftText([withPdf], 'user'))
    expect(contextPayloadText(selection)).toContain('· PDF PDFK2345')
  })

  it('items: an item without a PDF attachment still projects without the marker', () => {
    const plain = summary({ pdf: null })
    const selection = selectionFromItems([plain], 'g9')
    expect(contextPayloadText(selection)).toBe(itemsDraftText([plain], 'g9'))
    expect(contextPayloadText(selection)).not.toContain('· PDF')
  })

  it('quote: physical page label equals quoteDraftText', () => {
    const q = quote()
    expect(contextPayloadText(selectionFromQuote(q))).toBe(quoteDraftText(q))
  })

  it('quote: printed page label branch equals quoteDraftText', () => {
    const q = quote({ pageIndex: 11, pageLabel: 'xii' })
    const text = contextPayloadText(selectionFromQuote(q))
    expect(text).toBe(quoteDraftText(q))
    expect(text).toContain('page 12 (printed xii)')
  })

  it('quote: multi-line passage equals quoteDraftText with one "> " per line', () => {
    const q = quote({ text: 'alpha\nbeta\n\ngamma' })
    const text = contextPayloadText(selectionFromQuote(q))
    expect(text).toBe(quoteDraftText(q))
    expect(text).toContain('> alpha\n> beta\n> \n> gamma')
  })
})

describe('contextModelText (paragraph wrapping)', () => {
  it('wraps the payload in single newlines and keeps the payload intact', () => {
    const selection = selectionFromItems([summary()], 'user')
    const payload = contextPayloadText(selection)
    expect(contextModelText(selection)).toBe(`\n${payload}\n`)
    expect(contextModelText(selection).trim()).toBe(payload)
  })

  it('keeps two chained chips on their own line starts', () => {
    // DSH inserts one space between two adjacent chips; the wrapped form must
    // still leave each block starting at a line boundary.
    const first = contextModelText(selectionFromItems([summary()], 'user'))
    const second = contextModelText(selectionFromItems([summary({ key: 'BCDE3456' })], 'user'))
    expect(`${first} ${second}`.split('\n').filter((line) => line.includes('The user selected'))).toHaveLength(2)
  })

  it('wraps a quoted passage without touching its blockquote lines', () => {
    const selection = selectionFromQuote(quote({ text: 'alpha\nbeta' }))
    const wrapped = contextModelText(selection)
    expect(wrapped.startsWith('\nThe user selected a PDF passage')).toBe(true)
    expect(wrapped.endsWith('\n')).toBe(true)
    expect(wrapped).toContain('> alpha\n> beta')
  })
})

describe('encodeContextRef / decodeContextRef', () => {
  it('items: round-trips Chinese titles and empty creator/year', () => {
    const selection = selectionFromItems(
      [
        summary({ key: 'CN123456', title: '深度学习与模式匹配', creatorSummary: '', year: '' }),
        summary({ key: 'CN654321', title: '另一个中文标题', creatorSummary: '张三', year: '2023' }),
      ],
      'g7',
    )
    expect(decodeContextRef(encodeContextRef(selection))).toEqual(selection)
  })

  it('items: round-trips the PDF attachment key in both directions', () => {
    const withPdf = selectionFromItems([summary({ pdf: { key: 'PDFK2345' } })], 'user')
    const withoutPdf = selectionFromItems([summary({ key: 'NOPDF123', pdf: null })], 'user')
    expect(decodeContextRef(encodeContextRef(withPdf))).toEqual(withPdf)
    expect(decodeContextRef(encodeContextRef(withoutPdf))).toEqual(withoutPdf)
  })

  it('quote: round-trips newlines, Chinese text and consecutive "> " lines', () => {
    const selection = selectionFromQuote(
      quote({ text: '第一行\n> 引用的引用\n> > 更深一层\n\nnormal line\n> trailing' }),
    )
    expect(decodeContextRef(encodeContextRef(selection))).toEqual(selection)
  })

  it('emits unpadded base64url only', () => {
    const ref = encodeContextRef(selectionFromQuote(quote({ text: '中文 + / = 特殊字符' })))
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(ref).not.toContain('=')
    expect(ref).not.toContain('+')
    expect(ref).not.toContain('/')
  })
})

describe('decodeContextRef fault tolerance', () => {
  it('returns null for an empty or non-string ref', () => {
    expect(decodeContextRef('')).toBeNull()
    expect(decodeContextRef(123 as unknown as string)).toBeNull()
    expect(decodeContextRef(undefined as unknown as string)).toBeNull()
  })

  it('returns null for invalid base64 and invalid JSON', () => {
    expect(decodeContextRef('not-base64!!')).toBeNull()
    expect(decodeContextRef(btoa('this is not json'))).toBeNull()
  })

  it('returns null for a valid base64 payload with an unknown kind', () => {
    expect(decodeContextRef(btoa('{"kind":"x"}'))).toBeNull()
    expect(decodeContextRef(btoa('{"kind":"items"}'))).toBeNull()
    expect(decodeContextRef(btoa('{"kind":"quote"}'))).toBeNull()
  })

  it('returns null when item fields are missing or mistyped', () => {
    expect(decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user' })))).toBeNull()
    expect(decodeContextRef(btoa(JSON.stringify({ kind: 'items', items: [] })))).toBeNull()
    expect(decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 42, items: [] })))).toBeNull()
    const completeItem = { key: 'A', title: 'T', creatorSummary: '', year: '', pdfKey: null }
    expect(
      decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: [completeItem] }))),
    ).not.toBeNull()
    expect(
      decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: [{ ...completeItem, pdfKey: 'PDFK2345' }] }))),
    ).not.toBeNull()
    // `pdfKey` is part of the ref contract: absent, or of another type, is
    // malformed rather than a silently dropped field.
    expect(
      decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: [{ key: 'A', title: 'T', creatorSummary: '', year: '' }] }))),
    ).toBeNull()
    expect(
      decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: [{ ...completeItem, pdfKey: 42 }] }))),
    ).toBeNull()
    expect(
      decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: [{ ...completeItem, pdfKey: { key: 'X' } }] }))),
    ).toBeNull()
    expect(
      decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: [{ ...completeItem, year: 2024 }] }))),
    ).toBeNull()
    expect(decodeContextRef(btoa(JSON.stringify({ kind: 'items', library: 'user', items: ['nope'] })))).toBeNull()
  })

  it('returns null when quote fields are missing or mistyped', () => {
    expect(decodeContextRef(btoa(JSON.stringify({ kind: 'quote', library: 'user' })))).toBeNull()
    const complete = {
      kind: 'quote',
      library: 'user',
      itemKey: 'ABCD2345',
      attachmentKey: 'PDFK2345',
      title: 'T',
      pageIndex: 4,
      pageLabel: '5',
      text: 'body',
    }
    expect(decodeContextRef(btoa(JSON.stringify(complete)))).toEqual(complete)
    expect(decodeContextRef(btoa(JSON.stringify({ ...complete, pageIndex: '4' })))).toBeNull()
    expect(decodeContextRef(btoa(JSON.stringify({ ...complete, text: undefined })))).toBeNull()
    expect(decodeContextRef(btoa(JSON.stringify({ ...complete, itemKey: null })))).toBeNull()
  })
})

describe('contextChipLabel', () => {
  it('items: passes the count for one and several items', () => {
    expect(contextChipLabel(selectionFromItems([summary()], 'user'), fakeT)).toBe('chat.chip.items{"count":1}')
    expect(
      contextChipLabel(
        selectionFromItems([summary(), summary({ key: 'B' }), summary({ key: 'C' })], 'user'),
        fakeT,
      ),
    ).toBe('chat.chip.items{"count":3}')
  })

  it('quote: passes the 1-based page number', () => {
    expect(contextChipLabel(selectionFromQuote(quote({ pageIndex: 4 })), fakeT)).toBe('chat.chip.quote{"page":5}')
    expect(contextChipLabel(selectionFromQuote(quote({ pageIndex: 0, pageLabel: 'i' })), fakeT)).toBe('chat.chip.quote{"page":1}')
  })
})

describe('quoteSelectionFitsLimit', () => {
  it('accepts every item selection', () => {
    expect(quoteSelectionFitsLimit(selectionFromItems([], 'user'))).toBe(true)
    expect(quoteSelectionFitsLimit(selectionFromItems([summary()], 'user'))).toBe(true)
  })

  it('accepts 8000 characters and refuses 8001', () => {
    expect(quoteSelectionFitsLimit(selectionFromQuote(quote({ text: 'x'.repeat(8000) })))).toBe(true)
    expect(quoteSelectionFitsLimit(selectionFromQuote(quote({ text: 'x'.repeat(8001) })))).toBe(false)
    expect(quoteSelectionFitsLimit(selectionFromQuote(quote({ text: '' })))).toBe(true)
  })
})
