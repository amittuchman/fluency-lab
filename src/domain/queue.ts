import { dayEnd, dayStart } from './scheduler'
import type { Card, Note, ReviewLog, Settings } from './types'

/** A card can be studied: live note, nothing suspended, unlocked, not buried. */
export function isStudyable(card: Card, note: Note | undefined, now: number): note is Note {
  return (
    !!note &&
    note.deletedAt === null &&
    !note.suspended &&
    !card.suspended &&
    card.unlocked &&
    (card.buriedUntil === null || card.buriedUntil <= now)
  )
}

export function primaryTag(note: Note): string {
  return note.tags.find((t) => !t.startsWith('tense:')) ?? note.tags[0] ?? ''
}

/**
 * Reorder so consecutive items differ in type and tag where possible, while staying close to the
 * original priority order (greedy, looking `window` items ahead).
 */
export function interleave<T>(items: readonly T[], keys: (t: T) => [string, string], window = 8): T[] {
  const rest = [...items]
  const out: T[] = []
  let last: [string, string] | null = null
  while (rest.length) {
    let pick = 0
    if (last) {
      const ahead = rest.slice(0, window)
      const both = ahead.findIndex((x) => {
        const [type, tag] = keys(x)
        return type !== last![0] && (tag === '' || tag !== last![1])
      })
      const typeOnly = ahead.findIndex((x) => keys(x)[0] !== last![0])
      pick = both >= 0 ? both : typeOnly >= 0 ? typeOnly : 0
    }
    const [item] = rest.splice(pick, 1)
    out.push(item!)
    last = keys(item!)
  }
  return out
}

/** Take one item from each group in turn (groups keep their internal order). */
export function roundRobin<T>(items: readonly T[], group: (t: T) => string): T[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const g = group(it)
    groups.set(g, [...(groups.get(g) ?? []), it])
  }
  const lists = [...groups.values()]
  const out: T[] = []
  for (let i = 0; out.length < items.length; i++) for (const l of lists) if (i < l.length) out.push(l[i]!)
  return out
}

export interface TodayCounts {
  newDone: number
  reviewsDone: number
}

export function todayCounts(todayLogs: readonly ReviewLog[]): TodayCounts {
  let newDone = 0
  let reviewsDone = 0
  for (const l of todayLogs) {
    // Drill answers don't consume the daily budget: a drill is extra work on top of the daily session.
    if (!l.scheduled || l.mode === 'drill') continue
    if (l.cardBefore.fsrs.state === 0) newDone++
    else reviewsDone++
  }
  return { newDone, reviewsDone }
}

/** Learning cards due within this window are shown early (like Anki's learn-ahead limit). */
export const LEARN_AHEAD_MS = 20 * 60_000

export interface DailyQueue {
  queue: Card[]
  /** Due reviews available today (before the review limit). */
  dueTotal: number
  /** New cards available (before the daily new limit). */
  newTotal: number
  dueToday: number
  newToday: number
}

export interface QueueInput {
  cards: readonly Card[]
  notes: ReadonlyMap<string, Note>
  todayLogs: readonly ReviewLog[]
  settings: Settings
  now: number
}

/**
 * Daily queue: priority cards, then due reviews (most overdue first), then new cards up to the
 * limit; one card per note; each block interleaved across types and tags.
 */
export function buildDailyQueue({ cards, notes, todayLogs, settings, now }: QueueInput): DailyQueue {
  const end = dayEnd(now, settings.rolloverHour)
  const counts = todayCounts(todayLogs)
  const reviewsLeft = Math.max(0, settings.maxReviewsPerDay - counts.reviewsDone)
  const newLeft = Math.max(0, settings.newPerDay - counts.newDone)

  const priority: Card[] = []
  const due: Card[] = []
  const fresh: Card[] = []
  for (const c of cards) {
    if (!isStudyable(c, notes.get(c.noteId), now)) continue
    const learning = c.fsrs.state === 1 || c.fsrs.state === 3
    if (c.priority) priority.push(c)
    else if (c.fsrs.state === 0) fresh.push(c)
    // Learning steps are minutes long: show those cards only when (nearly) due. Review cards: any time today.
    else if (learning ? c.fsrs.due <= now + LEARN_AHEAD_MS : c.fsrs.due < end) due.push(c)
  }
  due.sort((a, b) => a.fsrs.due - b.fsrs.due)
  fresh.sort((a, b) => {
    const na = notes.get(a.noteId)!
    const nb = notes.get(b.noteId)!
    return na.createdAt - nb.createdAt || a.order - b.order
  })

  const seenNotes = new Set<string>()
  const onePerNote = (list: Card[], limit: number) => {
    const out: Card[] = []
    for (const c of list) {
      if (out.length >= limit) break
      if (seenNotes.has(c.noteId)) continue
      seenNotes.add(c.noteId)
      out.push(c)
    }
    return out
  }
  const pri = onePerNote(priority, Infinity)
  const reviews = onePerNote(due, reviewsLeft)
  // New cards: oldest first within each type, but rotate across types so a day's new cards are mixed.
  const news = onePerNote(
    roundRobin(fresh, (c) => notes.get(c.noteId)!.type),
    newLeft,
  )

  const keys = (c: Card): [string, string] => {
    const n = notes.get(c.noteId)!
    return [n.type, primaryTag(n)]
  }
  return {
    queue: [...interleave(pri, keys), ...interleave(reviews, keys), ...interleave(news, keys)],
    dueTotal: due.length,
    newTotal: fresh.length,
    dueToday: reviews.length + pri.length,
    newToday: news.length,
  }
}

export function todayStartFor(now: number, settings: Settings): number {
  return dayStart(now, settings.rolloverHour)
}
