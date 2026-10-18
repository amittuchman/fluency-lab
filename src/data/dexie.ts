import Dexie, { type EntityTable, type Table } from 'dexie'
import { DEFAULT_SETTINGS, type Card, type Note, type Package, type QuizResult, type ReviewLog, type Settings } from '../domain/types'
import { announceLocalChange, stamp } from './changes'
import type { Repos } from './repos'

export const SCHEMA_VERSION = 2

export interface KeyValue {
  key: string
  value: unknown
  /** Last local write (sync clock). */
  _mtime?: number
}

/** Local tables that sync to the cloud. `meta` syncs only the keys in SYNCED_META. */
export type SyncTable = 'notes' | 'cards' | 'reviewLogs' | 'packages' | 'quizzes' | 'settings' | 'meta'
export const SYNCED_META = new Set(['cheatSheets'])
/** Meta keys holding per-user sync state; never exported, never cleared by a backup restore. */
export const SYNC_STATE_PREFIX = 'sync:'

/** Outbox: one entry per local record changed (or deleted) since it was last pushed. */
export interface DirtyEntry {
  key: string
  table: SyncTable
  id: string
  /** Stamp of the latest change; a push only clears the entry if no newer change happened meanwhile. */
  at: number
}

export class FluencyDB extends Dexie {
  notes!: EntityTable<Note, 'id'>
  cards!: EntityTable<Card, 'id'>
  reviewLogs!: EntityTable<ReviewLog, 'id'>
  packages!: EntityTable<Package, 'id'>
  quizzes!: EntityTable<QuizResult, 'id'>
  settings!: EntityTable<KeyValue, 'key'>
  meta!: EntityTable<KeyValue, 'key'>
  dirty!: EntityTable<DirtyEntry, 'key'>

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
    // v2: sync outbox.
    this.version(2).stores({ dirty: 'key, table' })
  }

  /** The record tables a sync table maps to (for raw access by the sync engine). */
  syncTable(t: SyncTable): Table<Record<string, unknown>, string> {
    return this[t] as unknown as Table<Record<string, unknown>, string>
  }
}

/** Repos hand out domain objects without the sync stamp. */
function strip<T>(row: T): T {
  if (!row || typeof row !== 'object' || !('_mtime' in row)) return row
  const { _mtime: _, ...rest } = row as T & { _mtime?: number }
  return rest as T
}
const stripAll = <T,>(rows: T[]): T[] => rows.map(strip)
const stripOne = <T,>(row: T | undefined): T | undefined => (row ? strip(row) : row)

export function dirtyEntries(table: SyncTable, ids: string[], at: number): DirtyEntry[] {
  return ids.map((id) => ({ key: `${table}:${id}`, table, id, at }))
}

