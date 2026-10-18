import type { Card, Note, QuizConfig, QuizFormat, QuizResult, ReviewLog } from './types'
import { shuffle } from './util'

/** Quiz format of each auto-checkable template; self-graded and audio templates are not quizzable. */
export function quizFormat(template: string): QuizFormat | null {
  if (template.startsWith('cloze:')) return 'cloze'
  switch (template) {
    case 'which-is-right':
    case 'tense-choose':
      return 'choice'
    case 'cloze-use':
    case 'chunk-cloze':
    case 'natural-cloze':
    case 'tense-fill':
      return 'cloze'
    case 'produce':
    case 'recall-full':
    case 'correct-it':
    case 'upgrade':
      return 'production'
    default:
      return null
  }
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

/**
 * Choose quiz questions: filter notes by source, then one card per note in an allowed format
 * (any template of the note, locked or not: a quiz is an assessment).
 */
export function pickQuizQuestions({ notes, cards, logs, config, now, dayEndTs, rand = Math.random }: PickInput): QuizQuestion[] {
  const byNote = new Map<string, Card[]>()
  for (const c of cards) byNote.set(c.noteId, [...(byNote.get(c.noteId) ?? []), c])
  const logsByNote = new Map<string, ReviewLog[]>()
  for (const l of logs) logsByNote.set(l.noteId, [...(logsByNote.get(l.noteId) ?? []), l])

  const live = notes.filter((n) => n.deletedAt === null && !n.suspended)
  let pool: Note[]
  const src = config.source
  switch (src.kind) {
    case 'package':
      pool = shuffle(live.filter((n) => n.packageId === src.packageId), rand)
      break
    case 'tag':
      pool = shuffle(live.filter((n) => n.tags.includes(src.tag)), rand)
      break
    case 'due':
      pool = shuffle(
        live.filter((n) => (byNote.get(n.id) ?? []).some((c) => c.unlocked && !c.suspended && c.fsrs.state !== 0 && c.fsrs.due < dayEndTs)),
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

  const out: QuizQuestion[] = []
  for (const note of pool) {
    if (out.length >= config.length) break
    const options = (byNote.get(note.id) ?? []).filter((c) => {
      const f = quizFormat(c.template)
      return !c.suspended && f !== null && config.formats.includes(f)
    })
    if (!options.length) continue
    out.push({ note, card: options[Math.floor(rand() * options.length)]! })
  }
  return src.kind === 'weak' ? shuffle(out, rand) : out
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
