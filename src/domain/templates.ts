import { clozePlain, hasCloze, parseCloze } from './cloze'
import { lcsPairs, tokenize } from './checker'
import { emptyFsrs } from './scheduler'
import type { Card, Note, NoteContent, NoteType } from './types'
import { hashString } from './util'

export interface TemplateSpec {
  template: string
  /** Position in the unlock chain. */
  order: number
  contentHash: string
}

/** Old per-exercise card names (cards from before v3), for history views. */
export function templateLabel(template: string): string {
  if (template === ITEM_TEMPLATE) return 'Item'
  if (template.startsWith('cloze:')) return `Old cloze ${template.slice(6)}`
  return `Old card: ${template}`
}

/** Bumped when the template set changes, so existing notes get reconciled on startup. */
export const TEMPLATE_VERSION = 3 // 3: one card per item with levels (old per-exercise cards kept, unused)

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
    // A plain letter class instead of \p{L}: Unicode-property regexes are slow to compile, and this one is
    // built per term (it dominated the time of a 5,000-line import).
    const re = new RegExp(`(^|[^A-Za-z\\u00C0-\\u024F])(${pattern})(?![A-Za-z\\u00C0-\\u024F])`, 'i')
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

/**
 * One card per item. The card carries the item's FSRS schedule and its level; the exercise shown is chosen
 * from the level each time (./exercises). Before v3 every item had several cards (one per exercise form,
 * unlocked in a chain); those old cards are kept untouched for history and are simply no longer used.
 */
export const ITEM_TEMPLATE = 'item'

export function isActiveCard(card: Pick<Card, 'template'>): boolean {
  return card.template === ITEM_TEMPLATE
}

/** What an item asks; when it changes on edit, the item's schedule and level restart. */
function itemHash(content: NoteContent): string {
  switch (content.type) {
    case 'vocab':
      return h(content.fields.term, content.fields.definition)
    case 'sentence':
      return h(clozePlain(content.fields.text))
    case 'fix':
      return h(content.fields.wrong, content.fields.right)
    case 'natural':
      return h(content.fields.mine, clozePlain(content.fields.natural))
    case 'tense':
      return h(content.fields.sentence, content.fields.tense)
    case 'cloze':
      return h(content.fields.text)
  }
}

export function templatesFor(content: NoteContent): TemplateSpec[] {
  return [{ template: ITEM_TEMPLATE, order: 0, contentHash: itemHash(content) }]
}

export function newCard(noteId: string, spec: TemplateSpec, now: number): Card {
  return {
    // Deterministic: two devices that create the same note's card independently produce the same id.
    id: `${noteId}:${spec.template}`,
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
    level: 1,
    cleanStreak: 0,
    missStreak: 0,
  }
}

/**
 * The item card for a note that so far had the old per-exercise cards: it inherits the schedule of the
 * best-learned old card (highest stability), and a starting level from how many forms were already practised
 * (at most L3). Nothing is taken from or written to the old cards.
 */
export function seedItemCard(noteId: string, spec: TemplateSpec, old: Card[], now: number): Card {
  const card = newCard(noteId, spec, now)
  if (!old.length) return card
  const suspended = old.every((c) => c.suspended)
  const priority = old.some((c) => c.priority)
  const reviewed = old.filter((c) => c.fsrs.state !== 0)
  if (!reviewed.length) return { ...card, suspended, priority }
  const best = [...reviewed].sort((a, b) => b.fsrs.stability - a.fsrs.stability || (b.fsrs.lastReview ?? 0) - (a.fsrs.lastReview ?? 0))[0]!
  const level = Math.min(3, Math.max(1, new Set(reviewed.map((c) => c.template)).size)) as Card['level']
  return { ...card, fsrs: { ...best.fsrs }, level, leech: best.leech, suspended, priority }
}

/** Kept for the scheduler: with one card per item nothing is chained any more. */
export function cardsToUnlock(siblings: Card[], thresholds: readonly number[]): string[] {
  const byOrder = new Map(siblings.map((c) => [c.order, c]))
  const out: string[] = []
  for (const c of siblings) {
    if (c.unlocked || c.order === 0) continue
    const prev = byOrder.get(c.order - 1)
    if (prev && prev.unlocked && prev.fsrs.stability >= (thresholds[Math.min(c.order - 1, thresholds.length - 1)] ?? Infinity)) out.push(c.id)
  }
  return out
}

export interface Reconciled {
  add: Card[]
  update: Card[]
}

/**
 * Make sure a note has its item card. When the note's content changed, the item restarts (new schedule,
 * level 1); edits that don't change what is asked (tags, Hebrew, rule…) keep everything. Old per-exercise
 * cards are never removed.
 */
export function reconcileCards(note: Pick<Note, 'id'> & NoteContent, existing: Card[], now: number): Reconciled {
  const spec = templatesFor(note)[0]!
  const cur = existing.find((c) => c.template === ITEM_TEMPLATE)
  if (!cur) return { add: [seedItemCard(note.id, spec, existing.filter((c) => !isActiveCard(c)), now)], update: [] }
  if (cur.contentHash === spec.contentHash) return { add: [], update: [] }
  return {
    add: [],
    update: [{ ...cur, contentHash: spec.contentHash, fsrs: emptyFsrs(now), leech: false, resetAt: now, level: 1, cleanStreak: 0, missStreak: 0 }],
  }
}

export function typeLabel(t: NoteType): string {
  return { vocab: 'Vocab', sentence: 'Sentence', fix: 'Fix', natural: 'Natural', tense: 'Tense', cloze: 'Cloze' }[t]
}
