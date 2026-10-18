import sampleText from '../../samples/sample-package.txt?raw'
import { parseImport } from './parser'
import { buildPrompt } from './prompt'
import { emptyFsrs } from './scheduler'
import { ALL_TENSES } from './tags'
import { cardsToUnlock, contentChunks, findTermInExample, naturalKeyPhrase, reconcileCards, templatesFor } from './templates'
import type { Card, Note, NoteContent } from './types'

const note = (content: NoteContent, id = 'n1'): Note =>
  ({ ...content, id, tags: [], packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note

describe('templatesFor', () => {
  it('vocab: recog → cloze-use → produce → dictation, cloze-use only with a matching example', () => {
    const v: NoteContent = { type: 'vocab', fields: { term: 'reluctant', definition: 'unwilling', examples: ['He was reluctant to go.'] } }
    expect(templatesFor(v).map((t) => [t.template, t.order])).toEqual([
      ['recog', 0],
      ['cloze-use', 1],
      ['produce', 2],
      ['dictation', 3],
    ])
    const noEx: NoteContent = { type: 'vocab', fields: { term: 'reluctant', definition: 'unwilling', examples: [] } }
    expect(templatesFor(noEx).map((t) => [t.template, t.order])).toEqual([
      ['recog', 0],
      ['produce', 1],
      ['dictation', 2],
    ])
  })
  it('cloze: one independent card per cloze', () => {
    const c: NoteContent = { type: 'cloze', fields: { text: '{{a}} and {{b}} and {{c}}' } }
    expect(templatesFor(c).map((t) => [t.template, t.order])).toEqual([
      ['cloze:1', 0],
      ['cloze:2', 0],
      ['cloze:3', 0],
    ])
  })
  it('other types follow their chains', () => {
    expect(templatesFor({ type: 'fix', fields: { wrong: 'a', right: 'b', rule: '' } }).map((t) => t.template)).toEqual(['which-is-right', 'correct-it'])
    expect(templatesFor({ type: 'tense', fields: { sentence: 'I {{went::go}}.', tense: 'past-simple' } }).map((t) => t.template)).toEqual([
      'tense-choose',
      'tense-fill',
    ])
    expect(templatesFor({ type: 'sentence', fields: { text: 'It depends on you.' } }).map((t) => t.template)).toEqual(['chunk-cloze', 'recall-full', 'speak'])
    expect(templatesFor({ type: 'natural', fields: { mine: 'very big problem', natural: 'serious problem' } }).map((t) => t.template)).toEqual([
      'upgrade',
      'natural-cloze',
    ])
  })
})

describe('helpers', () => {
  it('finds inflected terms in examples', () => {
    expect(findTermInExample('follow through', 'He rarely follows through.')?.match).toBe('follows through')
    expect(findTermInExample('leverage', 'We leveraged our data.')?.match).toBe('leveraged')
    expect(findTermInExample('cat', 'The category is wide.')).toBeNull()
    expect(findTermInExample('go', 'She {{went}} home.')?.match).toBe('went')
  })
  it('picks content-word chunks', () => {
    expect(contentChunks("The trade-off isn't as clear-cut as it looks.").map((c) => c.text)).toEqual(['trade-off', 'clear-cut', 'looks.'])
  })
  it('finds the key phrase of a natural version', () => {
    expect(naturalKeyPhrase('This is a very big problem.', 'This is a serious problem.')?.text).toBe('serious')
  })
})

describe('reconcile and unlock', () => {
  const n = note({ type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } })

  it('creates cards with only the first unlocked', () => {
    const r = reconcileCards(n, [], 0, [2, 5, 14])
    expect(r.add.map((c) => [c.template, c.unlocked])).toEqual([
      ['which-is-right', true],
      ['correct-it', false],
    ])
  })

  it('unlocks the next template once stability reaches the threshold', () => {
    const [a, b] = reconcileCards(n, [], 0, [2, 5, 14]).add as [Card, Card]
    expect(cardsToUnlock([a, b], [2, 5, 14])).toEqual([])
    const stable = { ...a, fsrs: { ...a.fsrs, stability: 2.3, state: 2 as const } }
    expect(cardsToUnlock([stable, b], [2, 5, 14])).toEqual([b.id])
  })

  it('keeps scheduling when content is unchanged and resets when it changes', () => {
    const cards = reconcileCards(n, [], 0, [2, 5, 14]).add.map((c) => ({ ...c, fsrs: { ...c.fsrs, reps: 3, state: 2 as const, stability: 1 } }))
    expect(reconcileCards({ ...n, tags: ['x'] } as Note, cards, 10, [2, 5, 14])).toEqual({ add: [], update: [], remove: [] })
    const edited = note({ type: 'fix', fields: { wrong: 'a b', right: 'c e', rule: 'r' } })
    const r = reconcileCards(edited, cards, 10, [2, 5, 14])
    expect(r.update).toHaveLength(2)
    expect(r.update.every((c) => c.fsrs.reps === 0)).toBe(true)
  })

  it('removes cards whose template no longer applies', () => {
    const v = note({ type: 'cloze', fields: { text: '{{a}} {{b}}' } })
    const cards = reconcileCards(v, [], 0, [2, 5, 14]).add
    const r = reconcileCards(note({ type: 'cloze', fields: { text: '{{a}} b' } }), cards, 1, [2, 5, 14])
    expect(r.remove).toEqual([cards[1]!.id])
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

  it('every tense item gets a multiple-choice prompt from the conjugator', () => {
    for (const item of parsed.items) {
      if (item.content?.type !== 'tense') continue
      const n = note(item.content)
      const card = { ...reconcileCards(n, [], 0, [2, 5, 14]).add[0]!, fsrs: emptyFsrs(0) }
      const p = buildPrompt(n, card, { promptLanguage: 'english' })
      expect(p.kind, item.raw).toBe('choice')
    }
  })
})
