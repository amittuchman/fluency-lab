import { stamp } from '../data/changes'
import { dirtyEntries, SYNC_STATE_PREFIX, SYNCED_META, type DirtyEntry, type FluencyDB, type SyncTable } from '../data/dexie'
import { APPEND_ONLY, clockOf, decide, fromRemote, localOf, REMOTE_OF, REMOTE_TABLES, toOutRow, type OutRow, type RemoteRow, type RemoteTable } from './model'

/** The cloud side of sync. Implemented for Supabase (./supabaseRemote) and for tests (./testing/pgRemote). */
export interface RemoteStore {
  /** Rows changed after `since` (server time, exclusive), oldest first. */
  pull(table: RemoteTable, since: string | null, offset: number, limit: number): Promise<RemoteRow[]>
  /** Upsert rows; with ignoreDuplicates, rows that already exist are left untouched. */
  push(table: RemoteTable, rows: OutRow[], opts: { ignoreDuplicates: boolean }): Promise<void>
}

interface SyncState {
  /** Per table: the newest server `updated_at` already pulled. */
  cursors: Partial<Record<RemoteTable, string>>
  lastSyncedAt: number | null
}

export interface SyncResult {
  pulled: number
  applied: number
  pushed: number
  firstSync: boolean
}

const PAGE = 1000
const PUSH_BATCH = 300
/** Re-read a little before the cursor: rows committed slightly out of order are not missed (merging is idempotent). */
const OVERLAP_MS = 2 * 60_000

type Rec = Record<string, unknown>

/**
 * One account's sync on one device: pull (and merge) everything changed in the cloud since the last sync,
 * then push everything changed locally. Dexie stays the source of truth; nothing local is ever replaced
 * wholesale: each record is merged on its own by the rules in ./model.
 */
export class SyncEngine {
  constructor(
    private readonly db: FluencyDB,
    private readonly remote: RemoteStore,
    private readonly userId: string,
  ) {}

  private get stateKey() {
    return `${SYNC_STATE_PREFIX}${this.userId}`
  }

  async lastSyncedAt(): Promise<number | null> {
    return ((await this.db.meta.get(this.stateKey))?.value as SyncState | undefined)?.lastSyncedAt ?? null
  }

  async sync(): Promise<SyncResult> {
    const saved = (await this.db.meta.get(this.stateKey))?.value as SyncState | undefined
    const firstSync = !saved
    const state: SyncState = saved ?? { cursors: {}, lastSyncedAt: null }
    // First sync of this account on this device: everything local is offered to the cloud (merge, never replace).
    if (firstSync) await this.markAllDirty()

    let pulled = 0
    let applied = 0
    for (const table of REMOTE_TABLES) {
      const since = state.cursors[table] ? new Date(Date.parse(state.cursors[table]!) - OVERLAP_MS).toISOString() : null
      for (let offset = 0; ; offset += PAGE) {
        const rows = await this.remote.pull(table, since, offset, PAGE)
        pulled += rows.length
        applied += await this.apply(table, rows)
        const newest = rows.at(-1)?.updated_at
        if (newest && (!state.cursors[table] || Date.parse(newest) > Date.parse(state.cursors[table]!))) state.cursors[table] = newest
        if (rows.length < PAGE) break
      }
    }
    // Save the cursors before pushing: what was pulled is merged locally even if the push fails.
    await this.db.meta.put({ key: this.stateKey, value: state })

    const pushed = await this.push()
    state.lastSyncedAt = Date.now()
    await this.db.meta.put({ key: this.stateKey, value: state })
    return { pulled, applied, pushed, firstSync }
  }

