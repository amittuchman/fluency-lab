// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { createDexieRepos, FluencyDB } from '../data/dexie'
import { META, type Repos } from '../data/repos'
import { createNote, importPackage, initialize, makeNote, purgeNotes, reviewCard, trashNotes, undoLastReview, updateNote } from '../data/services'
import { parseImport } from '../domain/parser'
import { emptyFsrs } from '../domain/scheduler'
import { isActiveCard, newCard } from '../domain/templates'
import type { Card, Note, NoteContent } from '../domain/types'
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
    // The item's level progress travels with the card.
    expect(await firstCard(b, note)).toMatchObject({ level: 1, cleanStreak: 1, fsrs: { reps: 1 } })
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

  it('two copies of the same card (old cards created separately on each device) collapse into one', async () => {
    const a = await device()
    const b = await device()
    const note = await createNote(a.repos, vocab('hedge'), [], null)
    // Before ids were deterministic, each device gave the same note's card its own random id.
    const old = { ...newCard(note.id, { template: 'recog', order: 0, contentHash: 'h' }, T0), id: 'random-id-a' }
    await a.repos.cards.put(old)
    await a.engine.sync()
    await b.engine.sync()
    await b.db.cards.delete(old.id)
    await b.repos.cards.put({ ...old, id: 'legacy-random-id', fsrs: { ...old.fsrs, reps: 3, lastReview: T0 + 9_000, state: 2 } })
    await b.engine.sync()
    await a.engine.sync()
    await b.engine.sync()
    for (const d of [a, b]) {
      const twins = (await d.repos.cards.byNote(note.id)).filter((c) => c.template === 'recog')
      expect(twins.map((c) => c.id)).toEqual(['legacy-random-id'])
    }
  })

  describe('the update to one card per item, on two devices', () => {
    /** Data from before the update, synced to both devices; each device still has to run the migration. */
    async function oldData() {
      const a = await device()
      const b = await device()
      const note = makeNote(vocab('hedge'), [], null, T0)
      const old = (template: string, order: number, fsrs: Partial<Card['fsrs']> = {}): Card => ({
        ...newCard(note.id, { template, order, contentHash: 'h' }, T0),
        fsrs: { ...emptyFsrs(T0), ...fsrs },
      })
      const oldCards = [old('recog', 0, { state: 2, stability: 9, difficulty: 5, reps: 4, lastReview: T0 - 86_400_000 }), old('cloze-use', 1, { state: 2, stability: 2, difficulty: 5, reps: 1, lastReview: T0 - 86_400_000 }), old('produce', 2)]
      await a.repos.notes.put(note)
      await a.repos.cards.bulkPut(oldCards)
      await a.engine.sync()
      await b.engine.sync()
      for (const d of [a, b]) await d.repos.meta.set(META.templateVersion, 2)
      return { a, b, note, oldCards }
    }
    const item = async (d: Device, note: Note) => (await d.repos.cards.byNote(note.id)).filter(isActiveCard)
    const study = async (d: Device, note: Note, times: number) => {
      for (let i = 0; i < times; i++) {
        const [card] = await item(d, note)
        await reviewCard(d.repos, { cardId: card!.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: Date.now() - (times - i) * 60_000 })
      }
    }
    async function expectOneItemWithProgress(devices: Device[], note: Note, oldCards: Card[], reps: number) {
      for (const d of devices) {
        const items = await item(d, note)
        expect(items.map((c) => c.id)).toEqual([`${note.id}:item`])
        expect(items[0]!.fsrs.reps).toBe(reps)
        const cards = await d.repos.cards.byNote(note.id)
        for (const c of oldCards) expect(cards.find((x) => x.id === c.id)).toMatchObject({ template: c.template, fsrs: c.fsrs })
      }
      expect(await cloudCount('cards')).toBe(oldCards.length + 1)
    }

    it('both devices migrate: one item card, and progress made on one device is never overwritten', async () => {
      const { a, b, note, oldCards } = await oldData()
      await initialize(a.repos)
      await study(a, note, 2) // the desktop moves on: 4 + 2 reviews
      await a.engine.sync()
      await initialize(b.repos) // the phone opens the new version later and seeds its own copy
      await b.engine.sync()
      await a.engine.sync()
      await expectOneItemWithProgress([a, b], note, oldCards, 6)
      for (const d of [a, b]) expect((await item(d, note))[0]!.level).toBe(3) // L2 from old progress, +1 after 2 clean answers

      // Opening the app again changes nothing.
      for (const d of [a, b]) await initialize(d.repos)
      expect(await a.db.dirty.count()).toBe(0)
      expect(await b.db.dirty.count()).toBe(0)
    })

    it('the item card arriving before the phone migrates is kept as it is', async () => {
      const { a, b, note, oldCards } = await oldData()
      await initialize(a.repos)
      await study(a, note, 1)
      await a.engine.sync()
      await b.engine.sync()
      await initialize(b.repos)
      await b.engine.sync()
      await a.engine.sync()
      await expectOneItemWithProgress([a, b], note, oldCards, 5)
    })

    it('a device still on the old app that removes the item card does not lose it', async () => {
      const { a, b, note, oldCards } = await oldData()
      await initialize(a.repos)
      await study(a, note, 2)
      await a.engine.sync()
      await b.engine.sync()
      // The old app drops card types it doesn't know when a note is edited, and syncs the deletion.
      await b.repos.cards.bulkDelete([`${note.id}:item`])
      await b.engine.sync()
      await a.engine.sync()
      await b.engine.sync()
      await expectOneItemWithProgress([a, b], note, oldCards, 6)
    })
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
    // Only the new note and its card change locally; rows re-read inside the overlap window merge as "same".
    expect(r.applied).toBe(1 + 1)
    expect(await terms(b)).toHaveLength(6)
  })
})
