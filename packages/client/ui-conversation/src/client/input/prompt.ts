/** Serialize semantic draft spans without turning quoted references into gestures. */
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DraftSnapshot } from '../contract/draft-editor.ts'

type DraftToken = { readonly kind: 'text'; text: string } | { readonly kind: 'quote'; readonly text: string }
interface DraftSpan {
  readonly offset: number
  readonly length: number
  readonly token: DraftToken
}

/**
 * The submitted text must stay valid Markdown, yet the transcript also has to
 * reproduce the layout the composer showed: a quote spliced inline with the
 * sentence around it reads differently from a quote the author put on its own
 * line. Markdown cannot spell that difference out, so a quote boundary records
 * the author's own break as a third newline:
 *
 * - `text\n\n> excerpt` — the composer spliced the quote onto the text line.
 * - `text\n\n\n> excerpt` — the author broke the line before the quote.
 * - `> excerpt\n\nanswer` — the answer continues on the excerpt's own line.
 * - `> excerpt\n\n\nanswer` — the author broke the line after the quote.
 *
 * The blank line is required in both cases: one newline only would let a
 * block quote interrupt the paragraph, and a single newline after the quote
 * would make the answer a lazy continuation line OF the quote block. Typed
 * prose never produces the third newline, so hand-written block quotes keep
 * their meaning (`> ` lines stay block quotes; see the transcript rule).
 */
const INLINE_BOUNDARY = '\n\n'
const AUTHOR_BOUNDARY = '\n\n\n'

const TRAILING_SPACES = /[ \t]+$/u
const LEADING_SPACES = /^[ \t]+/u
const TRAILING_BREAKS = /\n+$/u
const LEADING_BREAKS = /^\n+/u
const ONLY_BREAKS = /^\n+$/u

function pushText(tokens: DraftToken[], text: string): void {
  if (text === '') return
  const last = tokens.at(-1)
  if (last?.kind === 'text') last.text += text
  else tokens.push({ kind: 'text', text })
}

function normalizeQuoteBoundaries(tokens: DraftToken[]): DraftToken[] {
  const normalized: DraftToken[] = []
  for (const token of tokens) {
    const previous = normalized.at(-1)
    if (token.kind === 'text') {
      if (previous?.kind === 'quote') {
        // Text after a quote is a fresh token, so the author's own leading line
        // breaks decide whether the answer sits beside the excerpt or below it.
        // An empty remainder records nothing: the separator only exists to
        // introduce text, and adjacent quotes get their own boundary below.
        const body = token.text.replace(LEADING_SPACES, '')
        const broke = body.startsWith('\n')
        const rest = body.replace(LEADING_BREAKS, '')
        if (rest !== '') pushText(normalized, `${broke ? AUTHOR_BOUNDARY : INLINE_BOUNDARY}${rest}`)
        else if (broke) pushText(normalized, AUTHOR_BOUNDARY)
      } else {
        pushText(normalized, token.text)
      }
      continue
    }
    if (previous?.kind === 'text' && !ONLY_BREAKS.test(previous.text)) {
      // A pure-newline token is a boundary this pass already computed for the
      // preceding quote; the author's own text is the case to normalize here.
      const trimmed = previous.text.replace(TRAILING_SPACES, '')
      previous.text = trimmed.endsWith('\n')
        ? `${trimmed.replace(TRAILING_BREAKS, '')}${AUTHOR_BOUNDARY}`
        : `${trimmed}${INLINE_BOUNDARY}`
    } else if (previous?.kind === 'quote') {
      // No author text between two quotes: keep them as separate blockquotes
      // and let the transcript show the two chips on one line.
      normalized.push({ kind: 'text', text: INLINE_BOUNDARY })
    }
    normalized.push(token)
  }
  return normalized.filter(token => token.kind === 'quote' || token.text !== '')
}

/**
 * Serialize the captured draft through reference codecs, formatting quotes as Markdown.
 * @param draft - one semantic draft revision.
 * @param serializeReference - owner-routed reference serializer.
 * @returns synchronous content without references, otherwise the resolving promise.
 */
export function serializeDraftPrompt(
  draft: DraftSnapshot,
  serializeReference: (source: string, ref: string) => Promise<string>,
): string | Promise<string> {
  const build = (references: readonly DraftSpan[]): string => {
    const spans = [
      ...references,
      ...(draft.quotes ?? []).map(quote => ({ offset: quote.offset, length: quote.length,
        token: { kind: 'quote' as const, text: quote.text } })),
    ].sort((a, b) => a.offset - b.offset)
    const tokens: DraftToken[] = []
    let cursor = 0
    for (const span of spans) {
      pushText(tokens, draft.text.slice(cursor, span.offset))
      if (span.token.kind === 'text') pushText(tokens, span.token.text)
      else tokens.push(span.token)
      cursor = span.offset + span.length
    }
    pushText(tokens, draft.text.slice(cursor))
    const first = tokens[0]
    if (first?.kind === 'text') first.text = first.text.trimStart()
    const last = tokens.at(-1)
    if (last?.kind === 'text') last.text = last.text.trimEnd()
    return normalizeQuoteBoundaries(tokens)
      .map(token => token.kind === 'quote' ? formatQuoteText(token.text) : token.text).join('')
  }
  if (draft.references.length === 0) return build([])
  return Promise.all(draft.references.map(async reference => ({
    offset: reference.offset, length: reference.length,
    token: { kind: 'text' as const, text: await serializeReference(reference.source, reference.ref) },
  }))).then(build)
}
