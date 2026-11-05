import { availableExercises, createPool, QUIZ_FORMAT, type ExerciseId } from './exercises'
import { isActiveCard } from './templates'
import type { Card, Note, QuizConfig, QuizFormat, QuizResult, QuizSource, ReviewLog } from './types'
import { groupBy, shuffle } from './util'

/** Quiz format of an exercise; flashcards, own sentences and speaking have no automatic check and are left out. */
export function quizFormat(exercise: string): QuizFormat | null {
  return QUIZ_FORMAT[exercise as ExerciseId] ?? null
}

export const FORMAT_LABELS: Record<QuizFormat, string> = {
  choice: 'Multiple choice',
  cloze: 'Fill the gap',
  production: 'Full production',
}

const DAY = 86_400_000

/** Weakness of a note: lapses plus recent misses. 0 = nothing weak about it. */
export function weaknessScore(cards: readonly Card[], logs: readonly ReviewLog[], now: number): number {
  const recent = logs.filter((l) => l.timestamp >= now - 30 * DAY)
  const misses = recent.filter((l) => !l.correct).length
  const lapses = cards.reduce((s, c) => s + c.fsrs.lapses, 0)
  const leech = cards.some((c) => c.leech) ? 3 : 0
  return lapses * 2 + misses + leech
}

export interface QuizQuestion {
  note: Note
  card: Card
  /** The exercise to ask (any level: a quiz is an assessment), in one of the chosen formats. */
  exercise: ExerciseId
}

export interface PickInput {
  notes: readonly Note[]
  cards: readonly Card[]
  logs: readonly ReviewLog[]
  config: QuizConfig
  now: number
  dayEndTs: number
  rand?: () => number
}

/** The packages / tags a quiz source draws from (one, in quizzes saved before multi-select). */
export function sourcePackageIds(s: Extract<QuizSource, { kind: 'package' }>): string[] {
  return s.packageIds ?? (s.packageId ? [s.packageId] : [])
}
export function sourceTags(s: Extract<QuizSource, { kind: 'tag' }>): string[] {
  return s.tags ?? (s.tag ? [s.tag] : [])
}

/**
 * Choose quiz questions: filter notes by source (several packages or tags: any of them, each item once), then one card per note in an allowed format
 * (any template of the note, locked or not: a quiz is an assessment).
 */
export function pickQuizQuestions({ notes, cards, logs, config, now, dayEndTs, rand = Math.random }: PickInput): QuizQuestion[] {
  const byNote = groupBy(cards, (c) => c.noteId)
  const logsByNote = groupBy(logs, (l) => l.noteId)

  const live = notes.filter((n) => n.deletedAt === null && !n.suspended)
  let pool: Note[]
  const src = config.source
  switch (src.kind) {
    case 'package': {
      const ids = new Set(sourcePackageIds(src))
      pool = shuffle(live.filter((n) => n.packageId !== null && ids.has(n.packageId)), rand)
      break
    }
    case 'tag': {
      const tags = new Set(sourceTags(src))
      pool = shuffle(live.filter((n) => n.tags.some((t) => tags.has(t))), rand)
      break
    }
    case 'due':
      pool = shuffle(
        live.filter((n) => (byNote.get(n.id) ?? []).some((c) => isActiveCard(c) && !c.suspended && c.fsrs.state !== 0 && c.fsrs.due < dayEndTs)),
        rand,
      )
      break
    case 'weak': {
      const scored = live
        .map((n) => ({ n, s: weaknessScore(byNote.get(n.id) ?? [], logsByNote.get(n.id) ?? [], now) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
      pool = scored.map((x) => x.n)
      break
    }
    case 'random':
      pool = shuffle(live, rand)
      break
  }

  const exercisePool = createPool(notes)
  const out: QuizQuestion[] = []
  for (const note of pool) {
    if (out.length >= config.length) break
    const card = (byNote.get(note.id) ?? []).find((c) => isActiveCard(c) && !c.suspended)
    if (!card) continue
    const exercises = availableExercises(note, card, { promptLanguage: 'english', pool: exercisePool }).filter((id) => {
      const f = quizFormat(id)
      return f !== null && config.formats.includes(f)
    })
    if (!exercises.length) continue
    out.push({ note, card, exercise: exercises[Math.floor(rand() * exercises.length)]! })
  }
  return src.kind === 'weak' ? shuffle(out, rand) : out
}

/** How many items a quiz with this config can ask (each item once), whatever the length. */
export function availableQuizItems(input: Omit<PickInput, 'rand'>): number {
  return pickQuizQuestions({ ...input, config: { ...input.config, length: Infinity }, rand: () => 0 }).length
}

export interface TagTrend {
  tag: string
  /** Accuracy per quiz (oldest first) for quizzes that touched the tag. */
  points: number[]
}

/** Per-tag accuracy across saved quizzes, for "score trends per tag". */
export function quizTagTrends(results: readonly QuizResult[]): TagTrend[] {
  const map = new Map<string, number[]>()
  for (const r of [...results].sort((a, b) => a.timestamp - b.timestamp)) {
    const perTag = new Map<string, { ok: number; n: number }>()
    for (const q of r.questions) {
      for (const t of q.tags) {
        const s = perTag.get(t) ?? { ok: 0, n: 0 }
        s.n++
        if (q.correct) s.ok++
        perTag.set(t, s)
      }
    }
    for (const [t, s] of perTag) map.set(t, [...(map.get(t) ?? []), s.ok / s.n])
  }
  return [...map.entries()].map(([tag, points]) => ({ tag, points })).sort((a, b) => b.points.length - a.points.length || a.tag.localeCompare(b.tag))
}
