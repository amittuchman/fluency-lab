import { ALL_TENSES } from './tags'
import { IRREGULAR_VERBS } from './irregulars'
import type { TenseName } from './types'

/**
 * Best-effort conjugator: affirmative, active voice, 12 tenses.
 * Person groups: "I" (first singular), "he" (third singular), "they" (you/we/they and plural nouns).
 */
export type Person = 'I' | 'he' | 'they'

/** Two-syllable verbs stressed on the last syllable, which double the final consonant. */
const DOUBLING_TWO_SYLLABLE = new Set([
  'begin', 'prefer', 'refer', 'admit', 'commit', 'occur', 'permit', 'regret', 'control', 'forget', 'upset',
  'omit', 'equip', 'submit', 'transfer', 'compel', 'patrol', 'propel', 'deter', 'incur', 'infer', 'confer',
  'expel', 'excel', 'acquit', 'abet', 'rebut', 'recur', 'remit', 'emit', 'transmit', 'forbid',
])

/** Doubling of a final consonant: stop → stopp-, run → runn-, begin → beginn-. */
function shouldDouble(verb: string): boolean {
  if (DOUBLING_TWO_SYLLABLE.has(verb)) return true
  // One vowel group (treating "qu" as a consonant), ending in a single vowel + consonant other than w/x/y.
  const v = verb.replace(/^qu/, 'q')
  const groups = v.match(/[aeiou]+/g) ?? []
  if (groups.length !== 1) return false
  return /[^aeiou][aeiou][^aeiouwxy]$/.test(v) || /^[aeiou][^aeiouwxy]$/.test(v)
}

export function ingForm(verb: string): string {
  if (verb === 'be') return 'being'
  if (/ie$/.test(verb)) return verb.slice(0, -2) + 'ying'
  if (/[^aeiouy]e$/.test(verb) && !/(ee|ye|oe)$/.test(verb)) return verb.slice(0, -1) + 'ing'
  if (shouldDouble(verb)) return verb + verb.at(-1) + 'ing'
  return verb + 'ing'
}

export function regularPast(verb: string): string {
  if (verb.endsWith('e')) return verb + 'd'
  if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + 'ied'
  if (shouldDouble(verb)) return verb + verb.at(-1) + 'ed'
  return verb + 'ed'
}

export function thirdPerson(verb: string): string {
  if (verb === 'be') return 'is'
  if (verb === 'have') return 'has'
  if (/(s|x|z|ch|sh|o)$/.test(verb)) return verb + 'es'
  if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + 'ies'
  return verb + 's'
}

/** Past simple and past participle (primary form first; alternatives separated by "|"). */
export function principalParts(verb: string): { past: string; pp: string } {
  const irr = IRREGULAR_VERBS[verb]
  if (irr) return { past: irr[0], pp: irr[1] }
  const p = regularPast(verb)
  return { past: p, pp: p }
}

export function isKnownIrregular(verb: string): boolean {
  return verb in IRREGULAR_VERBS
}

function beForm(tense: 'present' | 'past', person: Person): string {
  if (tense === 'present') return person === 'I' ? 'am' : person === 'he' ? 'is' : 'are'
  return person === 'they' ? 'were' : 'was'
}

/**
 * All accepted forms of `verb` in a tense for a person. The first is the primary form.
 * Phrasal verbs keep their particle: "give up" → "has given up".
 */
export function conjugateAll(verbPhrase: string, tense: TenseName, person: Person): string[] {
  const [verb = '', ...rest] = verbPhrase.trim().toLowerCase().split(/\s+/)
  const tail = rest.length ? ' ' + rest.join(' ') : ''
  const { past, pp } = principalParts(verb)
  const ing = ingForm(verb)
  const have = person === 'he' ? 'has' : 'have'
  const alts = (prefix: string, forms: string) => forms.split('|').map((f) => `${prefix}${f}${tail}`)

  switch (tense) {
    case 'present-simple':
      if (verb === 'be') return [beForm('present', person) + tail]
      return [(person === 'he' ? thirdPerson(verb) : verb) + tail]
    case 'present-continuous':
      return [`${beForm('present', person)} ${ing}${tail}`]
    case 'present-perfect':
      return alts(`${have} `, pp)
    case 'present-perfect-continuous':
      return [`${have} been ${ing}${tail}`]
    case 'past-simple':
      if (verb === 'be') return [beForm('past', person) + tail]
      return alts('', past)
    case 'past-continuous':
      return [`${beForm('past', person)} ${ing}${tail}`]
    case 'past-perfect':
      return alts('had ', pp)
    case 'past-perfect-continuous':
      return [`had been ${ing}${tail}`]
    case 'future-simple':
      return [`will ${verb}${tail}`]
    case 'future-continuous':
      return [`will be ${ing}${tail}`]
    case 'future-perfect':
      return alts('will have ', pp)
    case 'future-perfect-continuous':
      return [`will have been ${ing}${tail}`]
  }
}

