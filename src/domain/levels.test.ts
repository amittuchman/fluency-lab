import { isLongBreak, levelOf, nextLevel, patternKey, type LevelState } from './levels'
import { emptyFsrs } from './scheduler'
import type { Grade, Note, NoteContent } from './types'

const DAY = 86_400_000
const run = (start: LevelState, grades: Grade[]) => grades.reduce(nextLevel, start)
const at = (level: 1 | 2 | 3 | 4 | 5): LevelState => ({ level, cleanStreak: 0, missStreak: 0 })

describe('levels', () => {
  it('a card without a level (older data) starts at L1', () => {
    expect(levelOf({})).toEqual({ level: 1, cleanStreak: 0, missStreak: 0 })
  })
  it('up one level after 2 clean answers in a row', () => {
    expect(run(at(1), [3])).toEqual({ level: 1, cleanStreak: 1, missStreak: 0 })
    expect(run(at(1), [3, 4])).toEqual(at(2))
    expect(run(at(1), [3, 3, 3, 3]).level).toBe(3)
  })
  it('down one level after 2 mistakes in a row', () => {
    expect(run(at(3), [1])).toEqual({ level: 3, cleanStreak: 0, missStreak: 1 })
    expect(run(at(3), [1, 1])).toEqual(at(2))
  })
  it('a mistake breaks a clean run, and a clean answer breaks a mistake run', () => {
    expect(run(at(2), [3, 1, 3]).level).toBe(2)
    expect(run(at(2), [1, 3, 1]).level).toBe(2)
  })
  it('Hard (partly right) is neither clean nor a mistake', () => {
    expect(run(at(2), [3, 2, 3]).level).toBe(2)
    expect(run(at(2), [1, 2, 1]).level).toBe(1)
  })
  it('stays within L1–L5', () => {
    expect(run(at(5), [4, 4, 4]).level).toBe(5)
    expect(run(at(1), [1, 1, 1]).level).toBe(1)
  })
})

describe('long break', () => {
  const now = 100 * DAY
  it('7+ days since the last answer counts as a long break; never-seen does not', () => {
    expect(isLongBreak({ fsrs: { ...emptyFsrs(0), lastReview: now - 7 * DAY } }, now)).toBe(true)
    expect(isLongBreak({ fsrs: { ...emptyFsrs(0), lastReview: now - 6 * DAY } }, now)).toBe(false)
    expect(isLongBreak({ fsrs: emptyFsrs(0) }, now)).toBe(false)
  })
})

describe('mistake patterns', () => {
  const note = (content: NoteContent, tags: string[] = []): Note =>
    ({ ...content, id: 'n', tags, packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note
  it('an explicit pattern wins, then the tense, then the rule', () => {
    expect(patternKey(note({ type: 'fix', fields: { wrong: 'a', right: 'b', rule: 'r' } }, ['pattern:depend-on']))).toBe('pattern:depend-on')
    expect(patternKey(note({ type: 'tense', fields: { sentence: 'I {{went::go}}.', tense: 'past-simple' } }))).toBe('tense:past-simple')
    expect(patternKey(note({ type: 'fix', fields: { wrong: 'a', right: 'b', rule: '"Depend" takes "on".' } }))).toBe('rule:depend takes on')
    expect(patternKey(note({ type: 'sentence', fields: { text: 'Hi.' } }))).toBe('')
  })
  it('the same rule written with different case or punctuation is one pattern', () => {
    const a = note({ type: 'fix', fields: { wrong: 'a', right: 'b', rule: 'Depend takes ON' } })
    const b = note({ type: 'fix', fields: { wrong: 'c', right: 'd', rule: '"depend" takes "on".' } })
    expect(patternKey(a)).toBe(patternKey(b))
  })
})
