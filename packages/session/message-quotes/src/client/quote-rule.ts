/** Markdown blockquotes produce atomic quote nodes and decoded boundary separators. */
import { messageQuoteRanges, quoteTextOf } from './quote-text.ts'
import type { UserTextNode, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    quote: { readonly text: string }
  }
}

/**
 * The composer's submit serializer isolates a quote with exactly two newlines
 * and records the author's own line break there as a third one (see the
 * serializer's boundary rules). Two newlines therefore only separate the
 * excerpt from the words around it and collapse onto one line; a longer run is
 * the author's break and stays a line break. Hand-typed text never writes the
 * third newline, so its own newlines before or after `> ` lines are untouched.
 */
const INLINE_RUN = 2

/** Count the newline run that ends at `end`, without touching earlier text. */
function runBefore(text: string, end: number): number {
  let start = end
  while (start > 0 && text.charAt(start - 1) === '\n') start--
  return end - start
}

/** Count the newline run that starts at `start`. */
function runAfter(text: string, start: number): number {
  let end = start
  while (end < text.length && text.charAt(end) === '\n') end++
  return end - start
}

/** A boundary separator displayed as one line break or one inline space. */
function separator(text: string, start: number, end: number, display: string): UserTextNode<'text'> {
  return { id: 'text', start, end, data: { text: text.slice(start, end), display } }
}

/** Recognize blockquote lines and show each boundary the way the author drew it. */
export const quoteRule: UserTextRule<'quote'> = {
  id: 'quote',
  order: -10,
  match(text, from) {
    for (const range of messageQuoteRanges(text)) {
      const before = runBefore(text, range.start)
      if (before > 0 && range.start - before >= from) {
        return separator(text, range.start - before, range.start, before === INLINE_RUN ? ' ' : '\n')
      }
      if (range.start >= from) {
        return { id: 'quote', start: range.start, end: range.end, data: { text: quoteTextOf(text.slice(range.start, range.end)) } }
      }
      const after = runAfter(text, range.end)
      if (after > 0 && range.end >= from) {
        return separator(text, range.end, range.end + after, after === INLINE_RUN ? ' ' : '\n')
      }
    }
    return undefined
  },
}