export function conjugate(verbPhrase: string, tense: TenseName, person: Person): string {
  return conjugateAll(verbPhrase, tense, person)[0]!
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim()

/** Which tenses (for the given person) produce this exact form. */
export function detectTenses(answer: string, verbPhrase: string, person: Person): TenseName[] {
  const a = norm(answer)
  return ALL_TENSES.filter((t) => conjugateAll(verbPhrase, t, person).some((f) => norm(f) === a))
}

const PRONOUNS: Record<string, Person> = {
  i: 'I',
  ...Object.fromEntries(
    'he she it this that everyone everybody someone somebody nobody anyone anybody nothing everything'
      .split(' ')
      .map((w) => [w, 'he' as Person]),
  ),
  ...Object.fromEntries('you we they these those people'.split(' ').map((w) => [w, 'they' as Person])),
}

const ADVERBS = new Set(
  'really always never usually often also just still already sometimes probably finally actually rarely seldom ever certainly definitely recently'.split(' '),
)

/** Guess the subject's person from the words before the verb. */
export function guessPerson(before: string): Person {
  const words = before
    .toLowerCase()
    .replace(/[^a-z'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  // The subject is the last word before the verb, skipping adverbs ("she usually", "prices often").
  let i = words.length - 1
  while (i > 0 && ADVERBS.has(words[i]!)) i--
  const subject = words[i] ?? ''
  const p = PRONOUNS[subject]
  if (p) return p
  if (/[^s]s$/.test(subject) && !/(us|is|ss)$/.test(subject)) return 'they'
  return 'he'
}

export interface TenseChoice {
  options: string[]
  correctIndex: number
  person: Person
}

/** Commonly confused tenses for each tense, most useful distractors first. */
const CONFUSABLE: Record<TenseName, TenseName[]> = {
  'present-simple': ['present-continuous', 'past-simple', 'present-perfect'],
  'present-continuous': ['present-simple', 'present-perfect-continuous', 'past-continuous'],
  'present-perfect': ['past-simple', 'present-perfect-continuous', 'present-simple'],
  'present-perfect-continuous': ['present-perfect', 'present-continuous', 'past-simple'],
  'past-simple': ['present-perfect', 'past-continuous', 'past-perfect'],
  'past-continuous': ['past-simple', 'past-perfect-continuous', 'present-continuous'],
  'past-perfect': ['past-simple', 'present-perfect', 'past-perfect-continuous'],
  'past-perfect-continuous': ['past-perfect', 'past-continuous', 'present-perfect-continuous'],
  'future-simple': ['present-simple', 'present-continuous', 'future-continuous'],
  'future-continuous': ['future-simple', 'present-continuous', 'future-perfect-continuous'],
  'future-perfect': ['future-simple', 'present-perfect', 'future-perfect-continuous'],
  'future-perfect-continuous': ['future-perfect', 'future-continuous', 'present-perfect-continuous'],
}

export function confusableTenses(t: TenseName): TenseName[] {
  return CONFUSABLE[t]
}

/**
 * Build a 4-option multiple choice for a tense cloze. Returns null when the conjugator cannot
 * reproduce the reference answer (negatives, questions, passives, unknown verbs): the caller
 * then falls back to typed input.
 */
export function tenseChoice(opts: { verb: string; tense: TenseName; answers: string[]; before: string }): TenseChoice | null {
  const verb = opts.verb.trim().toLowerCase()
  if (!verb || !/^[a-z]+( [a-z]+)?$/.test(verb)) return null
  const guessed = guessPerson(opts.before)
  const persons: Person[] = [guessed, ...(['I', 'he', 'they'] as Person[]).filter((p) => p !== guessed)]
  const answers = opts.answers.map(norm)
  const person = persons.find((p) => conjugateAll(verb, opts.tense, p).some((f) => answers.includes(norm(f))))
  if (!person) return null
  const correct = opts.answers[0]!
  const seen = new Set([norm(correct)])
  const distractors: string[] = []
  const order = [...CONFUSABLE[opts.tense], ...ALL_TENSES.filter((t) => t !== opts.tense && !CONFUSABLE[opts.tense].includes(t))]
  for (const t of order) {
    const f = conjugate(verb, t, person)
    if (seen.has(norm(f))) continue
    seen.add(norm(f))
    distractors.push(f)
    if (distractors.length === 3) break
  }
  return { options: [correct, ...distractors], correctIndex: 0, person }
}
