import { availableExercises, buildPrompt, chooseExercise, createPool, LADDER } from './exercises'
import type { Prompt } from './prompt'
import { emptyFsrs } from './scheduler'
import { newCard, templatesFor } from './templates'
import type { Card, Level, Note, NoteContent } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 2, 12).getTime()

let k = 0
function note(content: NoteContent, tags: string[] = []): Note {
  return { ...content, id: `n${++k}`, tags, packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null } as Note
}
function card(n: Note, level: Level, extra: Partial<Card> = {}): Card {
  return { ...newCard(n.id, templatesFor(n)[0]!, 0), level, fsrs: { ...emptyFsrs(0), state: 2, lastReview: NOW - DAY, reps: 0 }, ...extra }
}
const at = (n: Note, level: Level, pool: Note[] = [], extra: Partial<Card> = {}, speech = false): Prompt =>
  buildPrompt(n, card(n, level, extra), { promptLanguage: 'english', now: NOW, pool: createPool([n, ...pool]), speech })

// ---- realistic items, the way the coach writes them ----
const vocab = note({ type: 'vocab', fields: { term: 'reluctant', definition: 'unwilling and hesitant', examples: ['He was reluctant to commit.'], he: 'מסויג', pos: 'adj' } })
const vocab2 = note({ type: 'vocab', fields: { term: 'eager', definition: 'wanting very much', examples: ['She was eager to start.'], pos: 'adj' } })
const vocab3 = note({ type: 'vocab', fields: { term: 'subsidy', definition: 'money paid by a government', examples: [] , pos: 'noun'} })
const fix = note(
  {
    type: 'fix',
    fields: {
      wrong: 'It depends of the situation.',
      right: 'It depends on the situation.',
      rule: '"Depend" takes "on".',
      he: 'זה תלוי במצב.',
      also: ['It all depends of the price. => It all depends on the price.'],
    },
  },
  ['pattern:depend-on'],
)
const fixNoExtras = note({ type: 'fix', fields: { wrong: 'I very agree with you.', right: 'I completely agree with you.', rule: '"Very" cannot modify a verb.' } })
const tense = note({
  type: 'tense',
  fields: { sentence: 'I {{have been working::work}} here for five years.', tense: 'present-perfect-continuous', why: 'ongoing up to now', he: 'אני עובד כאן חמש שנים.', also: ['She {{has been living::live}} in Haifa since 2019.'] },
})
const tense2 = note({ type: 'tense', fields: { sentence: 'They {{have been waiting::wait}} for an hour.', tense: 'present-perfect-continuous' } })
const tense3 = note({ type: 'tense', fields: { sentence: 'We {{met::meet}} in 2019.', tense: 'past-simple' } })
const natural = note({ type: 'natural', fields: { mine: 'This is a very big problem.', natural: 'This is a serious problem.', note: 'collocation', prompt: 'You describe a problem in a meeting' } })
const natural2 = note({ type: 'natural', fields: { mine: 'I want to say something.', natural: 'Can I jump in here?' } })
const sentence = note({ type: 'sentence', fields: { text: "That's easier said than done.", he: 'קל לומר, קשה לעשות.', prompt: 'A friend suggests a hard plan' } })
const sentenceNoHe = note({ type: 'sentence', fields: { text: 'It depends on how you define success.' } })
const cloze = note({ type: 'cloze', fields: { text: 'The bank {{raised//put up::raise}} interest rates again.', distractors: ['rose', 'has risen'] } })
const clozeNoDist = note({ type: 'cloze', fields: { text: 'Demand {{outstripped::exceeded}} supply.' } })
const everything = [vocab, vocab2, vocab3, fix, fixNoExtras, tense, tense2, tense3, natural, natural2, sentence, sentenceNoHe, cloze, clozeNoDist]

describe('@vocab: flashcards both ways, never a blank', () => {
  it('L1 is a flashcard: the word, its original example as context, the meaning on the back', () => {
    const p = at(vocab, 1)
    expect(p).toMatchObject({ kind: 'flip', exercise: 'vocab-flash', front: 'reluctant', example: 'He was reluctant to commit.', back: 'unwilling and hesitant' })
  })
  it('L2 meaning → choose the English word from other words', () => {
    const p = at(vocab, 2, [vocab2, vocab3])
    expect(p.kind).toBe('choice')
    if (p.kind !== 'choice') return
    expect(p.prompt).toBe('unwilling and hesitant')
    expect(p.options[p.correctIndex]).toBe('reluctant')
    expect(p.options).toContain('eager')
  })
  it('L3 meaning → type the word; L4 your own sentence (self-check); L5 from Hebrew', () => {
    expect(at(vocab, 3)).toMatchObject({ kind: 'typed', exercise: 'vocab-produce', prompt: 'unwilling and hesitant', accepted: ['reluctant'] })
    expect(at(vocab, 4)).toMatchObject({ kind: 'typed', exercise: 'vocab-use', selfCheck: true })
    expect(at(vocab, 5)).toMatchObject({ kind: 'typed', exercise: 'vocab-from-he', prompt: 'מסויג', promptIsHebrew: true })
  })
  it('no vocab exercise ever shows a sentence with a blank', () => {
    for (const level of [1, 2, 3, 4, 5] as Level[]) expect(at(vocab, level, [vocab2]).context, `L${level}`).toBeUndefined()
  })
  it('spelling is asked explicitly, and checked strictly, only for words tagged #spelling', () => {
    expect(at(vocab, 3)).toMatchObject({ instruction: 'Which word or phrase is this?', check: { typos: 'tolerate' } })
    const tagged = { ...vocab, tags: ['spelling'] } as Note
    expect(at(tagged, 3)).toMatchObject({ instruction: 'Write the word that means:', check: { typos: 'strict' } })
  })
  it('without other words or `dist:`, L2 falls back instead of a one-option choice', () => {
    expect(chooseExercise(vocab3, card(vocab3, 2), { promptLanguage: 'english' }).id).not.toBe('vocab-choose')
  })
})

