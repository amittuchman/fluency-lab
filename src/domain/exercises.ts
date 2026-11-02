import { compareWords, correctionWords, lcsPairs, normalizeAnswer, tokenize } from './checker'
import { gapFragment, sentenceDistractors } from './distractors'
import { clozeBlank, clozeCount, clozePlain, hasCloze } from './cloze'
import { tenseChoice } from './conjugator'
import { isLongBreak, levelOf, patternKey } from './levels'
import { firstLetters, blankChunk, type Context, type Prompt, type PromptOptions, type Reveal } from './prompt'
import { naturalKeyPhrase } from './templates'
import type { Card, Level, Note, NoteType } from './types'
import { groupBy, seededRandom, shuffle, uniq } from './util'

/**
 * Exercises per item type and level. Every exercise is built from the item itself (the actual mistake, its
 * correction, its rule), never from a randomly chosen word:
 *   L1 recognize · L2 guided production · L3 free production / transformation · L4 spot the error / mixed
 *   L5 produce from Hebrew or a situation, without support
 * When the data for an exercise is missing (e.g. no Hebrew), the nearest available level is used instead.
 */
export type ExerciseId =
  | 'vocab-flash'
  | 'vocab-choose'
  | 'vocab-produce'
  | 'vocab-use'
  | 'vocab-from-he'
  | 'fix-choose'
  | 'fix-spot'
  | 'fix-correct'
  | 'fix-transfer'
  | 'fix-mixed'
  | 'fix-produce'
  | 'tense-choose'
  | 'tense-fill'
  | 'tense-rewrite'
  | 'tense-transfer'
  | 'tense-spot'
  | 'tense-produce'
  | 'natural-choose'
  | 'natural-key'
  | 'natural-upgrade'
  | 'natural-spot'
  | 'natural-produce'
  | 'sentence-meaning'
  | 'sentence-guided'
  | 'sentence-translate'
  | 'sentence-speak'
  | 'sentence-produce'
  | 'cloze-choose'
  | 'cloze-hint'
  | 'cloze-recall'
  | 'cloze-produce'

/** Candidates per level (index 0 = L1). Several candidates at one level take turns. */
export const LADDER: Record<NoteType, ExerciseId[][]> = {
  vocab: [['vocab-flash'], ['vocab-choose'], ['vocab-produce'], ['vocab-use'], ['vocab-from-he', 'vocab-produce']],
  fix: [['fix-choose'], ['fix-spot'], ['fix-correct'], ['fix-transfer', 'fix-mixed'], ['fix-produce']],
  tense: [['tense-choose'], ['tense-fill'], ['tense-rewrite'], ['tense-transfer', 'tense-spot'], ['tense-produce']],
  natural: [['natural-choose'], ['natural-key'], ['natural-upgrade'], ['natural-spot'], ['natural-produce']],
  sentence: [['sentence-meaning'], ['sentence-guided'], ['sentence-translate'], ['sentence-speak', 'sentence-translate'], ['sentence-produce']],
  cloze: [['cloze-choose'], ['cloze-hint'], ['cloze-recall'], ['cloze-recall'], ['cloze-produce']],
}

/** After a long break the first exercise is a recall: produce the answer, no options, no blank on a hint. */
export const RECALL: Record<NoteType, ExerciseId[]> = {
  vocab: ['vocab-produce'],
  fix: ['fix-correct'],
  tense: ['tense-fill'],
  natural: ['natural-upgrade'],
  sentence: ['sentence-translate', 'sentence-guided'],
  cloze: ['cloze-recall'],
}

