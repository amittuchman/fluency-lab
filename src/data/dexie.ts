import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_SETTINGS, type Card, type Note, type Package, type QuizResult, type ReviewLog, type Settings } from '../domain/types'
import type { Repos } from './repos'

export const SCHEMA_VERSION = 1

interface KeyValue {
  key: string
  value: unknown
}

export class FluencyDB extends Dexie {
  notes!: EntityTable<Note, 'id'>
  cards!: EntityTable<Card, 'id'>
  reviewLogs!: EntityTable<ReviewLog, 'id'>
  packages!: EntityTable<Package, 'id'>
  quizzes!: EntityTable<QuizResult, 'id'>
  settings!: EntityTable<KeyValue, 'key'>
  meta!: EntityTable<KeyValue, 'key'>

  constructor(name = 'fluency-lab') {
    super(name)
    // Schema history. Never edit a released version; add a new one with an upgrade() instead.
    this.version(1).stores({
      notes: 'id, type, packageId, updatedAt, *tags',
      cards: 'id, noteId',
      reviewLogs: 'id, cardId, timestamp',
      packages: 'id, createdAt',
      quizzes: 'id, timestamp',
      settings: 'key',
      meta: 'key',
    })
  }
}

export function createDexieRepos(db: FluencyDB): Repos {
  const tables = [db.notes, db.cards, db.reviewLogs, db.packages, db.quizzes, db.settings, db.meta]
  return {
    notes: {
      get: (id) => db.notes.get(id),
      getMany: async (ids) => (await db.notes.bulkGet(ids)).filter((n): n is Note => !!n),
      all: () => db.notes.filter((n) => n.deletedAt === null).toArray(),
      trashed: () => db.notes.filter((n) => n.deletedAt !== null).toArray(),
      byPackage: (packageId) => db.notes.where('packageId').equals(packageId).toArray(),
      put: async (n) => {
        await db.notes.put(n)
      },
      bulkPut: async (ns) => {
        await db.notes.bulkPut(ns)
      },
      bulkDelete: (ids) => db.notes.bulkDelete(ids),
      count: () => db.notes.filter((n) => n.deletedAt === null).count(),
    },
    cards: {
      get: (id) => db.cards.get(id),
      getMany: async (ids) => (await db.cards.bulkGet(ids)).filter((c): c is Card => !!c),
      all: () => db.cards.toArray(),
      byNote: (noteId) => db.cards.where('noteId').equals(noteId).toArray(),
      byNotes: (noteIds) => db.cards.where('noteId').anyOf(noteIds).toArray(),
      put: async (c) => {
        await db.cards.put(c)
      },
      bulkPut: async (cs) => {
        await db.cards.bulkPut(cs)
      },
      bulkDelete: (ids) => db.cards.bulkDelete(ids),
    },
    logs: {
      add: async (l) => {
        await db.reviewLogs.add(l)
      },
      bulkPut: async (ls) => {
        await db.reviewLogs.bulkPut(ls)
      },
      last: () => db.reviewLogs.orderBy('timestamp').last(),
      since: (ts) => db.reviewLogs.where('timestamp').aboveOrEqual(ts).toArray(),
      byCard: (cardId) => db.reviewLogs.where('cardId').equals(cardId).toArray(),
      byCards: (ids) => db.reviewLogs.where('cardId').anyOf(ids).toArray(),
      all: () => db.reviewLogs.orderBy('timestamp').toArray(),
      delete: (id) => db.reviewLogs.delete(id),
    },
    packages: {
      get: (id) => db.packages.get(id),
      all: () => db.packages.orderBy('createdAt').reverse().toArray(),
      put: async (p) => {
        await db.packages.put(p)
      },
      bulkPut: async (ps) => {
        await db.packages.bulkPut(ps)
      },
      delete: (id) => db.packages.delete(id),
    },
    quizzes: {
      add: async (q) => {
        await db.quizzes.add(q)
      },
      bulkPut: async (qs) => {
        await db.quizzes.bulkPut(qs)
      },
      all: () => db.quizzes.orderBy('timestamp').toArray(),
    },
    settings: {
      get: async () => {
        const row = await db.settings.get('settings')
        return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings> | undefined) ?? {}) }
      },
      save: async (s) => {
        await db.settings.put({ key: 'settings', value: s })
      },
    },
    meta: {
      get: async <T,>(key: string) => (await db.meta.get(key))?.value as T | undefined,
      set: async (key, value) => {
        await db.meta.put({ key, value })
      },
      all: () => db.meta.toArray(),
    },
    transaction: (fn) => db.transaction('rw', tables, fn),
    clearAll: async () => {
      await db.transaction('rw', tables, () => Promise.all(tables.map((t) => t.clear())))
    },
  }
}