describe('@fix: the sentence you said wrong', () => {
  it('L1 choose the correct version; L2 spot the wrong part; L3 correct your sentence', () => {
    const p1 = at(fix, 1)
    expect(p1.kind === 'choice' && p1.options.sort()).toEqual(['It depends of the situation.', 'It depends on the situation.'])
    const p2 = at(fix, 2)
    expect(p2.kind).toBe('choice')
    if (p2.kind === 'choice') {
      expect(p2.prompt).toBe('It depends of the situation.')
      expect(p2.options[p2.correctIndex]).toBe('of')
    }
    expect(at(fix, 3)).toMatchObject({ kind: 'typed', exercise: 'fix-correct', prompt: 'It depends of the situation.', check: { protect: ['on'] } })
  })
  it('L4 applies the same rule to a new sentence (from also:), L5 says it from Hebrew', () => {
    expect(at(fix, 4)).toMatchObject({ exercise: 'fix-transfer', prompt: 'It all depends of the price.', accepted: ['It all depends on the price.'] })
    expect(at(fix, 5)).toMatchObject({ exercise: 'fix-produce', prompt: 'זה תלוי במצב.' })
  })
  it('the rule is shown after every attempt', () => {
    for (const level of [1, 2, 3, 4, 5] as Level[]) expect(at(fix, level).reveal.rule, `L${level}`).toBe('"Depend" takes "on".')
  })
  it('without also:, L4 is "find the mistake" among correct sentences; without Hebrew, L5 falls back', () => {
    const p = at(fixNoExtras, 4, [natural, sentence])
    expect(p.exercise).toBe('fix-mixed')
    if (p.kind === 'choice') expect(p.options[p.correctIndex]).toBe('I very agree with you.')
    expect(at(fixNoExtras, 5).exercise).not.toBe('fix-produce')
  })
  it('a mistake with the same pattern counts as transfer material', () => {
    const sibling = note({ type: 'fix', fields: { wrong: 'We depend of you.', right: 'We depend on you.', rule: '"Depend" takes "on".' } }, ['pattern:depend-on'])
    const plain = { ...fix, fields: { ...fix.fields, also: undefined } } as Note
    expect(at(plain, 4, [sibling])).toMatchObject({ exercise: 'fix-transfer', prompt: 'We depend of you.' })
  })
})

describe('@tense: always the item’s own tense rule', () => {
  it('L1 choose the form, L2 fill the verb, L3 rewrite a sentence with the wrong tense', () => {
    expect(at(tense, 1)).toMatchObject({ kind: 'choice', exercise: 'tense-choose' })
    expect(at(tense, 2)).toMatchObject({ kind: 'typed', exercise: 'tense-fill', hint: 'work', accepted: ['have been working'] })
    const p3 = at(tense, 3)
    expect(p3).toMatchObject({ exercise: 'tense-rewrite', accepted: ['I have been working here for five years.'] })
    expect(p3.prompt).not.toBe('I have been working here for five years.')
  })
  it('L4 transfers the rule to a new sentence; L5 produces the whole sentence from Hebrew', () => {
    expect(at(tense, 4)).toMatchObject({ exercise: 'tense-transfer', hint: 'live', accepted: ['has been living'] })
    expect(at(tense, 5)).toMatchObject({ exercise: 'tense-produce', promptIsHebrew: true, check: { mode: 'meaning', protect: ['have been working'] } })
  })
  it('L4 without also: is "find the tense mistake", with sentences of the same tense', () => {
    const p = at(tense2, 4, [tense, tense3])
    expect(p.exercise).toBe('tense-spot')
    if (p.kind === 'choice') expect(p.options[p.correctIndex]).not.toBe('They have been waiting for an hour.')
  })
})

