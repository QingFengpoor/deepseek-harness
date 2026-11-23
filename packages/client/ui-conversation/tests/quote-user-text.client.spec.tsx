/** Quote draft persistence and prompt serialization remain composer-owned. */
import { describe, expect, it, vi } from 'vitest'
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseStoredDraft } from '../src/client/draft.ts'
import { serializeDraftPrompt } from '../src/client/input/prompt.ts'

const noopSerializer = () => Promise.resolve('')

/** Serialize one draft whose only quote is `quote` at `offset` with `before`/`after` text. */
function serializeAround(quote: string, before: string, after: string): string | Promise<string> {
  const quoted = formatQuoteText(quote)
  return serializeDraftPrompt({
    text: before + quoted + after,
    references: [],
    quotes: [{ offset: before.length, length: quoted.length, text: quote }],
  }, noopSerializer)
}

describe('quote draft spans', () => {
  it('validates canonical clipboard text and refuses overlapping references or empty quotes', () => {
    const quote = { offset: 0, length: 7, text: 'quote' }
    const draft = { text: '> quote', references: [], quotes: [quote] }
    expect(parseStoredDraft(draft)).toEqual(draft)
    expect(parseStoredDraft({ ...draft, text: 'changed' })).toBeUndefined()
    expect(parseStoredDraft({ ...draft, quotes: [{ ...quote, text: ' ' }] })).toBeUndefined()
    expect(parseStoredDraft({ ...draft, references: [{ source: 'file', ref: 'quote', label: 'quote', clipboardText: 'quote', offset: 2, length: 5 }] })).toBeUndefined()
    expect(parseStoredDraft({ ...draft, quotes: [quote, quote] })).toBeUndefined()
  })

  it('serializes reference owners outside quotes into ordinary Markdown text', async () => {
    const serialize = vi.fn(() => Promise.resolve('@[Session](dsh-session:id)'))
    const quote = '/review @literal'
    const quoted = formatQuoteText(quote)
    const prompt = await serializeDraftPrompt({
      text: '@session ' + quoted,
      references: [{ source: 'session', ref: 'id', label: 'Session', clipboardText: '@session', offset: 0, length: 8 }],
      quotes: [{ offset: 9, length: quoted.length, text: quote }],
    }, serialize)
    expect(serialize).toHaveBeenCalledExactlyOnceWith('session', 'id')
    expect(prompt).toBe('@[Session](dsh-session:id)\n\n' + quoted)
  })

  it('records an authored line break on either side of a quote as a third newline', async () => {
    expect(await serializeAround('excerpt', 'before\n', '\nanswer')).toBe('before\n\n\n> excerpt\n\n\nanswer')
    expect(await serializeAround('excerpt', 'before\n', ' answer')).toBe('before\n\n\n> excerpt\n\nanswer')
    expect(await serializeAround('excerpt', 'before ', '\nanswer')).toBe('before\n\n> excerpt\n\n\nanswer')
  })

  it('keeps an inline quote on the surrounding text line', async () => {
    expect(await serializeAround('excerpt', 'before ', ' answer')).toBe('before\n\n> excerpt\n\nanswer')
    expect(await serializeAround('excerpt', '', ' answer')).toBe('> excerpt\n\nanswer')
  })

  it('separates adjacent quotes with one paragraph break', async () => {
    const prompt = await serializeDraftPrompt({
      text: '> first > second',
      references: [],
      quotes: [{ offset: 0, length: 7, text: 'first' }, { offset: 8, length: 8, text: 'second' }],
    }, noopSerializer)
    expect(prompt).toBe('> first\n\n> second')
  })
})