export const EXERCISE_LABELS: Record<ExerciseId, string> = {
  'vocab-flash': 'Flashcard',
  'vocab-choose': 'Choose the word',
  'vocab-produce': 'Produce the word',
  'vocab-use': 'Use it in a sentence',
  'vocab-from-he': 'From Hebrew',
  'fix-choose': 'Which is correct?',
  'fix-spot': 'Spot the error',
  'fix-correct': 'Correct it',
  'fix-transfer': 'Same rule, new sentence',
  'fix-mixed': 'Find the mistake',
  'fix-produce': 'Say it right',
  'tense-choose': 'Choose the form',
  'tense-fill': 'Fill the verb',
  'tense-rewrite': 'Fix the tense',
  'tense-transfer': 'Same rule, new sentence',
  'tense-spot': 'Find the tense mistake',
  'tense-produce': 'Say it right',
  'natural-choose': 'More natural?',
  'natural-key': 'Key phrase',
  'natural-upgrade': 'Say it naturally',
  'natural-spot': 'Spot the unnatural one',
  'natural-produce': 'Say it naturally',
  'sentence-meaning': 'What does it mean?',
  'sentence-guided': 'Guided recall',
  'sentence-translate': 'Say it in English',
  'sentence-speak': 'Say it aloud',
  'sentence-produce': 'Say it in context',
  'cloze-choose': 'Choose',
  'cloze-hint': 'Fill the gap',
  'cloze-recall': 'Fill the gap',
  'cloze-produce': 'Say it in English',
}

/** Exercises with no automatic answer check (flashcards, own sentences, speaking) are left out of quizzes. */
export const QUIZ_FORMAT: Partial<Record<ExerciseId, 'choice' | 'cloze' | 'production'>> = {
  'vocab-choose': 'choice',
  'fix-choose': 'choice',
  'fix-spot': 'choice',
  'fix-mixed': 'choice',
  'tense-choose': 'choice',
  'tense-spot': 'choice',
  'natural-choose': 'choice',
  'natural-spot': 'choice',
  'cloze-choose': 'choice',
  'tense-fill': 'cloze',
  'tense-transfer': 'cloze',
  'natural-key': 'cloze',
  'cloze-hint': 'cloze',
  'cloze-recall': 'cloze',
  'vocab-produce': 'production',
  'vocab-from-he': 'production',
  'fix-correct': 'production',
  'fix-transfer': 'production',
  'fix-produce': 'production',
  'tense-rewrite': 'production',
  'tense-produce': 'production',
  'natural-upgrade': 'production',
  'natural-produce': 'production',
  'sentence-guided': 'production',
  'sentence-translate': 'production',
  'sentence-produce': 'production',
  'cloze-produce': 'production',
}

// ---------------- options of one kind ----------------

/** The question stem of a sentence choice: the item's situation (with its Hebrew under it), or the Hebrew. */
function stem(f: { prompt?: string; he?: string }): { prompt?: string; promptIsHebrew?: boolean; promptHe?: string } {
  if (f.prompt) return { prompt: f.prompt, ...opt('promptHe', f.he) }
  if (f.he) return { prompt: f.he, promptIsHebrew: true }
  return {}
}

/** `dist:` entries usable next to a word or phrase: whole sentences are left out. */
function wordDistractors(term: string, dist: readonly string[] | undefined): string[] {
  const size = tokenize(term).length
  return (dist ?? []).filter((d) => {
    const n = tokenize(d).length
    return n > 0 && n <= size + 3 && !(n >= 3 && /[.!?]$/.test(d.trim()))
  })
}

/** The options of a gap-fill: the answer, then each `dist:` entry as the part in the gap (cut down if it's a sentence). */
function clozeChoices(n: Extract<Note, { type: 'cloze' }>): string[] {
  const b = clozeBlank(n.fields.text, 1)
  if (!b) return []
  const answer = b.answers[0]!
  const out = [answer]
  for (const d of n.fields.distractors ?? []) {
    const part = tokenize(d).length > tokenize(answer).length + 3 ? gapFragment(d, b.before, b.after) : d
    if (part && !b.answers.some((a) => normalizeAnswer(a) === normalizeAnswer(part)) && !out.some((o) => normalizeAnswer(o) === normalizeAnswer(part))) out.push(part)
  }
  return out
}

// ---------------- other items: distractors, related mistakes ----------------

/** The other items, indexed once per session: same type (for distractors) and same mistake pattern. */
export interface ExercisePool {
  byType: Map<string, Note[]>
  byPattern: Map<string, Note[]>
}

export function createPool(notes: readonly Note[]): ExercisePool {
  const live = notes.filter((n) => n.deletedAt === null)
  const byPattern = groupBy(
    live.filter((n) => patternKey(n) !== ''),
    patternKey,
  )
  return { byType: groupBy(live, (n) => n.type), byPattern }
}

