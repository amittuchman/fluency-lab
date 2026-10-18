// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { createDexieRepos, FluencyDB } from '../data/dexie'
import type { Repos } from '../data/repos'
import { createNote, importPackage, initialize, purgeNotes, reviewCard, trashNotes, undoLastReview, updateNote } from '../data/services'
import { parseImport } from '../domain/parser'
import type { Note, NoteContent } from '../domain/types'
import { SyncEngine } from './engine'
import { addUser, asUser, createTestDatabase } from './testing/pgSupabase'
import { PgRemote } from './testing/pgRemote'

/**
 * Two simulated devices (separate local databases) syncing through one cloud: real Postgres with the real
 * supabase/schema.sql (RLS and conflict triggers included).
 */
let pg: PGlite
let n = 0
let user = ''

interface Device {
  db: FluencyDB
  repos: Repos
  remote: PgRemote
  engine: SyncEngine
}

async function device(userId = user): Promise<Device> {
  const db = new FluencyDB(`device-${++n}`)
  const repos = createDexieRepos(db)
  await initialize(repos)
  const remote = new PgRemote(pg, userId)
  return { db, repos, remote, engine: new SyncEngine(db, remote, userId) }
}

beforeAll(async () => {
  pg = await createTestDatabase()
}, 60_000)

beforeEach(async () => {
  // A fresh account per test keeps tests independent.
  user = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  await addUser(pg, user)
})

const T0 = Date.now()
const vocab = (term: string, definition = 'a meaning'): NoteContent => ({ type: 'vocab', fields: { term, definition, examples: [`I said ${term} today.`] } })
const terms = async (d: Device) => (await d.repos.notes.all()).map((x) => (x.type === 'vocab' ? x.fields.term : '')).sort()
const firstCard = async (d: Device, note: Note) => (await d.repos.cards.byNote(note.id)).find((c) => c.order === 0)!
const cloudCount = async (table: string) =>
  (await asUser(pg, user, (tx) => tx.query<{ n: number }>(`select count(*)::int as n from public.${table}`))).rows[0]!.n

