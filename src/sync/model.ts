import type { SyncTable } from '../data/dexie'

/** Cloud tables (supabase/schema.sql). */
export type RemoteTable = 'notes' | 'cards' | 'review_logs' | 'packages' | 'quiz_results' | 'settings'
export const REMOTE_TABLES: RemoteTable[] = ['packages', 'notes', 'cards', 'review_logs', 'quiz_results', 'settings']

export const REMOTE_OF: Record<SyncTable, RemoteTable> = {
  notes: 'notes',
  cards: 'cards',
  reviewLogs: 'review_logs',
  packages: 'packages',
  quizzes: 'quiz_results',
  settings: 'settings',
  meta: 'settings',
}

/** Review logs and quiz results are never overwritten; only a deletion (undo) can follow. */
export const APPEND_ONLY = new Set<SyncTable>(['reviewLogs', 'quizzes'])

/** A row as stored in the cloud. */
export interface RemoteRow {
  id: string
  data: Record<string, unknown>
  updated_at: string
  deleted_at: string | null
}

/** A row as sent to the cloud (user_id and updated_at are filled in by the server/adapter). */
export interface OutRow {
  id: string
  data: Record<string, unknown>
  deleted_at: string | null
}

type Rec = Record<string, unknown>

const pad = (n: unknown) => String(Math.max(0, Math.floor(typeof n === 'number' && Number.isFinite(n) ? n : 0))).padStart(13, '0')
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Sortable conflict clock (compared as plain strings, here and in the database trigger).
 * - cards: the latest review wins (max of last review and reset/undo time), then the latest write
 * - everything else: the latest write wins (`_mtime`, stamped on every local write; older data falls back to
 *   its own timestamps)
 */
export function clockOf(table: SyncTable, rec: Rec): string {
  const mtime = rec._mtime as number | undefined
  switch (table) {
    case 'cards': {
      const fsrs = rec.fsrs as { lastReview?: number | null } | undefined
      const review = Math.max(fsrs?.lastReview ?? 0, (rec.resetAt as number | undefined) ?? 0)
      return `${pad(review)}.${pad(mtime ?? rec.createdAt)}`
    }
    case 'notes':
      return pad(mtime ?? rec.updatedAt)
    case 'packages':
      return pad(mtime ?? rec.createdAt)
    case 'reviewLogs':
    case 'quizzes':
      return pad(rec.timestamp)
    case 'settings':
    case 'meta':
      return pad(mtime)
  }
}

/** Clock of a local deletion made at `at`. */
export function tombstoneClock(table: SyncTable, at: number): string {
  return table === 'cards' ? `${pad(at)}.${pad(at)}` : pad(at)
}

/** Which local table/key a cloud row belongs to. The cloud `settings` table holds settings and cheat-sheets. */
export function localOf(table: RemoteTable, id: string): { table: SyncTable; id: string } {
  switch (table) {
    case 'review_logs':
      return { table: 'reviewLogs', id }
    case 'quiz_results':
      return { table: 'quizzes', id }
    case 'settings':
      return id === 'settings' ? { table: 'settings', id } : { table: 'meta', id }
    default:
      return { table, id }
  }
}

const isKeyValue = (t: SyncTable) => t === 'settings' || t === 'meta'

/** Local record → cloud row. `rec` undefined means the record was deleted locally at `deletedAt`. */
export function toOutRow(table: SyncTable, id: string, rec: Rec | undefined, deletedAt: number): OutRow {
  if (!rec) return { id, data: { _tombstone: true, _clock: tombstoneClock(table, deletedAt) }, deleted_at: iso(deletedAt) }
  const _clock = clockOf(table, rec)
  if (isKeyValue(table)) return { id, data: { value: rec.value, _mtime: rec._mtime ?? 0, _clock }, deleted_at: null }
  const trashedAt = table === 'notes' ? (rec.deletedAt as number | null) : null
  return { id, data: { ...rec, _clock }, deleted_at: trashedAt ? iso(trashedAt) : null }
}

/** Cloud row → local record (as stored in Dexie, with its `_mtime`). */
export function fromRemote(table: SyncTable, row: RemoteRow): Rec {
  const { _clock: _, ...data } = row.data
  if (isKeyValue(table)) return { key: row.id, value: data.value, _mtime: data._mtime }
  return data
}

export function isTombstone(row: RemoteRow): boolean {
  return row.data._tombstone === true
}

export type Decision =
  /** Store the cloud version locally. */
  | 'take-remote'
  /** Delete the local record (deleted elsewhere, later than the local change). */
  | 'delete-local'
  /** The local version is newer: keep it and make sure it gets pushed. */
  | 'keep-local'
  /** Nothing to do. */
  | 'same'

/**
 * Merge one cloud row into local state.
 * `local` is the local record (undefined if absent); `pendingDeleteAt` is set when the record was deleted
 * locally and that deletion has not been pushed yet.
 */
export function decide(table: SyncTable, local: Rec | undefined, pendingDeleteAt: number | undefined, row: RemoteRow): Decision {
  const remoteGone = isTombstone(row) || (APPEND_ONLY.has(table) && row.deleted_at !== null)
  if (APPEND_ONLY.has(table)) {
    // Never overwritten: only presence and deletion matter.
    if (remoteGone) return local ? 'delete-local' : 'same'
    if (local || pendingDeleteAt !== undefined) return 'same'
    return 'take-remote'
  }
  const remoteClock = String(row.data._clock ?? '')
  const localClock = local ? clockOf(table, local) : pendingDeleteAt !== undefined ? tombstoneClock(table, pendingDeleteAt) : null
  if (localClock === null) return remoteGone ? 'same' : 'take-remote'
  if (remoteClock > localClock) return remoteGone ? (local ? 'delete-local' : 'same') : 'take-remote'
  if (remoteClock < localClock) return 'keep-local'
  return 'same'
}