const EMPTY_POOL: ExercisePool = { byType: new Map(), byPattern: new Map() }

export interface ExerciseOptions extends PromptOptions {
  now?: number
  pool?: ExercisePool
  /** Force one exercise (quiz, preview). */
  exercise?: ExerciseId
}

interface Ctx {
  note: Note
  level: Level
  reps: number
  rand: () => number
  opts: ExerciseOptions
  pool: ExercisePool
}

function related(c: Ctx): Note[] {
  const key = patternKey(c.note)
  return key ? (c.pool.byPattern.get(key) ?? []).filter((n) => n.id !== c.note.id) : []
}
function others(c: Ctx, type: NoteType): Note[] {
  return (c.pool.byType.get(type) ?? []).filter((n) => n.id !== c.note.id)
}

/** A correct English sentence an item stands for (used as the "correct" options in mixed exercises). */
function correctSentence(n: Note): string | null {
  switch (n.type) {
    case 'fix':
      return n.fields.right.split('//')[0]!.trim()
    case 'natural':
      return clozePlain(n.fields.natural)
    case 'sentence':
      return clozePlain(n.fields.text)
    case 'tense':
      return clozePlain(n.fields.sentence)
    case 'cloze':
      return clozePlain(n.fields.text)
    case 'vocab':
      return n.fields.examples[0] ? clozePlain(n.fields.examples[0]) : null
  }
}

/** Up to `count` correct sentences: same mistake pattern first, then same type, then anything. */
function correctSentences(c: Ctx, count: number, exclude: string[]): string[] {
  const seen = new Set(exclude.map((s) => s.toLowerCase()))
  const out: string[] = []
  for (const group of [related(c), others(c, c.note.type), [...c.pool.byType.values()].flat().filter((n) => n.id !== c.note.id)]) {
    for (const n of shuffle(group, c.rand)) {
      const s = correctSentence(n)
      if (s && !seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase())
        out.push(s)
        if (out.length === count) return out
      }
    }
  }
  return out
}

function choice(options: string[], correct: string, rand: () => number) {
  const shuffled = shuffle(uniq(options), rand)
  return { options: shuffled, correctIndex: shuffled.indexOf(correct) }
}

// ---------------- per-type data helpers ----------------

function tenseParts(n: Extract<Note, { type: 'tense' }>) {
  const f = n.fields
  const b = clozeBlank(f.sentence, 1)
  const answers = b?.answers ?? []
  const verb = b?.hint ?? ''
  const before = b?.before ?? ''
  const after = b?.after ?? ''
  const full = clozePlain(f.sentence)
  const mcq = tenseChoice({ verb, tense: f.tense, answers, before, sentence: full })
  // The most confusable wrong form (options[1] is the first distractor, before shuffling).
  const wrongForm = mcq?.options[1] ?? null
  return { f, answers, verb, before, after, full, mcq, wrongForm }
}

/** Transfer sentences from `also:` (tense: sentences with {{answer::verb}}; fix: "wrong => right" pairs). */
function alsoPairs(n: Note): Array<[string, string]> {
  return (n.fields.also ?? [])
    .map((s) => s.split(/\s*(?:=>|->)\s*/))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1])
}

/** The wrong part of a fix sentence (as a token range), or null if the mistake is only an omission. */
function errorSpan(wrong: string, right: string): { start: number; end: number } | null {
  const a = compareWords(wrong).map((w) => w.key)
  const b = compareWords(right).map((w) => w.key)
  const kept = new Set(lcsPairs(a, b).map(([i]) => i))
  const bad = a.map((_, i) => i).filter((i) => !kept.has(i))
  if (!bad.length) return null
  return { start: Math.min(...bad), end: Math.max(...bad) + 1 }
}

function spotOptions(wrong: string, span: { start: number; end: number }, rand: () => number): { options: string[]; answer: string } {
  const words = compareWords(wrong).map((w) => w.display)
  const answer = words.slice(span.start, span.end).join(' ')
  const len = span.end - span.start
  const decoys: string[] = []
  for (let i = 0; i + len <= words.length; i++) {
    if (i < span.end && i + len > span.start) continue // overlaps the error
    decoys.push(words.slice(i, i + len).join(' '))
  }
  return { options: [answer, ...shuffle(uniq(decoys), rand).slice(0, 3)], answer }
}