export function createDexieRepos(db: FluencyDB): Repos {
  const tables = [db.notes, db.cards, db.reviewLogs, db.packages, db.quizzes, db.settings, db.meta, db.dirty]

  /** Write records with a fresh sync stamp and queue them for push, atomically. */
  async function write<T extends { id: string }>(name: SyncTable, rows: T[], op: 'put' | 'add' = 'put'): Promise<void> {
    if (!rows.length) return
    const at = stamp()
    const table = db.syncTable(name)
    await db.transaction('rw', table, db.dirty, async () => {
      const stamped = rows.map((r) => ({ ...r, _mtime: at }) as unknown as Record<string, unknown>)
      if (op === 'add') await table.bulkAdd(stamped)
      else await table.bulkPut(stamped)
      await db.dirty.bulkPut(dirtyEntries(name, rows.map((r) => r.id), at))
    })
    announceLocalChange()
  }

  /** Delete records and queue the deletions (they sync as tombstones). */
  async function remove(name: SyncTable, ids: string[]): Promise<void> {
    if (!ids.length) return
    const at = stamp()
    const table = db.syncTable(name)
    await db.transaction('rw', table, db.dirty, async () => {
      await table.bulkDelete(ids)
      await db.dirty.bulkPut(dirtyEntries(name, ids, at))
    })
    announceLocalChange()
  }

  return {
    notes: {
      get: async (id) => stripOne(await db.notes.get(id)),
      getMany: async (ids) => stripAll((await db.notes.bulkGet(ids)).filter((n): n is Note => !!n)),
      all: async () => stripAll(await db.notes.filter((n) => n.deletedAt === null).toArray()),
      trashed: async () => stripAll(await db.notes.filter((n) => n.deletedAt !== null).toArray()),
      byPackage: async (packageId) => stripAll(await db.notes.where('packageId').equals(packageId).toArray()),
      put: (n) => write('notes', [n]),
      bulkPut: (ns) => write('notes', ns),
      bulkDelete: (ids) => remove('notes', ids),
      count: () => db.notes.filter((n) => n.deletedAt === null).count(),
    },
    cards: {
      get: async (id) => stripOne(await db.cards.get(id)),
      getMany: async (ids) => stripAll((await db.cards.bulkGet(ids)).filter((c): c is Card => !!c)),
      all: async () => stripAll(await db.cards.toArray()),
      byNote: async (noteId) => stripAll(await db.cards.where('noteId').equals(noteId).toArray()),
      byNotes: async (noteIds) => stripAll(await db.cards.where('noteId').anyOf(noteIds).toArray()),
      put: (c) => write('cards', [c]),
      bulkPut: (cs) => write('cards', cs),
      bulkDelete: (ids) => remove('cards', ids),
    },
    logs: {
      add: (l) => write('reviewLogs', [l], 'add'),
      bulkPut: (ls) => write('reviewLogs', ls),
      last: async () => stripOne(await db.reviewLogs.orderBy('timestamp').last()),
      since: async (ts) => stripAll(await db.reviewLogs.where('timestamp').aboveOrEqual(ts).toArray()),
      byCard: async (cardId) => stripAll(await db.reviewLogs.where('cardId').equals(cardId).toArray()),
      byCards: async (ids) => stripAll(await db.reviewLogs.where('cardId').anyOf(ids).toArray()),
      all: async () => stripAll(await db.reviewLogs.orderBy('timestamp').toArray()),
      delete: (id) => remove('reviewLogs', [id]),
    },
    packages: {
      get: async (id) => stripOne(await db.packages.get(id)),
      all: async () => stripAll(await db.packages.orderBy('createdAt').reverse().toArray()),
      put: (p) => write('packages', [p]),
      bulkPut: (ps) => write('packages', ps),
      delete: (id) => remove('packages', [id]),
    },
    quizzes: {
      add: (q) => write('quizzes', [q], 'add'),
      bulkPut: (qs) => write('quizzes', qs),
      all: async () => stripAll(await db.quizzes.orderBy('timestamp').toArray()),
    },
    settings: {
      get: async () => {
        const row = await db.settings.get('settings')
        return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings> | undefined) ?? {}) }
      },
      save: async (s) => {
        const at = stamp()
        await db.transaction('rw', db.settings, db.dirty, async () => {
          await db.settings.put({ key: 'settings', value: s, _mtime: at })
          await db.dirty.bulkPut(dirtyEntries('settings', ['settings'], at))
        })
        announceLocalChange()
      },
    },
    meta: {
      get: async <T,>(key: string) => (await db.meta.get(key))?.value as T | undefined,
      set: async (key, value) => {
        if (!SYNCED_META.has(key)) {
          await db.meta.put({ key, value })
          return
        }
        const at = stamp()
        await db.transaction('rw', db.meta, db.dirty, async () => {
          await db.meta.put({ key, value, _mtime: at })
          await db.dirty.bulkPut(dirtyEntries('meta', [key], at))
        })
        announceLocalChange()
      },
      // Sync state is per device and per account: it never goes into a backup file.
      all: async () => (await db.meta.toArray()).filter((m) => !m.key.startsWith(SYNC_STATE_PREFIX)).map(({ key, value }) => ({ key, value })),
    },
    transaction: (fn) => db.transaction('rw', tables, fn),
    clearAll: async () => {
      // Used by "replace everything" from a backup. The deletions are queued so they reach the cloud too;
      // the outbox and this device's sync state are kept.
      const at = stamp()
      await db.transaction('rw', tables, async () => {
        const doomed: DirtyEntry[] = []
        for (const name of ['notes', 'cards', 'reviewLogs', 'packages', 'quizzes'] as const) {
          doomed.push(...dirtyEntries(name, (await db.syncTable(name).toCollection().primaryKeys()) as string[], at))
        }
        const syncState = (await db.meta.toArray()).filter((m) => m.key.startsWith(SYNC_STATE_PREFIX))
        await Promise.all([db.notes, db.cards, db.reviewLogs, db.packages, db.quizzes, db.settings, db.meta].map((t) => t.clear()))
        await db.meta.bulkPut(syncState)
        await db.dirty.bulkPut(doomed)
      })
      announceLocalChange()
    },
  }
}
