/** Markdown blockquotes produce atomic quote nodes and inline separator replacements. */
import { messageQuoteRanges, quoteTextOf } from './quote-text.ts'
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    quote: { readonly text: string }
  }
}

/** Recognize blockquote lines, keep the author's paragraph break before one, and inline the break after it. */
export const quoteRule: UserTextRule<'quote'> = {
  id: 'quote',
  order: -10,
  match(text, from) {
    for (const range of messageQuoteRanges(text)) {
      for (const start of [range.start - 2, range.start, range.end]) {
        if (start < from) continue
        if (start === range.start) {
          return { id: 'quote', start, end: range.end, data: { text: quoteTextOf(text.slice(start, range.end)) } }
        }
        if (text.slice(start, start + 2) === '\n\n') {
          // A quote is its own composer paragraph. The break before it is the
          // author's paragraph boundary and stays a line break; the break after
          // it only isolates the excerpt from the answer written beside the
          // quote chip, so it collapses onto the quote's line.
          return { id: 'text', start, end: start + 2, data: { text: '\n\n', display: start < range.start ? '\n' : ' ' } }
        }
      }
    }
    return undefined
  },
}