describe('@natural: your correct but unnatural phrasing', () => {
  it('L1 choose the more natural, L2 the key phrase, L3 upgrade your version, L5 from the situation', () => {
    expect(at(natural, 1)).toMatchObject({ kind: 'choice', exercise: 'natural-choose' })
    expect(at(natural, 2)).toMatchObject({ exercise: 'natural-key', prompt: 'This is a very big problem.', accepted: ['serious'] })
    expect(at(natural, 3)).toMatchObject({ exercise: 'natural-upgrade', prompt: 'This is a very big problem.', check: { mode: 'meaning', protect: ['serious'] } })
    expect(at(natural, 5)).toMatchObject({ exercise: 'natural-produce', prompt: 'You describe a problem in a meeting' })
  })
  it('L4 spots the unnatural one among natural sentences', () => {
    const p = at(natural, 4, [natural2, sentence])
    expect(p.exercise).toBe('natural-spot')
    if (p.kind === 'choice') expect(p.options[p.correctIndex]).toBe('This is a very big problem.')
  })
})

describe('@sentence: Hebrew ↔ English', () => {
  it('L1 English → meaning; L2 Hebrew with first letters; L3 Hebrew → English; L5 from the situation', () => {
    expect(at(sentence, 1)).toMatchObject({ kind: 'flip', exercise: 'sentence-meaning', front: "That's easier said than done.", back: 'קל לומר, קשה לעשות.' })
    expect(at(sentence, 2)).toMatchObject({ exercise: 'sentence-guided', prompt: 'קל לומר, קשה לעשות.', hint: "T e s t d." })
    expect(at(sentence, 3)).toMatchObject({ exercise: 'sentence-translate', check: { mode: 'meaning' } })
    expect(at(sentence, 5)).toMatchObject({ exercise: 'sentence-produce', prompt: 'A friend suggests a hard plan' })
  })
  it('L4 is speaking where the browser can listen', () => {
    expect(at(sentence, 4, [], {}, true).kind).toBe('speak')
    expect(at(sentence, 4, [], {}, false).exercise).toBe('sentence-translate')
  })
  it('never hides a random word', () => {
    for (const level of [1, 2, 3, 4, 5] as Level[]) expect(at(sentenceNoHe, level).context, `L${level}`).toBeUndefined()
  })
})

describe('@cloze: the blank is the marked point only', () => {
  it('choices only when dist: is given; otherwise the gap with its hint', () => {
    const p = at(cloze, 1)
    expect(p.kind === 'choice' && p.options.sort()).toEqual(['has risen', 'raised', 'rose'])
    expect(at(clozeNoDist, 1)).toMatchObject({ kind: 'typed', exercise: 'cloze-hint', hint: 'exceeded' })
  })
  it('the blank is exactly the marked words, with the rest of the sentence as context', () => {
    expect(at(cloze, 2)).toMatchObject({ context: { before: 'The bank ', after: ' interest rates again.' }, accepted: ['raised', 'put up'], hint: 'raise' })
    expect(at(cloze, 3).hint).toBeUndefined()
  })
})

describe('after a long break', () => {
  it('starts with recall (produce the answer), not recognition or a choice', () => {
    const away = { fsrs: { ...emptyFsrs(0), state: 2 as const, lastReview: NOW - 10 * DAY, reps: 3 } }
    expect(at(vocab, 1, [vocab2], away)).toMatchObject({ exercise: 'vocab-produce', afterBreak: true })
    expect(at(fix, 1, [], away)).toMatchObject({ exercise: 'fix-correct', afterBreak: true })
    expect(at(tense, 1, [], away)).toMatchObject({ exercise: 'tense-fill', afterBreak: true })
    expect(at(natural, 1, [], away)).toMatchObject({ exercise: 'natural-upgrade', afterBreak: true })
    expect(at(sentence, 1, [], away)).toMatchObject({ exercise: 'sentence-translate', afterBreak: true })
    expect(at(cloze, 1, [], away)).toMatchObject({ exercise: 'cloze-recall', afterBreak: true })
  })
  it('a recent item keeps its level exercise', () => {
    expect(at(vocab, 1).afterBreak).toBeUndefined()
  })
})

it('every exercise on every level builds without errors for every item', () => {
  const pool = createPool(everything)
  for (const n of everything) {
    for (const id of availableExercises(n, card(n, 1), { promptLanguage: 'english', pool, speech: true })) {
      const p = buildPrompt(n, card(n, 1), { promptLanguage: 'english', pool, exercise: id, speech: true })
      expect(p.exercise).toBe(id)
      expect(p.instruction.length).toBeGreaterThan(0)
      if (p.kind === 'choice') expect(p.options[p.correctIndex], `${n.type} ${id}`).toBeTruthy()
      if (p.kind === 'typed' && !p.selfCheck) expect(p.accepted.length, `${n.type} ${id}`).toBeGreaterThan(0)
    }
  }
  expect(Object.keys(LADDER)).toHaveLength(6)
})
