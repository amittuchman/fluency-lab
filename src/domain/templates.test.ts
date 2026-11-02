import sampleText from '../../samples/sample-package.txt?raw'
import { buildPrompt, createPool } from './exercises'
import { parseImport } from './parser'
import { emptyFsrs } from './scheduler'
import { ALL_TENSES } from './tags'
import { findTermInExample, ITEM_TEMPLATE, naturalKeyPhrase, newCard, reconcileCards, seedItemCard, templatesFor } from './templates'
import type { Card, Note, NoteContent } from './types'

const note = (content: NoteContent, id = 'n1'): Note =>
  ({ ...content, id, tags: [], packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note

const oldCard = (template: string, extra: Partial<Card> = {}): Card => ({
  ...newCard('n1', { template, order: 0, contentHash: 'x' }, 0),
  ...extra,
})

describe('one card per item', () => {
  it('every item type gets exactly one item card', () => {
    const contents: NoteContent[] = [
      { type: 'vocab', fields: { term: 'reluctant', definition: 'unwilling', examples: ['He was reluctant to go.'] } },
      { type: 'sentence', fields: { text: 'It depends on you.' } },
      { type: 'fix', fields: { wrong: 'a', right: 'b', rule: '' } },
      { type: 'natural', fields: { mine: 'very big problem', natural: 'serious problem' } },
      { type: 'tense', fields: { sentence: 'I {{went::go}}.', tense: 'past-simple' } },
      { type: 'cloze', fields: { text: '{{a}} and {{b}}' } },
    ]
    for (const c of contents) expect(templatesFor(c).map((t) => t.template)).toEqual([ITEM_TEMPLATE])
  })

  it('a new note gets a fresh L1 card with a deterministic id', () => {
    const r = reconcileCards(note({ type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } }), [], 0)
    expect(r.add).toHaveLength(1)
    expect(r.add[0]).toMatchObject({ id: 'n1:item', template: 'item', level: 1, unlocked: true })
  })

  it('edits that keep what is asked keep the schedule and level; content changes restart the item', () => {
    const n = note({ type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } })
    const card: Card = { ...reconcileCards(n, [], 0).add[0]!, level: 3, fsrs: { ...emptyFsrs(0), reps: 4, state: 2 } }
    expect(reconcileCards(note({ type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'a better rule', he: 'x' } }), [card], 5)).toEqual({ add: [], update: [] })
    const r = reconcileCards(note({ type: 'fix', fields: { wrong: 'a b', right: 'c e', rule: 'r' } }), [card], 5)
    expect(r.update[0]).toMatchObject({ level: 1, cleanStreak: 0, fsrs: { reps: 0 }, resetAt: 5 })
  })
})

describe('migration from the old per-exercise cards', () => {
  it('the item inherits the best-learned old card and a starting level; old cards are left alone', () => {
    const old = [
      oldCard('recog', { fsrs: { ...emptyFsrs(0), state: 2, stability: 12, reps: 5, lastReview: 100, lapses: 1 } }),
      oldCard('cloze-use', { fsrs: { ...emptyFsrs(0), state: 2, stability: 4, reps: 2, lastReview: 200 } }),
      oldCard('produce'),
    ]
    const n = note({ type: 'vocab', fields: { term: 'hedge', definition: 'protect', examples: [] } })
    const r = reconcileCards(n, old, 1_000)
    expect(r.update).toEqual([]) // nothing written to old cards
    expect(r.add).toHaveLength(1)
    expect(r.add[0]).toMatchObject({ template: 'item', level: 2, fsrs: { stability: 12, reps: 5, lapses: 1 } })
  })
  it('a never-reviewed note starts at L1 as new; all-suspended stays suspended', () => {
    const seeded = seedItemCard('n1', templatesFor({ type: 'sentence', fields: { text: 'Hi.' } })[0]!, [oldCard('chunk-cloze', { suspended: true })], 0)
    expect(seeded).toMatchObject({ level: 1, suspended: true, fsrs: { state: 0 } })
  })
  it('level from old progress is capped at L3', () => {
    const reviewed = ['recog', 'cloze-use', 'produce', 'dictation'].map((t) => oldCard(t, { fsrs: { ...emptyFsrs(0), state: 2, stability: 3, lastReview: 1 } }))
    expect(seedItemCard('n1', { template: 'item', order: 0, contentHash: 'h' }, reviewed, 0).level).toBe(3)
  })
})

describe('helpers', () => {
  it('finds inflected terms in examples', () => {
    expect(findTermInExample('follow through', 'He rarely follows through.')?.match).toBe('follows through')
    expect(findTermInExample('leverage', 'We leveraged our data.')?.match).toBe('leveraged')
    expect(findTermInExample('cat', 'The category is wide.')).toBeNull()
  })
  it('finds the key phrase of a natural version', () => {
    expect(naturalKeyPhrase('This is a very big problem.', 'This is a serious problem.')?.text).toBe('serious')
  })
})

describe('sample package', () => {
  const parsed = parseImport(sampleText)

  it('parses with no errors or warnings', () => {
    const problems = parsed.items.filter((i) => i.status !== 'ok').map((i) => `${i.lineNo}: ${i.messages.join(' ')}`)
    expect(problems).toEqual([])
  })

  it('has at least two items per tense and several of each other type', () => {
    for (const t of ALL_TENSES) {
      expect(parsed.items.filter((i) => i.content?.type === 'tense' && i.content.fields.tense === t).length, t).toBeGreaterThanOrEqual(2)
    }
    for (const type of ['vocab', 'fix', 'natural', 'sentence'] as const) {
      expect(parsed.items.filter((i) => i.content?.type === type).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('every tense item gets its multiple choice at L1 (the conjugator can build it)', () => {
    const notes = parsed.items.filter((i) => i.content).map((i, k) => ({ ...note(i.content!, `s${k}`), tags: i.tags }))
    const pool = createPool(notes)
    for (const n of notes.filter((x) => x.type === 'tense')) {
      const card = reconcileCards(n, [], 0).add[0]!
      expect(buildPrompt(n, card, { promptLanguage: 'english', pool }).exercise, n.type === 'tense' ? n.fields.sentence : '').toBe('tense-choose')
    }
  })
})
