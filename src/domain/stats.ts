import { dayKey, shiftDayKey } from './scheduler'
import type { Card, Note, ReviewLog, TenseName } from './types'
import { ALL_TENSES } from './tags'

const DAY = 86_400_000
/** Answers slower than this are counted as this long (the user probably stepped away). */
const MAX_COUNTED_MS = 60_000

/** Consecutive study days ending today (or yesterday, if nothing yet today). */
export function streak(logs: readonly ReviewLog[], now: number, rolloverHour: number): number {
  const days = new Set(logs.map((l) => dayKey(l.timestamp, rolloverHour)))
  let offset = days.has(dayKey(now, rolloverHour)) ? 0 : 1
  let count = 0
  while (days.has(shiftDayKey(now, rolloverHour, offset))) {
    count++
    offset++
  }
  return count
}

/** Share of reviews of already-learned cards (Review state) that were recalled, in the window. */
export function trueRetention(logs: readonly ReviewLog[], since: number): { rate: number | null; n: number } {
  const relevant = logs.filter((l) => l.timestamp >= since && l.scheduled && l.cardBefore.fsrs.state === 2)
  if (!relevant.length) return { rate: null, n: 0 }
  return { rate: relevant.filter((l) => l.rating > 1).length / relevant.length, n: relevant.length }
}

export interface Maturity {
  new: number
  learning: number
  young: number
  mature: number
  suspended: number
  locked: number
}

/** Mature = review cards with an interval of 21+ days. */
export function maturity(cards: readonly Card[]): Maturity {
  const m: Maturity = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0, locked: 0 }
  for (const c of cards) {
    if (c.suspended) m.suspended++
    else if (!c.unlocked) m.locked++
    else if (c.fsrs.state === 0) m.new++
    else if (c.fsrs.state === 1 || c.fsrs.state === 3) m.learning++
    else if (c.fsrs.scheduledDays >= 21) m.mature++
    else m.young++
  }
  return m
}

export function timeStudied(logs: readonly ReviewLog[], since: number): number {
  return logs.filter((l) => l.timestamp >= since).reduce((sum, l) => sum + Math.min(l.responseMs, MAX_COUNTED_MS), 0)
}

export interface TagStat {
  tag: string
  notes: number
  reviews: number
  correct: number
  accuracy: number | null
  lapses: number
  leeches: number
}

/** Per-tag review accuracy (in the window) and current lapses/leeches. */
export function tagStats(notes: readonly Note[], cards: readonly Card[], logs: readonly ReviewLog[], since = 0): TagStat[] {
  const noteTags = new Map(notes.map((n) => [n.id, n.tags]))
  const map = new Map<string, TagStat>()
  const get = (tag: string) => {
    let s = map.get(tag)
    if (!s) {
      s = { tag, notes: 0, reviews: 0, correct: 0, accuracy: null, lapses: 0, leeches: 0 }
      map.set(tag, s)
    }
    return s
  }
  for (const n of notes) for (const t of n.tags) get(t).notes++
  for (const c of cards) {
    for (const t of noteTags.get(c.noteId) ?? []) {
      const s = get(t)
      s.lapses += c.fsrs.lapses
      if (c.leech) s.leeches++
    }
  }
  for (const l of logs) {
    if (l.timestamp < since) continue
    for (const t of noteTags.get(l.noteId) ?? []) {
      const s = get(t)
      s.reviews++
      if (l.correct) s.correct++
    }
  }
  for (const s of map.values()) s.accuracy = s.reviews ? s.correct / s.reviews : null
  return [...map.values()]
}

export interface TenseStat {
  tense: TenseName
  items: number
  /** 0–1: average of min(1, stability / 21 days) over the tense's cards. */
  mastery: number
  due: number
}

export function tenseStats(notes: readonly Note[], cards: readonly Card[], now: number, dayEndTs: number): TenseStat[] {
  const byTense = new Map<string, Note[]>()
  for (const n of notes) if (n.type === 'tense') byTense.set(n.fields.tense, [...(byTense.get(n.fields.tense) ?? []), n])
  const cardsByNote = new Map<string, Card[]>()
  for (const c of cards) cardsByNote.set(c.noteId, [...(cardsByNote.get(c.noteId) ?? []), c])
  return ALL_TENSES.map((tense) => {
    const ns = byTense.get(tense) ?? []
    const cs = ns.flatMap((n) => cardsByNote.get(n.id) ?? []).filter((c) => !c.suspended)
    const mastery = cs.length ? cs.reduce((s, c) => s + Math.min(1, c.fsrs.stability / 21), 0) / cs.length : 0
    const due = cs.filter((c) => c.unlocked && c.fsrs.state !== 0 && c.fsrs.due < dayEndTs && (c.buriedUntil ?? 0) <= now).length
    return { tense, items: ns.length, mastery, due }
  })
}

export function daysAgo(ts: number, now: number): number {
  return Math.floor((now - ts) / DAY)
}
