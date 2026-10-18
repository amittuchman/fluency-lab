import { clozeCount, clozePlain, hasCloze, parseCloze } from './cloze'
import { lcsPairs, tokenize } from './checker'
import { emptyFsrs } from './scheduler'
import type { Card, Note, NoteContent, NoteType } from './types'
import { hashString, newId } from './util'

export interface TemplateSpec {
  template: string
  /** Position in the unlock chain. */
  order: number
  contentHash: string
}

export const TEMPLATE_LABELS: Record<string, string> = {
  recog: 'Recognize',
  'cloze-use': 'Use in context',
  produce: 'Produce the word',
  dictation: 'Dictation',
  'chunk-cloze': 'Complete the chunk',
  'recall-full': 'Recall the sentence',
  speak: 'Speak',
  'which-is-right': 'Which is right?',
  'correct-it': 'Correct it',
  upgrade: 'Say it naturally',
  'natural-cloze': 'Key phrase',
  'tense-choose': 'Choose the tense',
  'tense-fill': 'Fill the tense',
}

export function templateLabel(template: string): string {
  if (template.startsWith('cloze:')) return `Cloze ${template.slice(6)}`
  return TEMPLATE_LABELS[template] ?? template
}

/** Bumped when the template set changes, so existing notes get reconciled on startup. */
export const TEMPLATE_VERSION = 1

const h = (...parts: string[]) => hashString(parts.join('␟'))

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface TermMatch {
  before: string
  match: string
  after: string
}

/**
 * Locate the term (or a simple inflection of it) in an example sentence.
 * Cloze markup in the example wins: "He was {{reluctant}} to commit."
 */
export function findTermInExample(term: string, example: string): TermMatch | null {
  if (hasCloze(example)) {
    const segs = parseCloze(example)
    const idx = segs.findIndex((s) => s.kind === 'cloze')
    const join = (list: typeof segs) => list.map((s) => (s.kind === 'text' ? s.text : (s.answers[0] ?? ''))).join('')
    const target = segs[idx]
    if (target?.kind !== 'cloze') return null
    return { before: join(segs.slice(0, idx)), match: target.answers[0] ?? '', after: join(segs.slice(idx + 1)) }
  }
  const words = term.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  // Simple inflections only: -s/-es/-ed/-ing/-ly/-er/-est, y → ies/ied, e dropped, final consonant doubled.
  const w0 = words[0]!
  const stem = w0.length > 3 ? w0.replace(/(e|y)$/i, '') : w0
  const double = /[^aeiou]$/i.test(stem) ? `(?:${escapeRe(stem.at(-1)!)})?` : ''
  const suffix = '(?:s|es|d|ed|ing|ly|ies|ied|ier|iest|er|est)?'
  const exact = words.map(escapeRe).join('\\s+')
  const inflected = [escapeRe(stem) + double + suffix, ...words.slice(1).map(escapeRe)].join('\\s+')
  for (const pattern of [exact, inflected]) {
    const re = new RegExp(`(^|[^\\p{L}])(${pattern})(?![\\p{L}])`, 'iu')
    const m = re.exec(example)
    if (m) {
      const start = m.index + m[1]!.length
      const end = start + m[2]!.length
      return { before: example.slice(0, start), match: example.slice(start, end), after: example.slice(end) }
    }
  }
  return null
}

export function vocabClozeExample(fields: { term: string; examples: string[] }): { example: string; match: TermMatch } | null {
  for (const example of fields.examples) {
    const match = findTermInExample(fields.term, example)
    if (match) return { example, match }
  }
  return null
}

const STOPWORDS = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being am do does did done have has had ' +
    'will would shall should can could may might must not no it its this that these those i you he she we they me him her us them ' +
    'my your his our their there here what which who whom whose when where why how than then so too very just also about into ' +
    'over under up down out off again once all any each few more most other some such only own same both either neither nor yet ' +
    'while because until although though one get got really quite much many lot'
  ).split(' '),
)

export interface Chunk {
  /** Token index range [start, end) in tokenize(text). */
  start: number
  end: number
  text: string
}

/** Content-word chunks of a sentence (runs of up to 3 consecutive content words). */
export function contentChunks(text: string): Chunk[] {
  const tokens = tokenize(text)
  const isContent = (t: string) => {
    const w = t.toLowerCase().replace(/[^\p{L}'-]/gu, '')
    return w.length >= 3 && !w.includes("'") && !STOPWORDS.has(w)
  }
  const chunks: Chunk[] = []
  let i = 0
  while (i < tokens.length) {
    if (!isContent(tokens[i]!)) {
      i++
      continue
    }
    const start = i
    while (i < tokens.length && i - start < 3 && isContent(tokens[i]!)) i++
    chunks.push({ start, end: i, text: tokens.slice(start, i).join(' ') })
  }
  if (!chunks.length && tokens.length) {
    let best = 0
    tokens.forEach((t, k) => {
      if (t.length > tokens[best]!.length) best = k
    })
    chunks.push({ start: best, end: best + 1, text: tokens[best]! })
  }
  return chunks
}

/**
 * The phrase that makes the natural version natural: the longest run of words that differ from
 * the user's own phrasing. Markup in the natural text wins.
 */
export function naturalKeyPhrase(mine: string, natural: string): Chunk | null {
  if (hasCloze(natural)) return null // handled as cloze markup by the caller
  const a = tokenize(mine).map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''))
  const btok = tokenize(natural)
  const b = btok.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''))
  const common = new Set(lcsPairs(a, b).map(([, j]) => j))
  let best: Chunk | null = null
  let i = 0
  while (i < b.length) {
    if (common.has(i) || !b[i]) {
      i++
      continue
    }
    const start = i
    while (i < b.length && !common.has(i)) i++
    if (!best || i - start > best.end - best.start) best = { start, end: i, text: btok.slice(start, i).join(' ') }
  }
  return best
}

