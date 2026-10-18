import { isReadyFromLogs } from '../domain/drill'
import { duplicateKey } from '../domain/parser'
import { dayEnd, dayStart, Scheduler } from '../domain/scheduler'
import { cardsToUnlock, reconcileCards, TEMPLATE_VERSION } from '../domain/templates'
import {
  LEECH_LAPSES,
  type Card,
  type Grade,
  type Note,
  type NoteContent,
  type Package,
  type ReviewLog,
  type ReviewMode,
  type Settings,
} from '../domain/types'
import { newId, uniq } from '../domain/util'
import { SCHEMA_VERSION } from './dexie'
import { META, type Repos } from './repos'

const DAY_MS = 86_400_000
export const TRASH_DAYS = 30

/** Startup housekeeping: schema meta, trash purge, card reconciliation after template changes. */
export async function initialize(repos: Repos, now = Date.now()): Promise<void> {
  await repos.meta.set(META.schemaVersion, SCHEMA_VERSION)
  const expired = (await repos.notes.trashed()).filter((n) => n.deletedAt! < now - TRASH_DAYS * DAY_MS)
  if (expired.length) await purgeNotes(repos, expired.map((n) => n.id))

  if ((await repos.meta.get<number>(META.templateVersion)) !== TEMPLATE_VERSION) {
    const settings = await repos.settings.get()
    const notes = await repos.notes.all()
    await repos.transaction(async () => {
      for (const note of notes) await syncCards(repos, note, settings, now)
      await repos.meta.set(META.templateVersion, TEMPLATE_VERSION)
    })
  }
}

async function syncCards(repos: Repos, note: Note, settings: Settings, now: number): Promise<number> {
  const existing = await repos.cards.byNote(note.id)
  const r = reconcileCards(note, existing, now, settings.unlockThresholds)
  if (r.add.length || r.update.length) await repos.cards.bulkPut([...r.add, ...r.update])
  if (r.remove.length) await repos.cards.bulkDelete(r.remove)
  return r.add.length
}

// ---------- notes ----------

export function makeNote(content: NoteContent, tags: string[], packageId: string | null, now: number): Note {
  return { ...content, id: newId(), tags: uniq(tags), packageId, createdAt: now, updatedAt: now, suspended: false, deletedAt: null } as Note
}

export async function createNote(
  repos: Repos,
  content: NoteContent,
  tags: string[],
  packageId: string | null,
  now = Date.now(),
): Promise<Note> {
  const settings = await repos.settings.get()
  const note = makeNote(content, tags, packageId, now)
  await repos.transaction(async () => {
    await repos.notes.put(note)
    await syncCards(repos, note, settings, now)
  })
  return note
}

/** Edit a note in place. Cards whose content did not change keep their scheduling. */
export async function updateNote(repos: Repos, noteId: string, content: NoteContent, tags: string[], now = Date.now()): Promise<Note> {
  const settings = await repos.settings.get()
  return repos.transaction(async () => {
    const cur = await repos.notes.get(noteId)
    if (!cur) throw new Error('Note not found')
    const next = { ...cur, ...content, tags: uniq(tags), updatedAt: now } as Note
    await repos.notes.put(next)
    // Editing is how a leech gets fixed: clear the flag (it comes back after 4 more lapses).
    const leeches = (await repos.cards.byNote(noteId)).filter((c) => c.leech)
    if (leeches.length) await repos.cards.bulkPut(leeches.map((c) => ({ ...c, leech: false })))
    await syncCards(repos, next, settings, now)
    return next
  })
}

/** Map of duplicate key → live note, for import duplicate detection. */
export async function duplicateIndex(repos: Repos): Promise<Map<string, Note>> {
  const map = new Map<string, Note>()
  for (const n of await repos.notes.all()) map.set(duplicateKey(n), n)
  return map
}

export interface ImportItem {
  content: NoteContent
  tags: string[]
  /** create a new note, update an existing one, or skip. */
  action: 'create' | 'update' | 'skip'
  targetNoteId?: string
}

export interface ImportSummary {
  packageId: string
  created: number
  updated: number
  skipped: number
  cards: number
}

/**
 * Save confirmed import items as one Package. Updated notes move into the new package,
 * since that is the material about to be studied.
 */
