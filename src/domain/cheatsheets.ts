import type { TenseName } from './types'

export interface CheatSheet {
  form: string
  use: string
  signals: string[]
  examples: [string, string]
}

/** Shipped defaults; the user can edit any of them (stored as overrides). */
export const DEFAULT_CHEATSHEETS: Record<TenseName, CheatSheet> = {
  'present-simple': {
    form: 'base verb; he/she/it + -s (works, goes, studies)',
    use: 'Habits and routines, facts and general truths, timetables.',
    signals: ['always', 'usually', 'often', 'sometimes', 'never', 'every day', 'on Fridays', 'generally'],
    examples: ['She works from home on Fridays.', 'Inflation usually rises when demand grows faster than supply.'],
  },
  'present-continuous': {
    form: 'am / is / are + -ing',
    use: 'Happening now; temporary situations around now; fixed future arrangements.',
    signals: ['now', 'right now', 'at the moment', 'currently', 'this week', 'these days', 'Look!'],
    examples: ["I'm preparing for an exam this week.", "We're meeting the client tomorrow at ten."],
  },
  'present-perfect': {
    form: 'have / has + past participle',
    use: 'A past action that matters now: experience, result, or an unfinished time period. No finished time word.',
    signals: ['already', 'yet', 'just', 'ever', 'never', 'so far', 'recently', 'this year', 'since', 'for'],
    examples: ["I've read that book three times so far.", 'The central bank has raised rates twice this year.'],
  },
  'present-perfect-continuous': {
    form: 'have / has been + -ing',
    use: 'An activity that started in the past and is still going on (focus on duration), or just stopped with a visible result.',
    signals: ['for', 'since', 'all day', 'lately', 'recently', 'how long'],
    examples: ["I've been working here for five years.", "She's been studying English since she was a child."],
  },
  'past-simple': {
    form: 'past form (worked, went)',
    use: 'A finished action at a finished time; a sequence of past events.',
    signals: ['yesterday', 'last week', 'last year', 'ago', 'in 2019', 'when I was'],
    examples: ['The central bank raised rates last week.', 'We met at a conference in Berlin in 2019.'],
  },
  'past-continuous': {
    form: 'was / were + -ing',
    use: 'An action in progress at a past moment; the background that a shorter action interrupts.',
    signals: ['while', 'when', 'at that moment', 'at eight last night', 'all evening'],
    examples: ['I was cooking dinner when the phone rang.', 'At eight last night, they were watching the debate.'],
  },
  'past-perfect': {
    form: 'had + past participle',
    use: 'An action completed before another past action or time (the earlier past).',
    signals: ['by the time', 'before', 'after', 'already', 'by then', 'by 2010'],
    examples: ['By the time we arrived, the movie had started.', 'He realized that he had left his keys at the office.'],
  },
  'past-perfect-continuous': {
    form: 'had been + -ing',
    use: 'How long an activity had been going on up to a past moment, or the cause of a past situation.',
    signals: ['for', 'since', 'how long', 'by the time', 'before'],
    examples: ['They had been waiting for an hour when the bus finally came.', 'Her eyes were red because she had been crying.'],
  },
  'future-simple': {
    form: 'will + base verb',
    use: 'Predictions based on opinion, decisions made at the moment of speaking, offers and promises.',
    signals: ['I think', 'probably', "I'm sure", 'tomorrow', 'next year', 'soon'],
    examples: ['I think prices will go up next year.', "Don't worry, I'll help you with the report."],
  },
  'future-continuous': {
    form: 'will be + -ing',
    use: 'An action that will be in progress at a specific future moment.',
    signals: ['this time tomorrow', 'this time next year', 'at nine tonight', 'when you arrive'],
    examples: ["This time tomorrow, I'll be flying to London.", "Don't call at nine; we'll be having dinner."],
  },
  'future-perfect': {
    form: 'will have + past participle',
    use: 'An action that will be completed before a future time.',
    signals: ['by', 'by the time', 'by then', 'by next June', 'before'],
    examples: ["By next June, I'll have finished my degree.", 'The project will have ended by the time you get back.'],
  },
  'future-perfect-continuous': {
    form: 'will have been + -ing',
    use: 'How long an activity will have been going on at a future point.',
    signals: ['for … by', 'by the time', 'by next year', 'by December'],
    examples: ['By December, she will have been working at the bank for ten years.', 'In May, we will have been living here for exactly two years.'],
  },
}

export type CheatSheetOverrides = Partial<Record<TenseName, CheatSheet>>

export function cheatSheetFor(tense: TenseName, overrides: CheatSheetOverrides | undefined): CheatSheet {
  return overrides?.[tense] ?? DEFAULT_CHEATSHEETS[tense]
}

/** All signal words/phrases across the 12 sheets, longest first (for highlighting). */
export function allSignals(overrides: CheatSheetOverrides | undefined): string[] {
  const set = new Set<string>()
  for (const t of Object.keys(DEFAULT_CHEATSHEETS) as TenseName[]) {
    for (const s of cheatSheetFor(t, overrides).signals) {
      const clean = s.replace(/[!…]/g, '').trim()
      if (clean.length >= 3 && !clean.includes('…')) set.add(clean.toLowerCase())
    }
  }
  return [...set].sort((a, b) => b.length - a.length)
}

export type Highlighted = Array<{ text: string; signal: boolean }>

/** Split text into plain and signal-phrase parts (whole words, case-insensitive). */
export function highlightSignals(text: string, signals: readonly string[]): Highlighted {
  if (!signals.length || !text) return [{ text, signal: false }]
  const escaped = signals.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  const re = new RegExp(`(?<![\\p{L}'])(${escaped.join('|')})(?![\\p{L}'])`, 'giu')
  const out: Highlighted = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), signal: false })
    out.push({ text: m[0], signal: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), signal: false })
  return out
}
