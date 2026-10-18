/**
 * Cloze markup: {{answer}}, {{answer::hint}}, alternatives with //: {{raised//put up::raise}}.
 * Each {{…}} in a text is one cloze, numbered 1, 2, 3… in reading order.
 */
export type ClozeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'cloze'; n: number; answers: string[]; hint?: string }

const CLOZE_RE = /\{\{(.+?)\}\}/g

export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(CLOZE_RE)) {
    const start = m.index
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) })
    const inner = m[1]!
    const sep = inner.indexOf('::')
    const answerPart = sep >= 0 ? inner.slice(0, sep) : inner
    const hint = sep >= 0 ? inner.slice(sep + 2).trim() : undefined
    const answers = answerPart
      .split('//')
      .map((a) => a.trim())
      .filter(Boolean)
    n++
    segments.push({ kind: 'cloze', n, answers, ...(hint ? { hint } : {}) })
    last = start + m[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

export function clozeCount(text: string): number {
  return parseCloze(text).filter((s) => s.kind === 'cloze').length
}

export function hasCloze(text: string): boolean {
  return clozeCount(text) > 0
}

/** Text with every cloze replaced by its first answer. */
export function clozePlain(text: string): string {
  return parseCloze(text)
    .map((s) => (s.kind === 'text' ? s.text : (s.answers[0] ?? '')))
    .join('')
}

export interface ClozeBlank {
  before: string
  after: string
  answers: string[]
  hint?: string
}

/** Split a cloze text around cloze number n; other clozes are shown filled in. */
export function clozeBlank(text: string, n: number): ClozeBlank | null {
  const segs = parseCloze(text)
  const idx = segs.findIndex((s) => s.kind === 'cloze' && s.n === n)
  if (idx < 0) return null
  const target = segs[idx] as Extract<ClozeSegment, { kind: 'cloze' }>
  const join = (list: ClozeSegment[]) => list.map((s) => (s.kind === 'text' ? s.text : (s.answers[0] ?? ''))).join('')
  return {
    before: join(segs.slice(0, idx)),
    after: join(segs.slice(idx + 1)),
    answers: target.answers,
    ...(target.hint ? { hint: target.hint } : {}),
  }
}