export async function importPackage(
  repos: Repos,
  input: { name: string; sourceText: string; items: ImportItem[] },
  now = Date.now(),
): Promise<ImportSummary> {
  const settings = await repos.settings.get()
  const pkg: Package = { id: newId(), name: input.name, createdAt: now, sourceText: input.sourceText }
  const summary: ImportSummary = { packageId: pkg.id, created: 0, updated: 0, skipped: 0, cards: 0 }
  await repos.transaction(async () => {
    await repos.packages.put(pkg)
    const created: Note[] = []
    for (const item of input.items) {
      if (item.action === 'skip') {
        summary.skipped++
        continue
      }
      if (item.action === 'update' && item.targetNoteId) {
        const cur = await repos.notes.get(item.targetNoteId)
        if (cur) {
          const next = { ...cur, ...item.content, tags: uniq([...cur.tags, ...item.tags]), packageId: pkg.id, updatedAt: now } as Note
          await repos.notes.put(next)
          summary.cards += await syncCards(repos, next, settings, now)
          summary.updated++
          continue
        }
      }
      // Stagger createdAt by 1 ms so new cards keep the package's order.
      created.push(makeNote(item.content, item.tags, pkg.id, now + created.length))
    }
    await repos.notes.bulkPut(created)
    const cards: Card[] = []
    for (const note of created) cards.push(...reconcileCards(note, [], now, settings.unlockThresholds).add)
    await repos.cards.bulkPut(cards)
    summary.created = created.length
    summary.cards += cards.length
  })
  return summary
}

export async function setNotesSuspended(repos: Repos, ids: string[], suspended: boolean, now = Date.now()): Promise<void> {
  const notes = await repos.notes.getMany(ids)
  await repos.notes.bulkPut(notes.map((n) => ({ ...n, suspended, updatedAt: now })))
}

export async function setCardSuspended(repos: Repos, cardId: string, suspended: boolean): Promise<void> {
  const c = await repos.cards.get(cardId)
  if (c) await repos.cards.put({ ...c, suspended })
}

export async function addTags(repos: Repos, ids: string[], tags: string[], now = Date.now()): Promise<void> {
  const notes = await repos.notes.getMany(ids)
  await repos.notes.bulkPut(notes.map((n) => ({ ...n, tags: uniq([...n.tags, ...tags]), updatedAt: now })))
}

export async function removeTag(repos: Repos, ids: string[], tag: string, now = Date.now()): Promise<void> {
  const notes = await repos.notes.getMany(ids)
  await repos.notes.bulkPut(notes.map((n) => ({ ...n, tags: n.tags.filter((t) => t !== tag), updatedAt: now })))
}

export async function moveToPackage(repos: Repos, ids: string[], packageId: string | null, now = Date.now()): Promise<void> {
  const notes = await repos.notes.getMany(ids)
  await repos.notes.bulkPut(notes.map((n) => ({ ...n, packageId, updatedAt: now })))
}

/** Move notes to Trash (restorable for 30 days). */
export async function trashNotes(repos: Repos, ids: string[], now = Date.now()): Promise<void> {
  const notes = await repos.notes.getMany(ids)
  await repos.notes.bulkPut(notes.map((n) => ({ ...n, deletedAt: now })))
}

export async function restoreNotes(repos: Repos, ids: string[]): Promise<void> {
  const notes = await repos.notes.getMany(ids)
  await repos.notes.bulkPut(notes.map((n) => ({ ...n, deletedAt: null })))
}

/** Permanently delete notes and their cards. Review history is kept for stats. */
export async function purgeNotes(repos: Repos, ids: string[]): Promise<void> {
  await repos.transaction(async () => {
    const cards = await repos.cards.byNotes(ids)
    await repos.cards.bulkDelete(cards.map((c) => c.id))
    await repos.notes.bulkDelete(ids)
  })
}

// ---------- reviews ----------

/** A lapse flags a leech at 6 lapses, then again every 4 more (after the user cleared it by editing). */
export function isLeechLapse(before: number, after: number): boolean {
  return after > before && after >= LEECH_LAPSES && (after - LEECH_LAPSES) % 4 === 0
}

export interface ReviewInput {
  cardId: string
  grade: Grade
  correct: boolean
  responseMs: number
  mode: ReviewMode
  userAnswer: string | null
  now?: number
  /** For tests: disable interval fuzz. */
  fuzz?: boolean
}

export interface ReviewOutcome {
  card: Card
  log: ReviewLog
}

/**
 * Grade a card. In drill mode only the first answer of the study day reschedules; later correct
 * answers are logged only, later wrong answers still count as a lapse (Again).
 */