  /** Merge pulled rows into Dexie (raw tables: these writes are not local changes and are not queued). */
  private async apply(remoteTable: RemoteTable, rows: RemoteRow[]): Promise<number> {
    if (!rows.length) return 0
    let changed = 0
    const db = this.db
    const tables = [db.notes, db.cards, db.reviewLogs, db.packages, db.quizzes, db.settings, db.meta, db.dirty]
    await db.transaction('rw', tables, async () => {
      for (const row of rows) {
        const { table, id } = localOf(remoteTable, row.id)
        if (table === 'meta' && !SYNCED_META.has(id)) continue
        const store = db.syncTable(table)
        const key = `${table}:${id}`
        const [local, pending] = await Promise.all([store.get(id) as Promise<Rec | undefined>, db.dirty.get(key)])
        const decision = decide(table, local, local ? undefined : pending?.at, row)
        switch (decision) {
          case 'take-remote': {
            const rec = fromRemote(table, row)
            await store.put(rec)
            await db.dirty.delete(key)
            if (table === 'cards') await this.dedupeCard(rec)
            changed++
            break
          }
          case 'delete-local':
            await store.delete(id)
            await db.dirty.delete(key)
            changed++
            break
          case 'keep-local':
            // The cloud has an older version: make sure ours gets pushed.
            if (!pending) await db.dirty.put(dirtyEntries(table, [id], stamp())[0]!)
            break
          case 'same':
            break
        }
      }
    })
    return changed
  }

  /**
   * Two devices can create the same note's card independently (cards created before ids were deterministic).
   * Keep the version with the most recent review and delete the other one everywhere.
   */
  private async dedupeCard(card: Rec): Promise<void> {
    const twins = (await this.db.cards.where('noteId').equals(card.noteId as string).toArray()) as unknown as Rec[]
    const same = twins.filter((c) => c.template === card.template)
    if (same.length < 2) return
    same.sort((a, b) => (clockOf('cards', b) > clockOf('cards', a) ? 1 : -1))
    const losers = same.slice(1).map((c) => c.id as string)
    await this.db.cards.bulkDelete(losers)
    await this.db.dirty.bulkPut(dirtyEntries('cards', losers, stamp()))
  }

  private async markAllDirty(): Promise<void> {
    const at = stamp()
    const entries: DirtyEntry[] = []
    for (const table of ['notes', 'cards', 'reviewLogs', 'packages', 'quizzes'] as const) {
      entries.push(...dirtyEntries(table, (await this.db.syncTable(table).toCollection().primaryKeys()) as string[], at))
    }
    if (await this.db.settings.get('settings')) entries.push(...dirtyEntries('settings', ['settings'], at))
    for (const key of SYNCED_META) if (await this.db.meta.get(key)) entries.push(...dirtyEntries('meta', [key], at))
    // Keep existing entries (their stamps may stand for pending deletions); add the rest.
    const existing = new Set((await this.db.dirty.toCollection().primaryKeys()) as string[])
    await this.db.dirty.bulkPut(entries.filter((e) => !existing.has(e.key)))
  }

  /** Push the outbox. An entry is cleared only if the record did not change again while the push ran. */
  private async push(): Promise<number> {
    const outbox = await this.db.dirty.toArray()
    if (!outbox.length) return 0
    const byTable = new Map<SyncTable, DirtyEntry[]>()
    for (const e of outbox) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e])

    let pushed = 0
    for (const [table, entries] of byTable) {
      for (let i = 0; i < entries.length; i += PUSH_BATCH) {
        const batch = entries.slice(i, i + PUSH_BATCH)
        const recs = (await this.db.syncTable(table).bulkGet(batch.map((e) => e.id))) as Array<Rec | undefined>
        const rows = batch.map((e, k) => toOutRow(table, e.id, recs[k], e.at))
        const remote = REMOTE_OF[table]
        if (APPEND_ONLY.has(table)) {
          // New logs are inserted once and never overwritten; deletions (undo) only set deleted_at.
          const inserts = rows.filter((r) => r.deleted_at === null)
          const deletions = rows.filter((r) => r.deleted_at !== null)
          if (inserts.length) await this.remote.push(remote, inserts, { ignoreDuplicates: true })
          if (deletions.length) await this.remote.push(remote, deletions, { ignoreDuplicates: false })
        } else {
          await this.remote.push(remote, rows, { ignoreDuplicates: false })
        }
        await this.db.transaction('rw', this.db.dirty, async () => {
          const current = await this.db.dirty.bulkGet(batch.map((e) => e.key))
          const done = batch.filter((e, k) => current[k]?.at === e.at).map((e) => e.key)
          await this.db.dirty.bulkDelete(done)
        })
        pushed += rows.length
      }
    }
    return pushed
  }
}