function naturalKey(f: Extract<Note, { type: 'natural' }>['fields']): { context: Context; answers: string[] } | null {
  if (hasCloze(f.natural)) {
    const b = clozeBlank(f.natural, 1)!
    return { context: { before: b.before, after: b.after }, answers: b.answers }
  }
  const natural = clozePlain(f.natural)
  const key = naturalKeyPhrase(f.mine, natural)
  if (!key) return null
  const b = blankChunk(natural, key)
  return { context: b.context, answers: [b.answer] }
}

const isSpelling = (n: Note) => n.tags.includes('spelling')

// ---------------- availability ----------------

/** Can this exercise be built for this item (is the data there)? */
function available(id: ExerciseId, c: Ctx): boolean {
  const n = c.note
  switch (id) {
    case 'vocab-choose':
      return n.type === 'vocab' && (wordDistractors(n.fields.term, n.fields.distractors).length > 0 || others(c, 'vocab').length > 0)
    case 'vocab-from-he':
    case 'cloze-produce':
      return !!n.fields.he
    case 'fix-spot':
      return n.type === 'fix' && errorSpan(n.fields.wrong, n.fields.right.split('//')[0]!) !== null && compareWords(n.fields.wrong).length >= 3
    case 'fix-transfer':
      return n.type === 'fix' && (alsoPairs(n).length > 0 || related(c).some((r) => r.type === 'fix'))
    case 'fix-mixed':
    case 'natural-spot':
      return correctSentences(c, 2, []).length >= 2
    case 'fix-produce':
    case 'tense-produce':
    case 'natural-produce':
      return !!(n.fields.he || n.fields.prompt)
    case 'tense-choose':
    case 'tense-rewrite':
      return n.type === 'tense' && tenseParts(n).mcq !== null
    case 'tense-spot':
      return n.type === 'tense' && tenseParts(n).mcq !== null && correctSentences(c, 2, []).length >= 2
    case 'tense-transfer':
      return n.type === 'tense' && (n.fields.also ?? []).some(hasCloze)
    case 'natural-key':
      return n.type === 'natural' && naturalKey(n.fields) !== null
    case 'sentence-meaning':
    case 'sentence-translate':
      return n.type === 'sentence' && !!n.fields.he
    case 'sentence-speak':
      return !!c.opts.speech && n.type === 'sentence' && !!n.fields.he
    case 'sentence-produce':
      return !!n.fields.prompt
    case 'cloze-choose':
      return n.type === 'cloze' && clozeChoices(n).length > 1
    default:
      return true
  }
}

/**
 * The exercise for this item now: the one for its level (taking turns when a level has several), or the
 * nearest level whose data exists. After a long break: a recall exercise instead.
 */
export function chooseExercise(note: Note, card: Card, opts: ExerciseOptions = { promptLanguage: 'english' }): { id: ExerciseId; level: Level; afterBreak: boolean } {
  const c = makeCtx(note, card, opts)
  if (opts.exercise) return { id: opts.exercise, level: c.level, afterBreak: false }
  if (isLongBreak(card, opts.now ?? Date.now())) {
    const recall = RECALL[note.type].find((id) => available(id, c))
    if (recall) return { id: recall, level: c.level, afterBreak: true }
  }
  const ladder = LADDER[note.type]
  // Search the item's level first, then lower levels, then higher ones.
  const order = [c.level, ...[4, 3, 2, 1].filter((l) => l < c.level), ...[2, 3, 4, 5].filter((l) => l > c.level)] as Level[]
  for (const level of order) {
    const candidates = ladder[level - 1]!.filter((id) => available(id, c))
    if (candidates.length) return { id: candidates[c.reps % candidates.length]!, level: c.level, afterBreak: false }
  }
  return { id: ladder[2]![0]!, level: c.level, afterBreak: false }
}

function makeCtx(note: Note, card: Card, opts: ExerciseOptions): Ctx {
  return {
    note,
    level: levelOf(card).level,
    reps: card.fsrs.reps,
    rand: seededRandom(`${card.id}:${card.fsrs.reps}:${levelOf(card).level}`),
    opts,
    pool: opts.pool ?? EMPTY_POOL,
  }
}

