import { checkAnswer, expandContractions, levenshtein, normalizeAnswer, suggestedGrade, wordDiff } from './checker'

describe('normalization', () => {
  it('ignores case, spacing, curly quotes and edge punctuation', () => {
    expect(normalizeAnswer('  The  Trade-off isn’t clear.  ')).toBe('the trade-off is not clear')
  })
  it('expands unambiguous contractions, keeping capital I', () => {
    expect(expandContractions("I've seen it, they're here, we can't go")).toBe('I have seen it, they are here, we cannot go')
    expect(expandContractions("I won't")).toBe('I will not')
  })
  it("leaves ambiguous 's and 'd alone", () => {
    expect(expandContractions("He's left and she'd gone")).toBe("He's left and she'd gone")
  })
})

describe('checkAnswer', () => {
  const exact = { typoTolerance: false }
  const tolerant = { typoTolerance: true }

  it('treats contractions as equal to expanded forms', () => {
    expect(checkAnswer('I have been working', ["I've been working"], exact).verdict).toBe('correct')
    expect(checkAnswer('it is not clear', ["it isn't clear"], exact).verdict).toBe('correct')
    expect(checkAnswer('can not', ['cannot'], exact).verdict).toBe('correct')
  })
  it("requires 's and 'd to match exactly", () => {
    expect(checkAnswer('he has gone', ["he's gone"], exact).verdict).toBe('wrong')
    expect(checkAnswer('I would go', ["I'd go"], exact).verdict).toBe('wrong')
  })
  it('accepts any alternative', () => {
    expect(checkAnswer('put up', ['raised//put up'], exact).verdict).toBe('correct')
    expect(checkAnswer('raised', ['increased', 'raised'], exact).verdict).toBe('correct')
  })
  it('ignores trailing punctuation', () => {
    expect(checkAnswer('I completely agree with you', ['I completely agree with you.'], exact).verdict).toBe('correct')
  })
  it('marks a 1-letter typo on a 5+ letter word as almost only when tolerant', () => {
    expect(checkAnswer('reluctent', ['reluctant'], tolerant).verdict).toBe('almost')
    expect(checkAnswer('reluctent', ['reluctant'], exact).verdict).toBe('wrong')
    expect(checkAnswer('cat', ['cut'], tolerant).verdict).toBe('wrong')
    expect(checkAnswer('relactent', ['reluctant'], tolerant).verdict).toBe('wrong')
  })
  it('empty answer is wrong', () => {
    expect(checkAnswer('', ['hello'], exact).verdict).toBe('wrong')
  })
  it('suggests grades', () => {
    expect(suggestedGrade('wrong')).toBe(1)
    expect(suggestedGrade('almost')).toBe(2)
    expect(suggestedGrade('correct')).toBe(3)
  })
})

describe('wordDiff', () => {
  it('marks missing, extra and wrong words', () => {
    expect(wordDiff('I very agree with you', 'I completely agree with you')).toEqual([
      { kind: 'equal', text: 'I' },
      { kind: 'wrong', text: 'very', expected: 'completely' },
      { kind: 'equal', text: 'agree' },
      { kind: 'equal', text: 'with' },
      { kind: 'equal', text: 'you' },
    ])
    expect(wordDiff('I agree', 'I fully agree')).toContainEqual({ kind: 'missing', text: 'fully' })
    expect(wordDiff('I really agree', 'I agree')).toContainEqual({ kind: 'extra', text: 'really' })
  })
})

it('levenshtein', () => {
  expect(levenshtein('kitten', 'sitting')).toBe(3)
  expect(levenshtein('abc', 'abc')).toBe(0)
})