export async function reviewCard(repos: Repos, input: ReviewInput): Promise<ReviewOutcome> {
  const now = input.now ?? Date.now()
  const settings = await repos.settings.get()
  const scheduler = new Scheduler({ desiredRetention: settings.desiredRetention, fuzz: input.fuzz ?? true })
  return repos.transaction(async () => {
    const card = await repos.cards.get(input.cardId)
    if (!card) throw new Error('Card not found')
    let scheduled = true
    let grade = input.grade
    if (input.mode === 'drill') {
      const start = dayStart(now, settings.rolloverHour)
      const reviewedToday = (await repos.logs.byCard(card.id)).some((l) => l.scheduled && l.timestamp >= start)
      if (reviewedToday) {
        scheduled = !input.correct
        if (!input.correct) grade = 1
      }
    }
    const fsrs = scheduled ? scheduler.review(card.fsrs, grade, now) : card.fsrs
    const updated: Card = {
      ...card,
      fsrs,
      leech: card.leech || isLeechLapse(card.fsrs.lapses, fsrs.lapses),
      priority: false,
      // A package drill ignores the unlock chain; a drilled card then stays in normal SRS. Undo restores
      // the snapshot (still locked), so this is not recorded in effects.
      unlocked: card.unlocked || input.mode === 'drill',
    }

    const siblings = (await repos.cards.byNote(card.noteId)).filter((c) => c.id !== card.id)
    const end = dayEnd(now, settings.rolloverHour)
    const buried: Card[] = siblings.filter((s) => (s.buriedUntil ?? 0) < end).map((s) => ({ ...s, buriedUntil: end }))
    const unlockIds = cardsToUnlock([updated, ...siblings], settings.unlockThresholds)
    const changed = new Map<string, Card>(buried.map((c) => [c.id, c]))
    for (const id of unlockIds) {
      const base = changed.get(id) ?? siblings.find((s) => s.id === id)!
      changed.set(id, { ...base, unlocked: true })
    }

    const log: ReviewLog = {
      id: newId(),
      cardId: card.id,
      noteId: card.noteId,
      template: card.template,
      timestamp: now,
      rating: grade,
      correct: input.correct,
      responseMs: input.responseMs,
      mode: input.mode,
      userAnswer: input.userAnswer,
      scheduled,
      cardBefore: card,
      effects: { buried: buried.map((c) => c.id), unlocked: unlockIds },
    }
    await repos.cards.bulkPut([updated, ...changed.values()])
    await repos.logs.add(log)
    return { card: updated, log }
  })
}

/** Undo the most recent review: restore the exact previous card state and revert side effects. */
export async function undoLastReview(repos: Repos): Promise<ReviewLog | null> {
  return repos.transaction(async () => {
    const log = await repos.logs.last()
    if (!log) return null
    const affected = await repos.cards.getMany(uniq([...log.effects.buried, ...log.effects.unlocked]))
    const reverted = affected.map((c) => ({
      ...c,
      ...(log.effects.buried.includes(c.id) ? { buriedUntil: null } : {}),
      ...(log.effects.unlocked.includes(c.id) ? { unlocked: false } : {}),
    }))
    const current = await repos.cards.get(log.cardId)
    if (current) await repos.cards.put(log.cardBefore)
    await repos.cards.bulkPut(reverted)
    await repos.logs.delete(log.id)
    return log
  })
}

/**
 * Quiz misses: make the note due now; optionally flag it to lead the next session. A quiz can use a
 * template that is still locked; then the note's most advanced unlocked card is marked instead.
 */
export async function markForRelearn(repos: Repos, cardIds: string[], front: boolean, now = Date.now()): Promise<void> {
  const missed = await repos.cards.getMany(cardIds)
  const targets = new Map<string, Card>()
  for (const c of missed) {
    let target: Card | undefined = c
    if (!c.unlocked) {
      const siblings = (await repos.cards.byNote(c.noteId)).filter((s) => s.unlocked && !s.suspended)
      target = siblings.sort((a, b) => b.order - a.order)[0]
    }
    if (target) targets.set(target.id, target)
  }
  await repos.cards.bulkPut(
    [...targets.values()].map((c) => ({
      ...c,
      fsrs: c.fsrs.state === 0 ? c.fsrs : { ...c.fsrs, due: Math.min(c.fsrs.due, now) },
      buriedUntil: null,
      priority: front || c.priority,
    })),
  )
}

// ---------- package readiness ----------

export interface Readiness {
  total: number
  ready: number
  cardIds: string[]
  readyIds: string[]
}

/**
 * All drillable cards of a set of notes (locked ones included: a drill ignores the unlock chain), and
 * which are "ready" (last two answers correct).
 */
export async function readinessFor(repos: Repos, notes: Note[]): Promise<Readiness> {
  const live = notes.filter((n) => n.deletedAt === null && !n.suspended)
  const cards = (await repos.cards.byNotes(live.map((n) => n.id))).filter((c) => !c.suspended)
  const logs = await repos.logs.byCards(cards.map((c) => c.id))
  const byCard = new Map<string, ReviewLog[]>()
  for (const l of logs) byCard.set(l.cardId, [...(byCard.get(l.cardId) ?? []), l])
  const order = new Map(live.map((n) => [n.id, n.createdAt]))
  cards.sort((a, b) => order.get(a.noteId)! - order.get(b.noteId)! || a.order - b.order)
  const readyIds = cards.filter((c) => isReadyFromLogs(byCard.get(c.id) ?? [])).map((c) => c.id)
  return { total: cards.length, ready: readyIds.length, cardIds: cards.map((c) => c.id), readyIds }
}