export function templatesFor(content: NoteContent): TemplateSpec[] {
  const chain = (list: Array<[string, string] | null>): TemplateSpec[] =>
    list.filter((x): x is [string, string] => !!x).map(([template, contentHash], order) => ({ template, order, contentHash }))

  switch (content.type) {
    case 'vocab': {
      const f = content.fields
      const ex = vocabClozeExample(f)
      return chain([
        ['recog', h(f.term, f.definition)],
        ex ? ['cloze-use', h(ex.example, f.term)] : null,
        ['produce', h(f.definition, f.term)],
      ])
    }
    case 'sentence': {
      const t = content.fields.text
      return chain([
        ['chunk-cloze', h(t)],
        ['recall-full', h(clozePlain(t))],
      ])
    }
    case 'fix': {
      const f = content.fields
      return chain([
        ['which-is-right', h(f.wrong, f.right)],
        ['correct-it', h(f.wrong, f.right)],
      ])
    }
    case 'natural': {
      const f = content.fields
      const hasKey = hasCloze(f.natural) || !!naturalKeyPhrase(f.mine, f.natural)
      return chain([['upgrade', h(f.mine, clozePlain(f.natural))], hasKey ? ['natural-cloze', h(f.mine, f.natural)] : null])
    }
    case 'tense': {
      const s = content.fields.sentence
      return chain([
        ['tense-choose', h(s, content.fields.tense)],
        ['tense-fill', h(s, content.fields.tense)],
      ])
    }
    case 'cloze': {
      const t = content.fields.text
      const n = clozeCount(t)
      return Array.from({ length: n }, (_, i) => ({ template: `cloze:${i + 1}`, order: 0, contentHash: h(t, String(i + 1)) }))
    }
  }
}

/** Templates that need audio (Phase 4) are added here later; none yet. */
export function isAudioTemplate(template: string): boolean {
  return template === 'dictation' || template === 'speak'
}

/** Self-graded templates cannot be auto-checked (excluded from quizzes). */
export function isSelfGraded(template: string): boolean {
  return template === 'recog'
}

export function newCard(noteId: string, spec: TemplateSpec, now: number): Card {
  return {
    id: newId(),
    noteId,
    template: spec.template,
    order: spec.order,
    fsrs: emptyFsrs(now),
    suspended: false,
    buriedUntil: null,
    leech: false,
    unlocked: spec.order === 0,
    contentHash: spec.contentHash,
    priority: false,
    createdAt: now,
  }
}

/** Threshold (stability in days) the card at chain position `order - 1` needs to unlock `order`. */
export function unlockThreshold(order: number, thresholds: readonly number[]): number {
  return thresholds[Math.min(order - 1, thresholds.length - 1)] ?? Infinity
}

/** Ids of locked cards whose predecessor in the chain is now stable enough. */
export function cardsToUnlock(siblings: Card[], thresholds: readonly number[]): string[] {
  const byOrder = new Map(siblings.map((c) => [c.order, c]))
  const out: string[] = []
  for (const c of siblings) {
    if (c.unlocked || c.order === 0) continue
    const prev = byOrder.get(c.order - 1)
    if (prev && prev.unlocked && prev.fsrs.stability >= unlockThreshold(c.order, thresholds)) out.push(c.id)
  }
  return out
}

export interface Reconciled {
  add: Card[]
  update: Card[]
  remove: string[]
}

/**
 * Bring a note's cards in line with its current content. Cards whose content hash changed are reset
 * to new; unchanged cards keep their scheduling. Templates that no longer apply are removed.
 */
export function reconcileCards(note: Pick<Note, 'id'> & NoteContent, existing: Card[], now: number, thresholds: readonly number[]): Reconciled {
  const specs = templatesFor(note)
  const byTemplate = new Map(existing.map((c) => [c.template, c]))
  const add: Card[] = []
  const update: Card[] = []
  const result: Card[] = []
  for (const spec of specs) {
    const cur = byTemplate.get(spec.template)
    if (!cur) {
      const c = newCard(note.id, spec, now)
      add.push(c)
      result.push(c)
      continue
    }
    if (cur.contentHash !== spec.contentHash || cur.order !== spec.order) {
      const changed = cur.contentHash !== spec.contentHash
      const next: Card = {
        ...cur,
        order: spec.order,
        contentHash: spec.contentHash,
        ...(changed ? { fsrs: emptyFsrs(now), leech: false } : {}),
        unlocked: cur.unlocked || spec.order === 0,
      }
      update.push(next)
      result.push(next)
    } else result.push(cur)
  }
  const keep = new Set(specs.map((s) => s.template))
  const remove = existing.filter((c) => !keep.has(c.template)).map((c) => c.id)

  for (const id of cardsToUnlock(result, thresholds)) {
    const i = result.findIndex((x) => x.id === id)
    const c: Card = { ...result[i]!, unlocked: true }
    result[i] = c
    const ai = add.findIndex((x) => x.id === id)
    const ui = update.findIndex((x) => x.id === id)
    if (ai >= 0) add[ai] = c
    else if (ui >= 0) update[ui] = c
    else update.push(c)
  }
  return { add, update, remove }
}

export function typeLabel(t: NoteType): string {
  return { vocab: 'Vocab', sentence: 'Sentence', fix: 'Fix', natural: 'Natural', tense: 'Tense', cloze: 'Cloze' }[t]
}
