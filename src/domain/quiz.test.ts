import { pickQuizQuestions, quizFormat, quizTagTrends } from './quiz'
import { emptyFsrs } from './scheduler'
import { maturity, streak, trueRetention } from './stats'
import type { Card, Note, QuizResult, ReviewLog } from './types'
import { seededRandom } from './util'

const NOW = new Date(2026, 9, 18, 12).getTime()
const DAY = 86_400_000

const note = (id: string, extra: Partial<Note> = {}): Note =>
  ({ id, type: 'fix', fields: { wrong: 'a', right: 'b', rule: '' }, tags: ['x'], packageId: 'p1', createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null, ...extra }) as Note
const card = (id: string, noteId: string, template: string, extra: Partial<Card> = {}): Card => ({
  id,
  noteId,
  template,
  order: 0,
  fsrs: emptyFsrs(0),
  suspended: false,
  buriedUntil: null,
  leech: false,
  unlocked: true,
  contentHash: '',
  priority: false,
  createdAt: 0,
  ...extra,
})
const log = (cardId: string, noteId: string, ts: number, correct: boolean, stateBefore: 0 | 2 = 2): ReviewLog => ({
  id: `${cardId}-${ts}`,
  cardId,
  noteId,
  template: 't',
  timestamp: ts,
  rating: correct ? 3 : 1,
  correct,
  responseMs: 5000,
  mode: 'session',
  userAnswer: null,
  scheduled: true,
  cardBefore: card(cardId, noteId, 't', { fsrs: { ...emptyFsrs(0), state: stateBefore } }),
  effects: { buried: [], unlocked: [] },
})

describe('quiz', () => {
  it('maps templates to formats; self-graded ones are excluded', () => {
    expect(quizFormat('which-is-right')).toBe('choice')
    expect(quizFormat('cloze:2')).toBe('cloze')
    expect(quizFormat('correct-it')).toBe('production')
    expect(quizFormat('recog')).toBeNull()
  })

  const notes = [note('a'), note('b', { packageId: 'p2', tags: ['y'] }), note('c', { suspended: true }), note('d', { deletedAt: 1 })]
  const cards = [
    card('a1', 'a', 'which-is-right'),
    card('a2', 'a', 'correct-it', { unlocked: false }),
    card('b1', 'b', 'which-is-right', { fsrs: { ...emptyFsrs(0), lapses: 3, state: 2, due: NOW + 9 * DAY } }),
    card('c1', 'c', 'which-is-right'),
    card('d1', 'd', 'which-is-right'),
  ]
  const base = { notes, cards, logs: [], now: NOW, dayEndTs: NOW + DAY, rand: seededRandom('q') }

  it('filters by source and skips suspended / trashed notes', () => {
    const all = pickQuizQuestions({ ...base, config: { source: { kind: 'random' }, length: 10, formats: ['choice', 'cloze', 'production'], timerSeconds: null } })
    expect(all.map((q) => q.note.id).sort()).toEqual(['a', 'b'])
    const pkg = pickQuizQuestions({ ...base, config: { source: { kind: 'package', packageId: 'p2' }, length: 10, formats: ['choice'], timerSeconds: null } })
    expect(pkg.map((q) => q.note.id)).toEqual(['b'])
    const weak = pickQuizQuestions({ ...base, config: { source: { kind: 'weak' }, length: 10, formats: ['choice'], timerSeconds: null } })
    expect(weak.map((q) => q.note.id)).toEqual(['b'])
  })

  it('respects the format mix and may use locked templates', () => {
    const q = pickQuizQuestions({ ...base, config: { source: { kind: 'tag', tag: 'x' }, length: 10, formats: ['production'], timerSeconds: null } })
    expect(q.map((x) => x.card.id)).toEqual(['a2'])
  })

  it('caps the length', () => {
    const q = pickQuizQuestions({ ...base, config: { source: { kind: 'random' }, length: 1, formats: ['choice'], timerSeconds: null } })
    expect(q).toHaveLength(1)
  })

  it('builds per-tag score trends', () => {
    const r = (ts: number, results: Array<[string, boolean]>): QuizResult => ({
      id: String(ts),
      timestamp: ts,
      config: { source: { kind: 'random' }, length: 2, formats: ['choice'], timerSeconds: null },
      questions: results.map(([tag, correct]) => ({ cardId: 'c', noteId: 'n', template: 't', correct, userAnswer: '', expected: '', tags: [tag] })),
      score: 0,
      durationMs: 0,
    })
    expect(quizTagTrends([r(2, [['x', true]]), r(1, [['x', false], ['x', true]])])).toEqual([{ tag: 'x', points: [0.5, 1] }])
  })
})

describe('stats', () => {
  it('counts the streak through yesterday when nothing is done today', () => {
    const logs = [log('c', 'n', NOW - DAY, true), log('c', 'n', NOW - 2 * DAY, true), log('c', 'n', NOW - 4 * DAY, true)]
    expect(streak(logs, NOW, 4)).toBe(2)
    expect(streak([...logs, log('c', 'n', NOW, true)], NOW, 4)).toBe(3)
    expect(streak([], NOW, 4)).toBe(0)
  })

  it('true retention only counts reviews of learned cards', () => {
    const logs = [log('c', 'n', NOW, true), log('c', 'n', NOW, false), log('c', 'n', NOW, false, 0)]
    expect(trueRetention(logs, NOW - DAY)).toEqual({ rate: 0.5, n: 2 })
  })

  it('splits cards by maturity', () => {
    const m = maturity([
      card('1', 'n', 't'),
      card('2', 'n', 't', { fsrs: { ...emptyFsrs(0), state: 1 } }),
      card('3', 'n', 't', { fsrs: { ...emptyFsrs(0), state: 2, scheduledDays: 5 } }),
      card('4', 'n', 't', { fsrs: { ...emptyFsrs(0), state: 2, scheduledDays: 30 } }),
      card('5', 'n', 't', { unlocked: false }),
      card('6', 'n', 't', { suspended: true }),
    ])
    expect(m).toEqual({ new: 1, learning: 1, young: 1, mature: 1, locked: 1, suspended: 1 })
  })
})
