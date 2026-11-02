import type { Card, Grade, Level, Note } from './types'

/**
 * Every item has a level, which decides the *form* of the exercise; FSRS still decides *when* it comes back.
 *   L1 recognize (choose / flashcard)   L2 guided production   L3 free production / transformation
 *   L4 spot the error / mixed items     L5 produce from Hebrew or a situation, no support
 */
export const MIN_LEVEL: Level = 1
export const MAX_LEVEL: Level = 5
/** Clean answers in a row to move up; mistakes in a row to move down. */
export const STEP_UP_AFTER = 2
export const STEP_DOWN_AFTER = 2
/** After this long without seeing an item, its first exercise is a recall (produce the answer). */
export const LONG_BREAK_DAYS = 7

const DAY = 86_400_000

export interface LevelState {
  level: Level
  cleanStreak: number
  missStreak: number
}

export function levelOf(card: Pick<Card, 'level' | 'cleanStreak' | 'missStreak'>): LevelState {
  return { level: card.level ?? MIN_LEVEL, cleanStreak: card.cleanStreak ?? 0, missStreak: card.missStreak ?? 0 }
}

/**
 * Apply one graded answer. Clean = Good/Easy; mistake = Again; Hard (partly right) breaks a clean run
 * without counting as a mistake.
 */
export function nextLevel(state: LevelState, grade: Grade): LevelState {
  if (grade >= 3) {
    const clean = state.cleanStreak + 1
    if (clean >= STEP_UP_AFTER && state.level < MAX_LEVEL) return { level: (state.level + 1) as Level, cleanStreak: 0, missStreak: 0 }
    return { level: state.level, cleanStreak: Math.min(clean, STEP_UP_AFTER), missStreak: 0 }
  }
  if (grade === 1) {
    const miss = state.missStreak + 1
    if (miss >= STEP_DOWN_AFTER && state.level > MIN_LEVEL) return { level: (state.level - 1) as Level, cleanStreak: 0, missStreak: 0 }
    return { level: state.level, cleanStreak: 0, missStreak: Math.min(miss, STEP_DOWN_AFTER) }
  }
  return { level: state.level, cleanStreak: 0, missStreak: state.missStreak }
}

/** True when the item hasn't been seen for LONG_BREAK_DAYS: start with recall, not recognition or a blank. */
export function isLongBreak(card: Pick<Card, 'fsrs'>, now: number): boolean {
  const last = card.fsrs.lastReview
  return last !== null && now - last >= LONG_BREAK_DAYS * DAY
}

/**
 * The mistake pattern an item belongs to, so related mistakes are drilled together:
 * an explicit `pattern:` from the import, else the tense, else the rule text, else none.
 */
export function patternKey(note: Note): string {
  const explicit = note.tags.find((t) => t.startsWith('pattern:'))
  if (explicit) return explicit
  if (note.type === 'tense') return `tense:${note.fields.tense}`
  const rule = note.fields.rule
  if (rule && rule.trim()) return `rule:${rule.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
  return ''
}