/** All exercises that can be built for an item (used by quizzes to pick by format). */
export function availableExercises(note: Note, card: Card, opts: ExerciseOptions): ExerciseId[] {
  const c = makeCtx(note, card, opts)
  return uniq(LADDER[note.type].flat()).filter((id) => available(id, c))
}

/** Build the exercise for an item. */
export function buildPrompt(note: Note, card: Card, opts: ExerciseOptions = { promptLanguage: 'english' }): Prompt {
  const chosen = chooseExercise(note, card, opts)
  const c = makeCtx(note, card, opts)
  const base = { exercise: chosen.id, level: chosen.level, ...(chosen.afterBreak ? { afterBreak: true } : {}) }
  return { ...build(chosen.id, c), ...base } as Prompt
}

type Built = Omit<Prompt, 'exercise' | 'level'> & Record<string, unknown>

function build(id: ExerciseId, c: Ctx): Built {
  const n = c.note
  switch (n.type) {
    case 'vocab':
      return buildVocab(id, c, n)
    case 'fix':
      return buildFix(id, c, n)
    case 'tense':
      return buildTense(id, c, n)
    case 'natural':
      return buildNatural(id, c, n)
    case 'sentence':
      return buildSentence(id, c, n)
    case 'cloze':
      return buildCloze(id, c, n)
  }
}

const opt = <K extends string>(k: K, v: string | undefined) => (v ? ({ [k]: v } as Record<K, string>) : {})

// ---------------- @vocab: flashcards both ways, never a blank ----------------

function buildVocab(id: ExerciseId, c: Ctx, n: Extract<Note, { type: 'vocab' }>): Built {
  const f = n.fields
  const example = f.examples[0] ? clozePlain(f.examples[0]) : undefined
  const reveal: Reveal = {
    answer: f.term,
    definition: f.definition,
    examples: f.examples.map(clozePlain),
    ...(f.collocations ? { collocations: f.collocations } : {}),
    ...opt('he', f.he),
    ...opt('notes', f.notes),
    ...opt('rule', f.rule),
  }
  const meaning = c.opts.promptLanguage === 'hebrew' && f.he ? { prompt: f.he, promptIsHebrew: true } : { prompt: f.definition }
  const spelling = isSpelling(n)
  switch (id) {
    case 'vocab-choose': {
      const pool = shuffle(others(c, 'vocab'), c.rand)
      const samePos = pool.filter((o) => o.type === 'vocab' && f.pos && o.fields.pos === f.pos)
      const guessed = [...samePos, ...pool].map((o) => (o.type === 'vocab' ? o.fields.term : ''))
      const wrong = uniq([...wordDistractors(f.term, f.distractors), ...guessed]).filter((t) => t && t.toLowerCase() !== f.term.toLowerCase()).slice(0, 3)
      return { kind: 'choice', instruction: 'Which word means this?', ...meaning, ...choice([f.term, ...wrong], f.term, c.rand), reveal, speak: f.term }
    }
    case 'vocab-produce':
      return {
        kind: 'typed',
        instruction: spelling ? 'Write the word that means:' : 'Which word or phrase is this?',
        ...meaning,
        ...(f.pos && c.level < 5 ? { hint: f.pos } : {}),
        accepted: [f.term],
        check: { mode: 'exact', typos: spelling ? 'strict' : 'tolerate' },
        multiline: false,
        reveal,
        speak: f.term,
      }
    case 'vocab-from-he':
      return {
        kind: 'typed',
        instruction: spelling ? 'Write the English word for:' : 'Say it in English, then type it',
        prompt: f.he!,
        promptIsHebrew: true,
        accepted: [f.term],
        check: { mode: 'exact', typos: spelling ? 'strict' : 'tolerate' },
        multiline: false,
        reveal,
        speak: f.term,
      }
    case 'vocab-use':
      return {
        kind: 'typed',
        instruction: `Write a sentence of your own with "${f.term}" (say it aloud too)`,
        prompt: f.definition,
        accepted: f.examples.map(clozePlain),
        check: { mode: 'meaning' },
        multiline: true,
        selfCheck: true,
        reveal,
        speak: example ?? f.term,
      }
    default:
      // vocab-flash: the word with its original example as context; the meaning on the back.
      return {
        kind: 'flip',
        instruction: 'What does it mean?',
        front: f.term,
        ...opt('frontSub', f.pos),
        ...opt('example', example),
        back: f.definition,
        reveal,
        speak: f.term,
        audioPrompt: true,
      }
  }
}

