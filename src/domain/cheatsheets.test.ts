import { allSignals, cheatSheetFor, DEFAULT_CHEATSHEETS, highlightSignals } from './cheatsheets'
import { ALL_TENSES } from './tags'

it('ships a complete default cheat-sheet for each of the 12 tenses', () => {
  expect(Object.keys(DEFAULT_CHEATSHEETS).sort()).toEqual([...ALL_TENSES].sort())
  for (const t of ALL_TENSES) {
    const s = DEFAULT_CHEATSHEETS[t]
    expect(s.form, t).not.toBe('')
    expect(s.use, t).not.toBe('')
    expect(s.signals.length, t).toBeGreaterThanOrEqual(3)
    expect(s.examples.every((e) => /^[A-Z].*[.!?]$/.test(e)), t).toBe(true)
  }
})

it('user edits override the default', () => {
  const custom = { form: 'f', use: 'u', signals: ['x'], examples: ['A.', 'B.'] as [string, string] }
  expect(cheatSheetFor('past-simple', { 'past-simple': custom })).toBe(custom)
  expect(cheatSheetFor('past-simple', undefined)).toBe(DEFAULT_CHEATSHEETS['past-simple'])
})

it('highlights whole-word signal phrases, longest first', () => {
  const signals = allSignals(undefined)
  const parts = highlightSignals('By the time we arrived, the movie had started. Since then, nothing.', signals)
  expect(parts.filter((p) => p.signal).map((p) => p.text)).toEqual(['By the time', 'Since'])
  // "for" inside "before" or "forecast" is not a match.
  expect(highlightSignals('a forecast', ['for']).some((p) => p.signal)).toBe(false)
})
