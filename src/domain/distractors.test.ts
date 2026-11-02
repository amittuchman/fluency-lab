import { gapFragment, isFullSentence, repairDistractors, sentenceDistractors, spliceFragment } from './distractors'
import type { Note, NoteContent } from './types'

const note = (content: NoteContent): Note =>
  ({ ...content, id: 'n', tags: [], packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note

const RIGHT = 'I have studied PPE for two and a half years.'
const WRONG = 'I study PPE for two and a half years.'

describe('fragment or sentence', () => {
  it('tells a fragment from a whole sentence', () => {
    expect(isFullSentence('have study', RIGHT)).toBe(false)
    expect(isFullSentence('I have study PPE for two and a half years.', RIGHT)).toBe(true)
    expect(isFullSentence('It depends from the situation.', 'It depends on the situation.')).toBe(true)
    expect(isFullSentence('from', 'It depends on the situation.')).toBe(false)
  })
})

describe('splicing a fragment into the correct sentence', () => {
  it('replaces the part it corresponds to (the reported bug)', () => {
    expect(spliceFragment('have study', RIGHT, WRONG)).toBe('I have study PPE for two and a half years.')
    expect(spliceFragment('have studying', RIGHT, WRONG)).toBe('I have studying PPE for two and a half years.')
  })
  it('with no shared word, takes the place of what the fix changed', () => {
    expect(spliceFragment('from', 'It depends on the situation.', 'It depends of the situation.')).toBe('It depends from the situation.')
    expect(spliceFragment('heavy', 'This is a serious problem.', 'This is a very big problem.')).toBe('This is a heavy problem.')
  })
  it('keeps the final punctuation and the capital letter', () => {
    expect(spliceFragment('two years and half', RIGHT, WRONG)).toBe('I have studied PPE for two years and half.')
    expect(spliceFragment('i has', 'I have a question.', 'I has a question.')).toBe('I has a question.')
  })
  it('gives up when there is no sensible place, or the result is the correct sentence', () => {
    expect(spliceFragment('banana', 'We discussed the budget.', 'We discussed about the budget.')).toBeNull() // nothing changed in "right" to replace
    expect(spliceFragment('which nobody had ever noticed before', RIGHT, WRONG)).toBeNull() // no shared word, far longer than the change
    expect(spliceFragment('have studied', RIGHT, WRONG)).toBeNull()
  })
})

describe('options of a sentence choice', () => {
  const fix = note({ type: 'fix', fields: { wrong: WRONG, right: RIGHT, rule: 'r', distractors: ['have study', 'have studying', 'I studied PPE for two and a half years.', 'which nobody had ever noticed before'] } })
  it('every option is a whole sentence; fragments that cannot be placed are left out', () => {
    expect(sentenceDistractors(fix)).toEqual([
      'I have study PPE for two and a half years.',
      'I have studying PPE for two and a half years.',
      'I studied PPE for two and a half years.',
    ])
  })
  it('never repeats the correct or the original sentence', () => {
    const n = note({ type: 'fix', fields: { wrong: 'It depends of it.', right: 'It depends on it.', rule: 'r', distractors: ['of', 'on', 'It depends on it.'] } })
    expect(sentenceDistractors(n)).toEqual([])
  })
})

describe('gap options', () => {
  it('a whole sentence is cut down to the part in the gap', () => {
    expect(gapFragment('The bank rose rates last week.', 'The bank ', ' rates last week.')).toBe('rose')
    expect(gapFragment('Something else entirely here.', 'The bank ', ' rates last week.')).toBeNull()
  })
})

describe('data repair', () => {
  it('rewrites fragments as sentences, keeps everything else as it is, and is a no-op the second time', () => {
    const fix = note({ type: 'fix', fields: { wrong: WRONG, right: RIGHT, rule: 'r', distractors: ['have study', 'I studied PPE for two and a half years.', 'which nobody had ever noticed before'] } })
    const repaired = repairDistractors(fix)!
    expect(repaired.fields).toEqual({ ...fix.fields, distractors: ['I have study PPE for two and a half years.', 'I studied PPE for two and a half years.', 'which nobody had ever noticed before'] })
    expect(repairDistractors(repaired)).toBeNull()
  })
  it('leaves other item types and items without fragments alone', () => {
    expect(repairDistractors(note({ type: 'cloze', fields: { text: 'A {{b}} c.', distractors: ['d'] } }))).toBeNull()
    expect(repairDistractors(note({ type: 'natural', fields: { mine: 'a b c', natural: 'a d c', distractors: ['a e c'] } }))).toBeNull()
  })
})