// ---------------- @fix: the sentence you said wrong ----------------

function buildFix(id: ExerciseId, c: Ctx, n: Extract<Note, { type: 'fix' }>): Built {
  const f = n.fields
  const rights = f.right.split('//').map((s) => s.trim()).filter(Boolean)
  const right = rights[0]!
  const point = correctionWords(f.wrong, right)
  const reveal: Reveal = { answer: right, original: f.wrong, ...opt('rule', f.rule), ...opt('he', f.he) }
  switch (id) {
    case 'fix-choose':
      return {
        kind: 'choice',
        instruction: f.prompt || f.he ? 'Which is the correct way to say it?' : 'Which one is correct?',
        ...stem(f),
        ...choice([right, f.wrong, ...sentenceDistractors(n).slice(0, 2)], right, c.rand),
        reveal,
        speak: right,
      }
    case 'fix-spot': {
      const s = spotOptions(f.wrong, errorSpan(f.wrong, right)!, c.rand)
      return { kind: 'choice', instruction: 'Which part is wrong?', prompt: f.wrong, ...choice(s.options, s.answer, c.rand), reveal, speak: right }
    }
    case 'fix-transfer': {
      // Same rule, a different sentence: from `also:` or from another item with the same mistake pattern.
      const pairs: Array<[string, string, string | undefined]> = [
        ...alsoPairs(n).map(([w, r]) => [w, r, f.rule] as [string, string, string | undefined]),
        ...related(c)
          .filter((r): r is Extract<Note, { type: 'fix' }> => r.type === 'fix')
          .map((r) => [r.fields.wrong, r.fields.right, r.fields.rule] as [string, string, string | undefined]),
      ]
      const [w, r, rule] = pairs[c.reps % pairs.length]!
      const rs = r.split('//').map((s) => s.trim())
      return {
        kind: 'typed',
        instruction: 'Same mistake, new sentence: correct it',
        prompt: w,
        accepted: rs,
        check: { mode: 'exact', protect: correctionWords(w, rs[0]!) },
        multiline: true,
        reveal: { answer: rs[0]!, original: w, ...opt('rule', rule ?? f.rule) },
        speak: rs[0]!,
      }
    }
    case 'fix-mixed': {
      const good = correctSentences(c, 3, rights)
      return { kind: 'choice', instruction: 'One of these has a mistake. Which?', ...choice([f.wrong, ...good], f.wrong, c.rand), reveal, speak: right }
    }
    case 'fix-produce':
      return {
        kind: 'typed',
        instruction: f.he ? 'Say it in English, then type it (mind the mistake you used to make)' : 'What would you say? Type it',
        prompt: f.he ?? f.prompt!,
        promptIsHebrew: !!f.he,
        accepted: rights,
        check: { mode: 'meaning', protect: point },
        multiline: true,
        reveal,
        speak: right,
      }
    default:
      // fix-correct: your original wrong sentence, corrected.
      return {
        kind: 'typed',
        instruction: 'You said this. Correct it',
        prompt: f.wrong,
        accepted: rights,
        check: { mode: 'exact', protect: point },
        multiline: true,
        reveal,
        speak: right,
      }
  }
}

// ---------------- @tense: the specific tense rule of the item ----------------

