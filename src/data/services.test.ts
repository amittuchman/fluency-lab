import sampleText from '../../samples/sample-package.txt?raw'
import { validateBackup } from '../domain/backup'
import { parseImport } from '../domain/parser'
import { exportBackup, importBackup } from './backup'
import { createDexieRepos, FluencyDB, SCHEMA_VERSION } from './dexie'
import type { Repos } from './repos'
import {
  createNote,
  importPackage,
  initialize,
  markForRelearn,
  readinessFor,
  restoreNotes,
  reviewCard,
  trashNotes,
  undoLastReview,
  updateNote,
} from './services'

let n = 0
let db: FluencyDB
let repos: Repos

beforeEach(async () => {
  db = new FluencyDB(`test-${++n}`)
  repos = createDexieRepos(db)
  await initialize(repos)
})
afterEach(async () => {
  await db.delete()
})

const NOW = new Date(2026, 9, 18, 12).getTime()

async function importSample() {
  const parsed = parseImport(sampleText)
  return importPackage(
    repos,
    {
      name: parsed.packageName ?? 'x',
      sourceText: sampleText,
      items: parsed.items.filter((i) => i.content).map((i) => ({ content: i.content!, tags: i.tags, action: 'create' as const })),
    },
    NOW,
  )
}

it('imports the sample as one package with cards', async () => {
  const s = await importSample()
  const notes = await repos.notes.all()
  expect(s.created).toBe(notes.length)
  expect(notes.every((x) => x.packageId === s.packageId)).toBe(true)
  const cards = await repos.cards.all()
  expect(cards.length).toBe(s.cards)
  expect(cards.filter((c) => c.unlocked).length).toBeGreaterThan(0)
  expect((await repos.packages.all())[0]!.sourceText).toBe(sampleText)
})

describe('reviews', () => {
  it('reschedules, buries siblings, unlocks the next template, and undo restores everything', async () => {
    const note = await createNote(repos, { type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } }, [], null, NOW)
    const [first, second] = (await repos.cards.byNote(note.id)).sort((a, b) => a.order - b.order)
    const before = await repos.cards.get(first!.id)

    const out = await reviewCard(repos, { cardId: first!.id, grade: 4, correct: true, responseMs: 1000, mode: 'session', userAnswer: null, now: NOW, fuzz: false })
    expect(out.card.fsrs.reps).toBe(1)
    expect(out.card.fsrs.stability).toBeGreaterThanOrEqual(2)
    const sib = await repos.cards.get(second!.id)
    expect(sib!.unlocked).toBe(true)
    expect(sib!.buriedUntil).toBeGreaterThan(NOW)

    const undone = await undoLastReview(repos)
    expect(undone?.id).toBe(out.log.id)
    expect(await repos.cards.get(first!.id)).toEqual(before)
    const sib2 = await repos.cards.get(second!.id)
    expect(sib2!.unlocked).toBe(false)
    expect(sib2!.buriedUntil).toBeNull()
    expect(await repos.logs.all()).toEqual([])
  })

  it('flags a leech after 6 lapses', async () => {
    const note = await createNote(repos, { type: 'sentence', fields: { text: 'It depends on you.' } }, [], null, NOW)
    const [card] = await repos.cards.byNote(note.id)
    let t = NOW
    let c = (await reviewCard(repos, { cardId: card!.id, grade: 4, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: t, fuzz: false })).card
    for (let i = 0; i < 6; i++) {
      t = c.fsrs.due + 1
      c = (await reviewCard(repos, { cardId: card!.id, grade: 1, correct: false, responseMs: 1, mode: 'session', userAnswer: null, now: t, fuzz: false })).card
      t = c.fsrs.due + 1
      c = (await reviewCard(repos, { cardId: card!.id, grade: 4, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: t, fuzz: false })).card
    }
    expect(c.fsrs.lapses).toBe(6)
    expect(c.leech).toBe(true)
    await updateNote(repos, note.id, { type: 'sentence', fields: { text: 'It depends on you.', notes: 'hook' } }, [], t)
    expect((await repos.cards.get(card!.id))!.leech).toBe(false)
  })

  it('re-flags a cleared leech every 4 lapses after the 6th', async () => {
    const { isLeechLapse } = await import('./services')
    expect([5, 6, 7, 9, 10, 14].map((n) => isLeechLapse(n - 1, n))).toEqual([false, true, false, false, true, true])
    expect(isLeechLapse(6, 6)).toBe(false)
  })

  it('drill: only the first answer of the day reschedules; a later miss still lapses', async () => {
    const note = await createNote(repos, { type: 'sentence', fields: { text: 'It depends on you.' } }, [], null, NOW)
    const [card] = await repos.cards.byNote(note.id)
    const base = { cardId: card!.id, responseMs: 1, mode: 'drill' as const, userAnswer: null, fuzz: false }
    const a = await reviewCard(repos, { ...base, grade: 3, correct: true, now: NOW })
    expect(a.log.scheduled).toBe(true)
    const b = await reviewCard(repos, { ...base, grade: 3, correct: true, now: NOW + 60_000 })
    expect(b.log.scheduled).toBe(false)
    expect(b.card.fsrs).toEqual(a.card.fsrs)
    const c = await reviewCard(repos, { ...base, grade: 3, correct: false, now: NOW + 120_000 })
    expect(c.log.scheduled).toBe(true)
    expect(c.log.rating).toBe(1)
  })
})

