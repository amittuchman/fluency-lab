import sampleText from '../../samples/sample-package.txt?raw'
import { validateBackup, type BackupFile } from '../domain/backup'
import { emptyFsrs } from '../domain/scheduler'
import { isActiveCard, newCard } from '../domain/templates'
import type { Card } from '../domain/types'
import { parseImport } from '../domain/parser'
import { exportBackup, importBackup } from './backup'
import { createDexieRepos, FluencyDB, SCHEMA_VERSION } from './dexie'
import { META, type Repos } from './repos'
import {
  createNote,
  importPackage,
  initialize,
  makeNote,
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
  it('reschedules, moves the level, and undo restores everything', async () => {
    const note = await createNote(repos, { type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } }, [], null, NOW)
    const cards = await repos.cards.byNote(note.id)
    expect(cards).toHaveLength(1)
    const item = cards[0]!
    const review = (grade: 1 | 3 | 4, now: number, exercise = 'fix-choose') =>
      reviewCard(repos, { cardId: item.id, grade, correct: grade > 1, responseMs: 1000, mode: 'session', userAnswer: null, now, fuzz: false, exercise })

    const out = await review(4, NOW)
    expect(out.card.fsrs.reps).toBe(1)
    expect(out.card.fsrs.stability).toBeGreaterThanOrEqual(2)
    expect(out.card).toMatchObject({ level: 1, cleanStreak: 1 })
    expect(out.log).toMatchObject({ exercise: 'fix-choose', level: 1 })
    const two = await review(3, NOW + 60_000)
    expect(two.card).toMatchObject({ level: 2, cleanStreak: 0 })

    await undoLastReview(repos)
    expect((await repos.cards.get(item.id))!).toMatchObject({ level: 1, cleanStreak: 1 })
    await undoLastReview(repos)
    // The exact pre-review state comes back; resetAt marks it as newer than the undone review for sync.
    const { resetAt, ...restored } = (await repos.cards.get(item.id))!
    expect(restored).toEqual(item)
    expect(resetAt).toBeGreaterThan(0)
    expect(await repos.logs.all()).toEqual([])
  })

  it('two mistakes in a row move the item down a level', async () => {
    const note = await createNote(repos, { type: 'sentence', fields: { text: 'It depends on you.' } }, [], null, NOW)
    const [card] = await repos.cards.byNote(note.id)
    await repos.cards.put({ ...card!, level: 3 })
    const base = { cardId: card!.id, responseMs: 1, mode: 'session' as const, userAnswer: null, fuzz: false, correct: false, grade: 1 as const }
    expect((await reviewCard(repos, { ...base, now: NOW })).card).toMatchObject({ level: 3, missStreak: 1 })
    expect((await reviewCard(repos, { ...base, now: NOW + 60_000 })).card).toMatchObject({ level: 2, missStreak: 0 })
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

it('editing a note keeps scheduling unless what is asked changed', async () => {
  const note = await createNote(repos, { type: 'vocab', fields: { term: 'hedge', definition: 'to protect', examples: ['Firms hedge risk.'] } }, [], null, NOW)
  const [item] = await repos.cards.byNote(note.id)
  await reviewCard(repos, { cardId: item!.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: NOW, fuzz: false })
  await updateNote(repos, note.id, { type: 'vocab', fields: { term: 'hedge', definition: 'to protect', examples: ['Firms hedge risk.'], he: 'לגדר' } }, ['x'], NOW + 1)
  expect((await repos.cards.get(item!.id))!.fsrs.reps).toBe(1)
  await updateNote(repos, note.id, { type: 'vocab', fields: { term: 'hedge', definition: 'to reduce risk', examples: ['Firms hedge risk.'] } }, ['x'], NOW + 2)
  expect((await repos.cards.get(item!.id))!).toMatchObject({ level: 1, fsrs: { reps: 0 } })
})

it('quiz misses: the item is made due now and prioritized', async () => {
  const note = await createNote(repos, { type: 'fix', fields: { wrong: 'a b', right: 'c d', rule: 'r' } }, [], null, NOW)
  const [item] = await repos.cards.byNote(note.id)
  await reviewCard(repos, { cardId: item!.id, grade: 4, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: NOW, fuzz: false })
  await markForRelearn(repos, [item!.id], true, NOW + 1000)
  expect((await repos.cards.get(item!.id))!).toMatchObject({ priority: true, fsrs: { due: NOW + 1000 } })
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

it('readiness: an item is ready after its last two answers were correct', async () => {
  const note = await createNote(repos, { type: 'sentence', fields: { text: 'It depends on you.' } }, [], null, NOW)
  const [card] = await repos.cards.byNote(note.id)
  const base = { cardId: card!.id, responseMs: 1, mode: 'drill' as const, userAnswer: null, fuzz: false, grade: 3 as const, correct: true }
  await reviewCard(repos, { ...base, now: NOW })
  expect((await readinessFor(repos, [note])).readyIds).toEqual([])
  await reviewCard(repos, { ...base, now: NOW + 1 })
  expect(await readinessFor(repos, [note])).toMatchObject({ total: 1, ready: 1, readyIds: [card!.id] })
})

describe('migration to one card per item', () => {
  async function oldDevice() {
    // A device with data from before the redesign: a note with its old per-exercise cards.
    const note = makeNote({ type: 'vocab', fields: { term: 'hedge', definition: 'to protect', examples: ['Firms hedge risk.'] } }, ['x'], null, NOW)
    const old = (template: string, order: number, fsrs: Partial<Card['fsrs']> = {}): Card => ({
      ...newCard(note.id, { template, order, contentHash: 'h' }, NOW),
      fsrs: { ...emptyFsrs(NOW), ...fsrs },
    })
    const cards = [old('recog', 0, { state: 2, stability: 9, reps: 4, lastReview: NOW }), old('cloze-use', 1, { state: 2, stability: 2, reps: 1, lastReview: NOW }), old('produce', 2)]
    await repos.notes.put(note)
    await repos.cards.bulkPut(cards)
    await repos.meta.set(META.templateVersion, 2)
    return { note, cards }
  }

  it('backs everything up first, keeps the old cards untouched, and seeds the item from them', async () => {
    const { note, cards } = await oldDevice()
    await initialize(repos, NOW + 1)
    const backup = await repos.meta.get<BackupFile>(META.backupBeforeV3)
    expect(validateBackup(backup, SCHEMA_VERSION).ok).toBe(true)
    expect(backup!.tables.cards.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort())
    const after = await repos.cards.byNote(note.id)
    for (const c of cards) expect(after.find((x) => x.id === c.id)).toEqual(c)
    expect(after.find(isActiveCard)).toMatchObject({ template: 'item', level: 2, fsrs: { stability: 9, reps: 4 } })
  })

  it('the device-only backup is not synced or exported, and survives a later startup', async () => {
    await oldDevice()
    await initialize(repos, NOW + 1)
    expect((await repos.meta.all()).some((m) => m.key === META.backupBeforeV3)).toBe(false)
    const before = await repos.meta.get(META.backupBeforeV3)
    await initialize(repos, NOW + 2)
    expect(await repos.meta.get(META.backupBeforeV3)).toEqual(before)
  })

  it('a fresh install takes no backup', async () => {
    expect(await repos.meta.get(META.backupBeforeV3)).toBeUndefined()
  })
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
    // Restoring from a file counts as having a backup from the file's export time.
    expect(await r2.meta.get('lastBackupAt')).toBe(NOW)
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

describe('repair of fragment wrong options (once per device)', () => {
  const fix = {
    type: 'fix' as const,
    fields: { wrong: 'I study PPE for two and a half years.', right: 'I have studied PPE for two and a half years.', rule: 'r', distractors: ['have study', 'have studying'] },
  }
  /** Data saved before the repair existed: this device hasn't run it yet. */
  async function beforeRepair() {
    const note = await createNote(repos, fix, [], null, NOW)
    const [card] = await repos.cards.byNote(note.id)
    await reviewCard(repos, { cardId: card!.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: NOW, fuzz: false })
    await db.meta.delete(META.distractorRepair)
    return note
  }

  it('rewrites the options as sentences after a backup; cards and history untouched', async () => {
    const note = await beforeRepair()
    const cardsBefore = await repos.cards.byNote(note.id)
    const logsBefore = await repos.logs.all()
    await initialize(repos, NOW + 1)
    expect((await repos.notes.get(note.id))!.fields).toMatchObject({
      distractors: ['I have study PPE for two and a half years.', 'I have studying PPE for two and a half years.'],
    })
    const backup = await repos.meta.get<BackupFile>(META.backupBeforeDistractorRepair)
    expect(backup!.tables.notes.find((n) => n.id === note.id)!.fields).toMatchObject({ distractors: ['have study', 'have studying'] })
    expect(await repos.cards.byNote(note.id)).toEqual(cardsBefore)
    expect(await repos.logs.all()).toEqual(logsBefore)
  })

  it('runs once: a second start changes nothing, and a fresh install takes no backup', async () => {
    expect(await repos.meta.get(META.backupBeforeDistractorRepair)).toBeUndefined()
    const note = await beforeRepair()
    await initialize(repos, NOW + 1)
    const after = await db.notes.get(note.id)
    await initialize(repos, NOW + 2)
    expect(await db.notes.get(note.id)).toEqual(after)
  })

  it('also repairs items in the Trash', async () => {
    const note = await beforeRepair()
    await trashNotes(repos, [note.id], NOW)
    await db.meta.delete(META.distractorRepair)
    await initialize(repos, NOW + 1)
    expect((await repos.notes.trashed())[0]!.fields).toMatchObject({ distractors: ['I have study PPE for two and a half years.', 'I have studying PPE for two and a half years.'] })
  })
})

describe('re-import upgrades existing items', () => {
  const old = { type: 'fix' as const, fields: { wrong: 'It depends of the price.', right: 'It depends on the price.', rule: 'Depend takes on.' } }
  const lineFor = (extra: Record<string, unknown>) => ({ type: 'fix' as const, fields: { ...old.fields, ...extra } }) as typeof old

  it('fills only the missing fields; keeps id, package, level, FSRS and history; never duplicates', async () => {
    const note = await createNote(repos, old, ['prepositions'], 'pkg-1', NOW)
    const [card] = await repos.cards.byNote(note.id)
    await reviewCard(repos, { cardId: card!.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null, now: NOW, fuzz: false })
    await repos.cards.put({ ...(await repos.cards.get(card!.id))!, level: 3 })
    const cardBefore = await repos.cards.get(card!.id)
    const logsBefore = await repos.logs.all()

    const imported = lineFor({ rule: 'A different rule.', he: 'זה תלוי במחיר.', prompt: 'Someone asks about the deal', also: ['We depend of you. => We depend on you.'] })
    const s = await importPackage(repos, { name: 'P2', sourceText: '', items: [{ content: imported, tags: ['pattern:depend-on', 'prepositions'], action: 'update', targetNoteId: note.id }] }, NOW + 5)

    expect(s).toMatchObject({ created: 0, updated: 1, unchanged: 0, packageId: null })
    const after = (await repos.notes.get(note.id))!
    expect(after).toMatchObject({ id: note.id, packageId: 'pkg-1', tags: ['prepositions', 'pattern:depend-on'] })
    expect(after.fields).toEqual({ ...old.fields, he: 'זה תלוי במחיר.', prompt: 'Someone asks about the deal', also: ['We depend of you. => We depend on you.'] }) // rule kept
    expect(await repos.cards.byNote(note.id)).toEqual([cardBefore])
    expect(await repos.logs.all()).toEqual(logsBefore)
    expect(await repos.notes.count()).toBe(1)
    expect(await repos.packages.all()).toEqual([]) // nothing new: no empty package

    const again = await importPackage(repos, { name: 'P3', sourceText: '', items: [{ content: imported, tags: [], action: 'update', targetNoteId: note.id }] }, NOW + 6)
    expect(again).toMatchObject({ updated: 0, unchanged: 1 })
  })
})