function buildTense(id: ExerciseId, c: Ctx, n: Extract<Note, { type: 'tense' }>): Built {
  const t = tenseParts(n)
  const reveal: Reveal = { answer: t.answers[0] ?? '', full: t.full, tense: t.f.tense, ...opt('why', t.f.why), ...opt('rule', t.f.rule), ...opt('he', t.f.he) }
  const context = { before: t.before, after: t.after }
  const sentenceWith = (form: string) => `${t.before}${form}${t.after}`
  const tenseInfo = t.verb ? { tenseInfo: { verb: t.verb, tense: t.f.tense, before: t.before, sentence: t.full } } : {}
  switch (id) {
    case 'tense-choose':
      return { kind: 'choice', instruction: 'Choose the right form', context, ...opt('hint', t.verb), ...choice(t.mcq!.options, t.mcq!.options[0]!, c.rand), reveal, speak: t.full }
    case 'tense-rewrite':
      return {
        kind: 'typed',
        instruction: 'The tense is wrong here. Rewrite the sentence correctly',
        prompt: sentenceWith(t.wrongForm!),
        accepted: t.answers.map(sentenceWith),
        check: { mode: 'exact', protect: t.answers.slice(0, 1) },
        multiline: true,
        reveal,
        speak: t.full,
      }
    case 'tense-spot': {
      const wrong = sentenceWith(t.wrongForm!)
      const good = correctSentences(c, 3, [t.full])
      return { kind: 'choice', instruction: 'Which sentence has a tense mistake?', ...choice([wrong, ...good], wrong, c.rand), reveal: { ...reveal, original: wrong }, speak: t.full }
    }
    case 'tense-transfer': {
      const sentences = (t.f.also ?? []).filter(hasCloze)
      const s = sentences[c.reps % sentences.length]!
      const b = clozeBlank(s, 1)!
      return {
        kind: 'typed',
        instruction: `Same rule (${t.f.tense.replace(/-/g, ' ')}), new sentence`,
        context: { before: b.before, after: b.after },
        ...opt('hint', b.hint),
        accepted: b.answers,
        check: { mode: 'exact', protect: b.answers.slice(0, 1) },
        multiline: false,
        reveal: { ...reveal, answer: b.answers[0] ?? '', full: clozePlain(s) },
        speak: clozePlain(s),
      }
    }
    case 'tense-produce':
      return {
        kind: 'typed',
        instruction: t.f.he ? 'Say it in English, then type it' : 'What would you say? Type it',
        prompt: t.f.he ?? t.f.prompt!,
        promptIsHebrew: !!t.f.he,
        accepted: t.answers.map(sentenceWith),
        check: { mode: 'meaning', protect: t.answers.slice(0, 1) },
        multiline: true,
        reveal,
        speak: t.full,
      }
    default:
      // tense-fill: the verb in the right tense, base verb as a hint.
      return {
        kind: 'typed',
        instruction: 'Fill in the verb in the right tense',
        context,
        ...opt('hint', t.verb),
        accepted: t.answers,
        check: { mode: 'exact', protect: t.answers.slice(0, 1) },
        multiline: false,
        reveal,
        speak: t.full,
        ...tenseInfo,
      }
  }
}

// ---------------- @natural: correct, but could sound more native ----------------

function buildNatural(id: ExerciseId, c: Ctx, n: Extract<Note, { type: 'natural' }>): Built {
  const f = n.fields
  const natural = clozePlain(f.natural)
  const key = naturalKey(f)
  const point = key?.answers.slice(0, 1) ?? []
  const reveal: Reveal = { answer: natural, full: natural, original: f.mine, ...opt('notes', f.note), ...opt('rule', f.rule), ...opt('he', f.he) }
  switch (id) {
    case 'natural-choose':
      return {
        kind: 'choice',
        instruction: f.prompt || f.he ? 'Which is the most natural way to say it?' : 'Which sounds more natural?',
        ...stem(f),
        ...choice([natural, f.mine, ...sentenceDistractors(n).slice(0, 2)], natural, c.rand),
        reveal,
        speak: natural,
      }
    case 'natural-key':
      return {
        kind: 'typed',
        instruction: 'Complete the natural version',
        prompt: f.mine,
        context: key!.context,
        accepted: key!.answers,
        check: { mode: 'exact', protect: point },
        multiline: false,
        reveal: { ...reveal, answer: key!.answers[0]! },
        speak: natural,
      }
    case 'natural-spot': {
      const good = correctSentences(c, 3, [natural])
      return { kind: 'choice', instruction: 'Which one sounds least natural?', ...choice([f.mine, ...good], f.mine, c.rand), reveal, speak: natural }
    }
    case 'natural-produce':
      return {
        kind: 'typed',
        instruction: f.he ? 'Say it the natural way, then type it' : 'What would a native speaker say? Type it',
        prompt: f.he ?? f.prompt!,
        promptIsHebrew: !!f.he,
        accepted: [natural],
        check: { mode: 'meaning', protect: point },
        multiline: true,
        reveal,
        speak: natural,
      }
    default:
      // natural-upgrade: your version → the natural one.
      return {
        kind: 'typed',
        instruction: 'You said this. Say it more naturally',
        prompt: f.mine,
        accepted: [natural],
        check: { mode: 'meaning', protect: point },
        multiline: true,
        reveal,
        speak: natural,
      }
  }
}