it('editing a note keeps scheduling unless the card content changed', async () => {
  const note = await createNote(repos, { type: 'vocab', fields: { term: 'hedge', definition: 'to protect', examples: ['Firms hedge risk.'] } }, [], null, NOW)
  const recog = (await repos.cards.byNote(note.id)).find((c) => c.template === 'recog')!
  await reviewCard(repos, { cardId: recog.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: NOW, fuzz: false })
  await updateNote(repos, note.id, { type: 'vocab', fields: { term: 'hedge', definition: 'to protect', examples: ['Firms hedge risk.'], he: 'לגדר' } }, ['x'], NOW + 1)
  expect((await repos.cards.get(recog.id))!.fsrs.reps).toBe(1)
  await updateNote(repos, note.id, { type: 'vocab', fields: { term: 'hedge', definition: 'to reduce risk', examples: ['Firms hedge risk.'] } }, ['x'], NOW + 2)
  expect((await repos.cards.get(recog.id))!.fsrs.reps).toBe(0)
})

it('quiz misses: a locked card maps to the most advanced unlocked sibling, made due now and prioritized', async () => {
  const note = await createNote(repos, { type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } }, [], null, NOW)
  const cards = (await repos.cards.byNote(note.id)).sort((a, b) => a.order - b.order)
  const first = (await reviewCard(repos, { cardId: cards[0]!.id, grade: 4, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: NOW, fuzz: false })).card
  await undoLastReview(repos) // keep the second card locked
  await repos.cards.put(first)
  await markForRelearn(repos, [cards[1]!.id], true, NOW + 1000)
  const after = await repos.cards.get(cards[0]!.id)
  expect(after!.fsrs.due).toBe(NOW + 1000)
  expect(after!.priority).toBe(true)
  expect((await repos.cards.get(cards[1]!.id))!.unlocked).toBe(false)
})

it('trash and restore', async () => {
  const note = await createNote(repos, { type: 'sentence', fields: { text: 'Hello there.' } }, [], null, NOW)
  await trashNotes(repos, [note.id], NOW)
  expect(await repos.notes.all()).toEqual([])
  expect((await repos.notes.trashed()).map((x) => x.id)).toEqual([note.id])
  await restoreNotes(repos, [note.id])
  expect((await repos.notes.all()).map((x) => x.id)).toEqual([note.id])
})

it('trash older than 30 days is purged on startup', async () => {
  const note = await createNote(repos, { type: 'sentence', fields: { text: 'Hello there.' } }, [], null, NOW)
  await trashNotes(repos, [note.id], NOW)
  await initialize(repos, NOW + 31 * 86_400_000)
  expect(await repos.notes.trashed()).toEqual([])
  expect(await repos.cards.byNote(note.id)).toEqual([])
})

it('readiness: a card is ready after its last two answers were correct', async () => {
  const note = await createNote(repos, { type: 'sentence', fields: { text: 'It depends on you.' } }, [], null, NOW)
  const card = (await repos.cards.byNote(note.id)).find((c) => c.order === 0)!
  const base = { cardId: card.id, responseMs: 1, mode: 'drill' as const, userAnswer: null, fuzz: false, grade: 3 as const, correct: true }
  await reviewCard(repos, { ...base, now: NOW })
  expect((await readinessFor(repos, [note])).readyIds).toEqual([])
  await reviewCard(repos, { ...base, now: NOW + 1 })
  // The first Good unlocked the second template, which has not been answered yet.
  expect(await readinessFor(repos, [note])).toMatchObject({ total: 2, ready: 1, readyIds: [card.id] })
})

describe('backup', () => {
  it('round-trips through JSON (replace)', async () => {
    await importSample()
    const card = (await repos.cards.all()).find((c) => c.unlocked)!
    await reviewCard(repos, { cardId: card.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: 'x', now: NOW })
    const file = JSON.parse(JSON.stringify(await exportBackup(repos, NOW)))
    const v = validateBackup(file, SCHEMA_VERSION)
    expect(v.ok).toBe(true)
    if (!v.ok) return

    const other = new FluencyDB(`restore-${n}`)
    const r2 = createDexieRepos(other)
    await importBackup(r2, v.file, 'replace')
    expect(await r2.notes.all()).toEqual(await repos.notes.all())
    expect(await r2.cards.all()).toEqual(await repos.cards.all())
    expect(await r2.logs.all()).toEqual(await repos.logs.all())
    expect(await r2.packages.all()).toEqual(await repos.packages.all())
    await other.delete()
  })

  it('merge keeps existing data and adds new records', async () => {
    const a = await createNote(repos, { type: 'sentence', fields: { text: 'One.' } }, [], null, NOW)
    const file = await exportBackup(repos, NOW)
    await trashNotes(repos, [a.id], NOW + 5)
    await createNote(repos, { type: 'sentence', fields: { text: 'Two.' } }, [], null, NOW)
    await importBackup(repos, file, 'merge')
    expect((await repos.notes.trashed()).map((x) => x.id)).toEqual([a.id])
    expect((await repos.notes.all()).length).toBe(1)
  })

  it('rejects invalid files', () => {
    expect(validateBackup({ hello: 1 }, SCHEMA_VERSION).ok).toBe(false)
    expect(validateBackup({ app: 'fluency-lab', schemaVersion: 99, tables: {} }, SCHEMA_VERSION).ok).toBe(false)
  })
})