describe('sync between two devices', () => {
  it('a new device receives everything: notes, cards, reviews, packages, quizzes, settings', async () => {
    const a = await device()
    const text = '# Package: P\n@vocab hedge | to reduce risk | Firms hedge risk. | #x\n@fix I very agree. => I agree. | rule: r'
    const parsed = parseImport(text)
    await importPackage(a.repos, { name: 'P', sourceText: text, items: parsed.items.map((i) => ({ content: i.content!, tags: i.tags, action: 'create' as const })) })
    const card = (await a.repos.cards.all()).find((c) => c.order === 0)!
    await reviewCard(a.repos, { cardId: card.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null })
    await a.repos.settings.save({ ...(await a.repos.settings.get()), newPerDay: 40 })
    await a.repos.meta.set('cheatSheets', { 'past-simple': { form: 'f', use: 'u', signals: ['x'], examples: ['A.', 'B.'] } })
    expect((await a.engine.sync()).firstSync).toBe(true)

    const b = await device()
    await b.engine.sync()
    expect(await b.repos.notes.all()).toHaveLength(2)
    expect(await b.repos.cards.all()).toEqual(await a.repos.cards.all())
    expect(await b.repos.logs.all()).toEqual(await a.repos.logs.all())
    expect(await b.repos.packages.all()).toEqual(await a.repos.packages.all())
    expect((await b.repos.settings.get()).newPerDay).toBe(40)
    expect(await b.repos.meta.get('cheatSheets')).toEqual(await a.repos.meta.get('cheatSheets'))
    // Nothing left to push on either side.
    expect(await a.db.dirty.count()).toBe(0)
    expect(await b.db.dirty.count()).toBe(0)
  })

  it('first login on a device merges (union), never replaces', async () => {
    const a = await device()
    const b = await device()
    await createNote(a.repos, vocab('alpha'), [], null)
    await createNote(b.repos, vocab('beta'), [], null)
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect(await terms(a)).toEqual(['alpha', 'beta'])
    expect(await terms(b)).toEqual(['alpha', 'beta'])
  })

  it('notes: last write wins, whichever device syncs first', async () => {
    const a = await device()
    const b = await device()
    const note = await createNote(a.repos, vocab('hedge', 'v0'), [], null)
    await a.engine.sync()
    await b.engine.sync()
    await updateNote(a.repos, note.id, vocab('hedge', 'older edit on A'), [])
    await updateNote(b.repos, note.id, vocab('hedge', 'newer edit on B'), [])
    // B syncs first, then A pushes its older edit: the cloud must keep B's.
    await b.engine.sync()
    await a.engine.sync()
    await b.engine.sync()
    for (const d of [a, b]) {
      const got = (await d.repos.notes.get(note.id))!
      expect(got.type === 'vocab' && got.fields.definition).toBe('newer edit on B')
    }
  })

  it('cards: the state with the latest review wins, even against a later non-review write', async () => {
    const a = await device()
    const b = await device()
    const note = await createNote(a.repos, vocab('hedge'), [], null)
    await a.engine.sync()
    await b.engine.sync()
    const id = (await firstCard(a, note)).id
    await reviewCard(b.repos, { cardId: id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: T0 + 1_000 })
    await reviewCard(a.repos, { cardId: id, grade: 1, correct: false, responseMs: 1, mode: 'session', userAnswer: null, now: T0 + 2_000 })
    // B then changes the card without reviewing it (a later write, but an older review).
    const bCard = (await b.repos.cards.get(id))!
    await b.repos.cards.put({ ...bCard, suspended: true })
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    for (const d of [a, b]) expect((await d.repos.cards.get(id))!.fsrs.lastReview).toBe(T0 + 2_000)
    // Both reviews are kept: logs are append-only.
    expect(await a.repos.logs.all()).toHaveLength(2)
    expect(await b.repos.logs.all()).toHaveLength(2)
  })

  it('offline, then online: changes wait in the outbox and go out on the next sync', async () => {
    const a = await device()
    const b = await device()
    await a.engine.sync()
    a.remote.offline = true
    const note = await createNote(a.repos, vocab('offline'), [], null)
    await reviewCard(a.repos, { cardId: (await firstCard(a, note)).id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null })
    await expect(a.engine.sync()).rejects.toThrow('Failed to fetch')
    expect(await a.db.dirty.count()).toBeGreaterThan(0)
    a.remote.offline = false
    await a.engine.sync()
    expect(await a.db.dirty.count()).toBe(0)
    await b.engine.sync()
    expect(await terms(b)).toEqual(['offline'])
    expect(await b.repos.logs.all()).toHaveLength(1)
  })

  it('duplicate pushes change nothing; a review log is never overwritten', async () => {
    const a = await device()
    const note = await createNote(a.repos, vocab('hedge'), [], null)
    await reviewCard(a.repos, { cardId: (await firstCard(a, note)).id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: 'first' })
    await a.engine.sync()
    const counts = [await cloudCount('notes'), await cloudCount('cards'), await cloudCount('review_logs')]
    // Push everything again, with a tampered log: the cloud keeps the original.
    const [log] = await a.db.reviewLogs.toArray()
    await a.db.reviewLogs.put({ ...log!, userAnswer: 'tampered' })
    await a.db.meta.delete(`sync:${user}`) // forces a full re-push
    await a.engine.sync()
    await a.engine.sync()
    expect([await cloudCount('notes'), await cloudCount('cards'), await cloudCount('review_logs')]).toEqual(counts)
    const cloudLog = await asUser(pg, user, (tx) => tx.query<{ data: { userAnswer: string } }>('select data from public.review_logs'))
    expect(cloudLog.rows[0]!.data.userAnswer).toBe('first')
  })

  it('deletions are soft and sync: Trash, permanent delete, and undo of a review', async () => {
    const a = await device()
    const b = await device()
    const keep = await createNote(a.repos, vocab('keep'), [], null)
    const gone = await createNote(a.repos, vocab('gone'), [], null)
    const card = await firstCard(a, keep)
    // Timestamped well in the future on purpose: an undo must still win (a clock can move backwards).
    await reviewCard(a.repos, { cardId: card.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: Date.now() + 3_600_000 })
    await a.engine.sync()
    await b.engine.sync()
    expect(await b.repos.logs.all()).toHaveLength(1)

    await trashNotes(a.repos, [keep.id])
    await purgeNotes(a.repos, [gone.id])
    await undoLastReview(a.repos)
    await a.engine.sync()
    await b.engine.sync()

    expect((await b.repos.notes.trashed()).map((x) => x.id)).toEqual([keep.id])
    expect(await b.repos.notes.get(gone.id)).toBeUndefined()
    expect(await b.repos.cards.byNote(gone.id)).toEqual([])
    expect(await b.repos.logs.all()).toEqual([])
    expect((await b.repos.cards.get(card.id))!.fsrs.reps).toBe(0)
    // In the cloud the rows still exist, marked deleted.
    const rows = await asUser(pg, user, (tx) => tx.query<{ id: string; deleted_at: Date | null }>('select id, deleted_at from public.notes order by id'))
    expect(rows.rows.every((r) => r.deleted_at !== null)).toBe(true)
  })

  it('editing a note on one device resets its changed cards on the other, despite older reviews there', async () => {
    const a = await device()
    const b = await device()
    const note = await createNote(a.repos, vocab('hedge', 'v1'), [], null)
    await a.engine.sync()
    await b.engine.sync()
    const id = (await firstCard(a, note)).id
    await reviewCard(b.repos, { cardId: id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: T0 - 60_000 })
    await b.engine.sync()
    await a.engine.sync()
    await updateNote(a.repos, note.id, vocab('hedge', 'v2: a different definition'), [])
    await a.engine.sync()
    await b.engine.sync()
    for (const d of [a, b]) expect((await d.repos.cards.get(id))!.fsrs.reps).toBe(0)
  })

  it('two copies of the same card (created separately on each device) collapse into one', async () => {
    const a = await device()
    const b = await device()
    const note = await createNote(a.repos, vocab('hedge'), [], null)
    await a.engine.sync()
    await b.engine.sync()
    // Simulate an old-style random id on B for the same note + template, with a newer review.
    const original = await firstCard(b, note)
    await b.db.cards.delete(original.id)
    await b.repos.cards.put({ ...original, id: 'legacy-random-id', fsrs: { ...original.fsrs, reps: 3, lastReview: T0 + 9_000, state: 2 } })
    await b.engine.sync()
    await a.engine.sync()
    await b.engine.sync()
    for (const d of [a, b]) {
      const recog = (await d.repos.cards.byNote(note.id)).filter((c) => c.template === 'recog')
      expect(recog.map((c) => c.id)).toEqual(['legacy-random-id'])
    }
  })

  it("accounts are isolated: another user's device sees none of it", async () => {
    const a = await device()
    await createNote(a.repos, vocab('private'), [], null)
    await a.engine.sync()
    const other = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
    await addUser(pg, other)
    const stranger = await device(other)
    await stranger.engine.sync()
    expect(await stranger.repos.notes.all()).toEqual([])
  })

  it('incremental sync only pulls what changed', async () => {
    const a = await device()
    const b = await device()
    for (let i = 0; i < 5; i++) await createNote(a.repos, vocab(`w${i}`), [], null)
    await a.engine.sync()
    await b.engine.sync()
    await createNote(a.repos, vocab('one more'), [], null)
    await a.engine.sync()
    const r = await b.engine.sync()
    // Only the new note and its 4 cards change locally; rows re-read inside the overlap window merge as "same".
    expect(r.applied).toBe(1 + 4)
    expect(await terms(b)).toHaveLength(6)
  })
})
