import { checkAnswer, correctionWords, expandContractions, levenshtein, normalizeAnswer, suggestedGrade, wordDiff } from './checker'

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
  const exact = { typos: 'strict' } as const
  const tolerant = { typos: 'tolerate' } as const

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
  it('forgives small spelling slips (the target is speaking) and says which ones', () => {
    const r = checkAnswer('He was reluctent to commit', ['He was reluctant to commit.'], tolerant)
    expect(r.verdict).toBe('correct')
    expect(r.typos).toEqual([{ typed: 'reluctent', expected: 'reluctant' }])
    expect(checkAnswer('reluctent', ['reluctant'], exact).verdict).toBe('wrong')
    expect(checkAnswer('cat', ['cut'], tolerant).verdict).toBe('wrong') // too short to call it a typo
    expect(checkAnswer('rilactint', ['reluctant'], tolerant).verdict).toBe('wrong') // 3 letters off: not a slip
  })
  it('allows 2 slips in long words, 1 in medium ones', () => {
    expect(checkAnswer('acommodation', ['accommodation'], {}).verdict).toBe('correct')
    expect(checkAnswer('relactent', ['reluctant'], {}).verdict).toBe('correct') // 2 off in a 9-letter word
    expect(checkAnswer('agre', ['agree'], {}).verdict).toBe('correct') // 1 off in a short word
    expect(checkAnswer('agere', ['agree'], {}).verdict).toBe('wrong') // 2 off in a short word
  })
  it('a hyphen written as a space or left out is spelling, not a mistake', () => {
    const r = checkAnswer('The trade off is clear', ['The trade-off is clear.'], tolerant)
    expect(r.verdict).toBe('correct')
    expect(r.typos).toEqual([{ typed: 'trade off', expected: 'trade-off' }])
    expect(checkAnswer('tradeoff', ['trade-off'], tolerant).verdict).toBe('correct')
    expect(checkAnswer('trade off', ['trade-off'], exact).verdict).toBe('wrong') // #spelling items
    expect(checkAnswer('everyday', ['every day'], tolerant).verdict).toBe('wrong') // different words, no hyphen involved
  })
  it('never forgives a grammar change as a typo', () => {
    // inflections and irregular forms are the mistake, not spelling
    expect(checkAnswer('I work here', ['I worked here'], {}).verdict).toBe('wrong')
    expect(checkAnswer('prices rise last year', ['prices rose last year'], {}).verdict).toBe('wrong')
    expect(checkAnswer('two advices', ['two advice'], {}).verdict).toBe('wrong')
  })
  it('never forgives a slip on the protected words (the point of the exercise)', () => {
    expect(checkAnswer('It depends of the goverment', ['It depends on the government'], { protect: ['on'] }).verdict).toBe('wrong')
    expect(checkAnswer('It depends on the goverment', ['It depends on the government'], { protect: ['on'] }).verdict).toBe('correct')
    expect(checkAnswer('I have been wroking here', ['I have been working here'], { protect: ['working'] }).verdict).toBe('wrong')
  })
  it('meaning mode: a close answer that keeps the key words is "almost"; missing the key word is wrong', () => {
    const ref = ['I think this approach makes a lot of sense.']
    expect(checkAnswer('I think that this approach makes a lot of sense', ref, { mode: 'meaning', protect: ['makes'] }).verdict).toBe('almost')
    expect(checkAnswer('I think this approach is a lot of sense', ref, { mode: 'meaning', protect: ['makes'] }).verdict).toBe('wrong')
    expect(checkAnswer('I think this approach makes a lot of sense', ref, { mode: 'meaning' }).verdict).toBe('correct')
  })
  it('lists the actual correction words of a fix', () => {
    expect(correctionWords('I very agree with you.', 'I completely agree with you.')).toEqual(['completely'])
    expect(correctionWords('It depends of the situation.', 'It depends on the situation.')).toEqual(['on'])
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
