import { acceptedTwin, conjugate, detectTenses, guessPerson, ingForm, regularPast, tenseChoice, thirdPerson } from './conjugator'

describe('regular rules', () => {
  it.each([
    ['work', 'working', 'worked', 'works'],
    ['make', 'making', 'maked', 'makes'],
    ['stop', 'stopping', 'stopped', 'stops'],
    ['study', 'studying', 'studied', 'studies'],
    ['play', 'playing', 'played', 'plays'],
    ['lie', 'lying', 'lied', 'lies'],
    ['see', 'seeing', 'seed', 'sees'],
    ['watch', 'watching', 'watched', 'watches'],
    ['visit', 'visiting', 'visited', 'visits'],
    ['prefer', 'preferring', 'preferred', 'prefers'],
    ['fix', 'fixing', 'fixed', 'fixes'],
    ['open', 'opening', 'opened', 'opens'],
  ])('%s', (v, ing, past, s3) => {
    expect(ingForm(v)).toBe(ing)
    expect(regularPast(v)).toBe(past)
    expect(thirdPerson(v)).toBe(s3)
  })
})

describe('all 12 tenses on a regular verb', () => {
  it.each([
    ['present-simple', 'he', 'works'],
    ['present-continuous', 'I', 'am working'],
    ['present-perfect', 'he', 'has worked'],
    ['present-perfect-continuous', 'they', 'have been working'],
    ['past-simple', 'they', 'worked'],
    ['past-continuous', 'he', 'was working'],
    ['past-perfect', 'I', 'had worked'],
    ['past-perfect-continuous', 'he', 'had been working'],
    ['future-simple', 'they', 'will work'],
    ['future-continuous', 'I', 'will be working'],
    ['future-perfect', 'he', 'will have worked'],
    ['future-perfect-continuous', 'they', 'will have been working'],
  ] as const)('%s', (tense, person, form) => {
    expect(conjugate('work', tense, person)).toBe(form)
  })
})

describe('irregular verbs', () => {
  it.each([
    ['go', 'went', 'gone'], ['have', 'had', 'had'], ['do', 'did', 'done'], ['take', 'took', 'taken'],
    ['write', 'wrote', 'written'], ['begin', 'began', 'begun'], ['bring', 'brought', 'brought'], ['buy', 'bought', 'bought'],
    ['choose', 'chose', 'chosen'], ['come', 'came', 'come'], ['drink', 'drank', 'drunk'], ['drive', 'drove', 'driven'],
    ['eat', 'ate', 'eaten'], ['fall', 'fell', 'fallen'], ['feel', 'felt', 'felt'], ['find', 'found', 'found'],
    ['fly', 'flew', 'flown'], ['forget', 'forgot', 'forgotten'], ['give', 'gave', 'given'], ['know', 'knew', 'known'],
    ['leave', 'left', 'left'], ['lose', 'lost', 'lost'], ['make', 'made', 'made'], ['meet', 'met', 'met'],
    ['pay', 'paid', 'paid'], ['rise', 'rose', 'risen'], ['run', 'ran', 'run'], ['see', 'saw', 'seen'],
    ['speak', 'spoke', 'spoken'], ['teach', 'taught', 'taught'], ['think', 'thought', 'thought'],
  ] as const)('%s', (v, past, pp) => {
    expect(conjugate(v, 'past-simple', 'they')).toBe(past)
    expect(conjugate(v, 'past-perfect', 'he')).toBe(`had ${pp}`)
  })
  it('handles be by person', () => {
    expect(conjugate('be', 'present-simple', 'I')).toBe('am')
    expect(conjugate('be', 'past-simple', 'they')).toBe('were')
    expect(conjugate('be', 'present-continuous', 'he')).toBe('is being')
    expect(conjugate('be', 'present-perfect', 'he')).toBe('has been')
  })
  it('keeps phrasal particles', () => {
    expect(conjugate('give up', 'present-perfect', 'he')).toBe('has given up')
  })
})

it('detects the tense of a typed form', () => {
  expect(detectTenses('worked', 'work', 'I')).toEqual(['past-simple'])
  expect(detectTenses('have worked', 'work', 'I')).toEqual(['present-perfect'])
})

it('guesses the person from the subject', () => {
  expect(guessPerson('I')).toBe('I')
  expect(guessPerson('The central bank')).toBe('he')
  expect(guessPerson('Prices')).toBe('they')
  expect(guessPerson('By next June, she')).toBe('he')
  expect(guessPerson('I think prices')).toBe('they')
  expect(guessPerson('Inflation usually')).toBe('he')
})

describe('tenseChoice', () => {
  it('builds options with confusable distractors', () => {
    const c = tenseChoice({ verb: 'work', tense: 'present-perfect-continuous', answers: ['have been working'], before: 'I ' })!
    expect(c.options[0]).toBe('have been working')
    expect(c.options).toContain('have worked')
    expect(new Set(c.options).size).toBe(4)
  })
  it('with a duration phrase, never offers the perfect twin as a wrong option, and accepts it when typed', () => {
    const sentence = 'I have been working here for five years.'
    const c = tenseChoice({ verb: 'work', tense: 'present-perfect-continuous', answers: ['have been working'], before: 'I ', sentence })!
    expect(c.options).not.toContain('have worked')
    const info = { verb: 'work', tense: 'present-perfect-continuous' as const, before: 'I ', sentence }
    expect(acceptedTwin('have worked', info)).toBe('present-perfect')
    expect(acceptedTwin('worked', info)).toBeNull()
    expect(acceptedTwin('have worked', { ...info, sentence: 'I have been working hard.' })).toBeNull()
  })
  it('handles an adverb inside the verb phrase', () => {
    const c = tenseChoice({ verb: 'double', tense: 'past-perfect', answers: ['had already doubled'], before: 'When the law passed, prices ' })!
    expect(c.options[0]).toBe('had already doubled')
    expect(c.options).toContain('already doubled')
    expect(c.options).toContain('have already doubled')
    expect(detectTenses('have already doubled', 'double', 'they')).toEqual(['present-perfect'])
  })
  it('falls back (null) when the answer is not a plain affirmative form', () => {
    expect(tenseChoice({ verb: 'work', tense: 'present-perfect', answers: ["haven't worked"], before: 'I ' })).toBeNull()
    expect(tenseChoice({ verb: '', tense: 'past-simple', answers: ['went'], before: '' })).toBeNull()
  })
})