// ---------------- @sentence: Hebrew ↔ English ----------------

function buildSentence(id: ExerciseId, c: Ctx, n: Extract<Note, { type: 'sentence' }>): Built {
  const f = n.fields
  const plain = clozePlain(f.text)
  const reveal: Reveal = { answer: plain, full: plain, ...opt('he', f.he), ...opt('notes', f.notes), ...opt('rule', f.rule) }
  switch (id) {
    case 'sentence-meaning':
      return { kind: 'flip', instruction: 'What does it mean? Say it to yourself, then check', front: plain, back: f.he!, reveal, speak: plain, audioPrompt: true }
    case 'sentence-translate':
      return { kind: 'typed', instruction: 'Say it in English, then type it', prompt: f.he!, promptIsHebrew: true, accepted: [plain], check: { mode: 'meaning' }, multiline: true, reveal, speak: plain }
    case 'sentence-speak':
      return { kind: 'speak', instruction: 'Say it in English', prompt: f.he!, promptIsHebrew: true, target: plain, reveal, speak: plain }
    case 'sentence-produce':
      return { kind: 'typed', instruction: 'What would you say? Type it', prompt: f.prompt!, accepted: [plain], check: { mode: 'meaning' }, multiline: true, reveal, speak: plain }
    default: {
      // sentence-guided: the Hebrew (or situation) with the first letters of each word as support.
      const cue = f.he ? { prompt: f.he, promptIsHebrew: true } : f.prompt ? { prompt: f.prompt } : c.opts.audio ? { audioPrompt: true } : {}
      return {
        kind: 'typed',
        instruction: f.he ? 'Say it in English (first letters given), then type it' : 'Recall the sentence (first letters given)',
        ...cue,
        hint: firstLetters(plain),
        accepted: [plain],
        check: { mode: 'exact' },
        multiline: true,
        reveal,
        speak: plain,
      }
    }
  }
}

// ---------------- @cloze: the blank is the exact point of the mistake ----------------

function buildCloze(id: ExerciseId, c: Ctx, n: Extract<Note, { type: 'cloze' }>): Built {
  const f = n.fields
  const count = Math.max(1, clozeCount(f.text))
  // Several blanks take turns; multiple choice always asks about the first (that's where `dist` applies).
  const which = id === 'cloze-choose' ? 1 : (c.reps % count) + 1
  const b = clozeBlank(f.text, which) ?? clozeBlank(f.text, 1)
  const full = clozePlain(f.text)
  const answers = b?.answers ?? []
  const reveal: Reveal = { answer: answers[0] ?? '', full, ...opt('he', f.he), ...opt('rule', f.rule) }
  const context = { before: b?.before ?? '', after: b?.after ?? '' }
  switch (id) {
    case 'cloze-choose':
      return { kind: 'choice', instruction: 'Choose what fits', context, ...opt('hint', b?.hint), ...choice(clozeChoices(n).slice(0, 4), answers[0]!, c.rand), reveal, speak: full }
    case 'cloze-produce':
      return { kind: 'typed', instruction: 'Say it in English, then type it', prompt: f.he!, promptIsHebrew: true, accepted: [full], check: { mode: 'meaning', protect: answers.slice(0, 1) }, multiline: true, reveal, speak: full }
    default:
      return {
        kind: 'typed',
        instruction: 'Fill in the gap',
        context,
        ...(id === 'cloze-hint' ? opt('hint', b?.hint) : {}),
        accepted: answers,
        check: { mode: 'exact', protect: answers.slice(0, 1) },
        multiline: false,
        reveal,
        speak: full,
      }
  }
}

/** Plain text of the item's correct form (for previews and lists). */
export function itemAnswer(note: Note): string {
  return correctSentence(note) ?? (note.type === 'vocab' ? note.fields.term : '')
}

